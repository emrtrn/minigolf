import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { validateSavePayload } from "./tools/saveValidator";

// Single-codebase template: this repo's own public/ is the project root that
// both the game (static fetch) and the editor (authoring middleware) read/write.
const PUBLIC_DIR = resolve("public");
const PROJECT_MANIFEST_PATH = resolve("public/project.3dgame.json");

interface ProjectManifest {
  schema: 1;
  name: string;
  type: string;
  version: string;
  entry: string;
  publicDir: string;
  editor: {
    defaultScene: string;
    assetCatalog?: string;
    assetManifest: string;
    gridSize?: number;
    gridEnabled?: boolean;
    snapRotationDeg?: number;
    snapRotationEnabled?: boolean;
    snapScale?: number;
    snapScaleEnabled?: boolean;
    metadataSchema?: string;
    previewUrl?: string;
  };
  scripts: Record<string, string | undefined>;
  output: {
    distDir: string;
  };
}

async function readProjectManifest(): Promise<ProjectManifest> {
  return JSON.parse(await readFile(PROJECT_MANIFEST_PATH, "utf8")) as ProjectManifest;
}

/**
 * Resolves a public-root-relative path to an absolute path under public/,
 * refusing anything that escapes the public directory (path-traversal guard).
 */
function resolvePublicPath(publicRelativePath: string): string {
  const normalized = publicRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = resolve(PUBLIC_DIR, normalized);
  const rootWithSep = PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : `${PUBLIC_DIR}${sep}`;
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(rootWithSep)) {
    throw new Error(`path escapes public root: ${publicRelativePath}`);
  }
  return resolved;
}

interface DirTreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  ext?: string;
  size?: number;
  children?: DirTreeNode[];
}

// Read-only recursive listing of a project directory. Used by the editor's
// Content Drawer to mirror the live asset folders. Depth and entry count are
// capped so a stray symlink loop or huge tree cannot stall the dev server.
async function readDirTree(
  absDir: string,
  relDir: string,
  depth: number,
  budget: { remaining: number },
): Promise<DirTreeNode[]> {
  if (depth <= 0 || budget.remaining <= 0) return [];
  const entries = await readdir(absDir, { withFileTypes: true });
  const nodes: DirTreeNode[] = [];
  for (const entry of entries) {
    if (budget.remaining <= 0) break;
    if (entry.name.startsWith(".")) continue;
    budget.remaining -= 1;
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: childRel,
        type: "dir",
        children: await readDirTree(
          resolve(absDir, entry.name),
          childRel,
          depth - 1,
          budget,
        ),
      });
    } else if (entry.isFile()) {
      const fileStat = await stat(resolve(absDir, entry.name));
      nodes.push({
        name: entry.name,
        path: childRel,
        type: "file",
        ext: extname(entry.name).toLowerCase().replace(/^\./, ""),
        size: fileStat.size,
      });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

// The /__save-layout payload validator (allowlist) lives in
// tools/saveValidator.ts so it can be unit-tested headlessly; imported above.

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

// Endpoints that write files. These must never be reachable from the LAN even
// when `server.host` is true; the read-only directory listing (/__project-dir)
// stays open so real-device (LAN) testing can still render scenes.
const PRIVILEGED_URLS = new Set(["/__save-layout"]);

function isPrivilegedUrl(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0] ?? url;
  return PRIVILEGED_URLS.has(path);
}

// Trust only the real peer socket address, never spoofable forwarded headers.
function isLocalRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  return (
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
}

function layoutEditorPlugin(): Plugin {
  return {
    name: "3dgamedev-layout-editor",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (isPrivilegedUrl(req.url) && !isLocalRequest(req)) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              error: "Forbidden: authoring endpoints are restricted to localhost.",
            }),
          );
          return;
        }

        // Read-only directory listing for the editor's Content Browser tree.
        // Scoped to this project's public/ folder (the asset/layout root).
        if (req.url?.startsWith("/__project-dir/")) {
          try {
            const encodedPath = req.url.slice("/__project-dir/".length).split("?")[0] ?? "";
            const projectPath = decodeURIComponent(encodedPath);
            const dirPath = resolvePublicPath(projectPath);
            const dirStat = await stat(dirPath);
            if (!dirStat.isDirectory()) throw new Error(`not a directory: ${projectPath}`);
            const normalizedRoot = projectPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
            const children = await readDirTree(dirPath, normalizedRoot, 12, {
              remaining: 5000,
            });
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ root: normalizedRoot, children }));
          } catch (error) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
          return;
        }

        if (req.url !== "/__save-layout") {
          next();
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        try {
          const payload = validateSavePayload(await readJsonBody(req));
          const manifest = await readProjectManifest();
          const layoutPath = resolvePublicPath(manifest.editor.defaultScene);
          const previous = await readFile(layoutPath, "utf8").catch(() => null);
          const nextLayout = `${JSON.stringify(payload.layout, null, 2)}\n`;
          await writeFile(layoutPath, nextLayout, "utf8");
          let manifestChanged = false;
          if (payload.editor) {
            const previousManifest = `${JSON.stringify(manifest, null, 2)}\n`;
            manifest.editor = { ...manifest.editor, ...payload.editor };
            const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
            manifestChanged = previousManifest !== nextManifest;
            if (manifestChanged) await writeFile(PROJECT_MANIFEST_PATH, nextManifest, "utf8");
          }
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              ok: true,
              path: layoutPath,
              changed: previous !== nextLayout || manifestChanged,
            }),
          );
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [layoutEditorPlugin()],
  resolve: {
    alias: {
      // Keep in sync with tsconfig.json "paths"
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@engine": fileURLToPath(new URL("./engine", import.meta.url)),
      "@editor": fileURLToPath(new URL("./editor", import.meta.url)),
      "@builder": fileURLToPath(new URL("./builder", import.meta.url)),
      "@game": fileURLToPath(new URL("./game", import.meta.url)),
      "@project": fileURLToPath(new URL("./project", import.meta.url)),
    },
  },
  build: {
    // Mobile target: WebGL2-capable browsers all support ES2022 baseline features we use.
    target: "es2022",
    // Rapier's compat/WASM runtime is intentionally isolated in vendor-physics
    // and is much larger than the game entry. Keep Vite's global chunk warning
    // above that known lazy chunk while verify:dist guards runtime-only output.
    chunkSizeWarningLimit: 2400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/three/")) return "vendor-three";
          if (normalized.includes("/node_modules/meshoptimizer/")) return "vendor-meshoptimizer";
          // When Rapier lands, keep its WASM-backed runtime behind the same
          // vendor split pattern instead of folding it into the game entry.
          if (normalized.includes("/node_modules/@dimforge/")) return "vendor-physics";
          return undefined;
        },
      },
    },
  },
  server: {
    // Expose on LAN for real-device (Android/Chrome) testing.
    host: true,
  },
});
