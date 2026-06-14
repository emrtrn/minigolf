import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

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

function isNumberTuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => Number.isFinite(item))
  );
}

function validateRotationDeg(value: unknown, label: string): number {
  const degrees = Number(value);
  if (!Number.isFinite(degrees) || degrees < -360 || degrees > 360) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(degrees.toFixed(1));
}

function validateScaleValue(value: unknown, label: string): number {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(scale.toFixed(3));
}

function validatePositiveSnap(value: unknown, label: string, max: number): number {
  const snap = Number(value);
  if (!Number.isFinite(snap) || snap <= 0 || snap > max) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(snap.toFixed(3));
}

function validateOptionalNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(number.toFixed(3));
}

/** Validates a schema-driven gameplay metadata blob (string/number/boolean/string[]). */
function validateMetadata(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} metadata must be an object`);
  }
  const input = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw === "string" || typeof raw === "boolean") {
      metadata[key] = raw;
    } else if (typeof raw === "number") {
      if (!Number.isFinite(raw)) throw new Error(`invalid ${label} metadata number: ${key}`);
      metadata[key] = raw;
    } else if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
      metadata[key] = [...raw];
    } else {
      throw new Error(`invalid ${label} metadata value for ${key}`);
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/** Validates an optional behavior reference (`{ script, params? }`). */
function validateBehavior(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} behavior must be an object`);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.script !== "string" || input.script.length === 0) {
    throw new Error(`${label} behavior.script must be a non-empty string`);
  }
  const behavior: Record<string, unknown> = { script: input.script };
  const params = validateMetadata(input.params, `${label} behavior.params`);
  if (params) behavior.params = params;
  return behavior;
}

/** Copies the optional transform/authoring fields onto `target`, validating each. */
function applyTransformFields(
  entry: Record<string, unknown>,
  target: Record<string, unknown>,
  label: string,
): void {
  if (typeof entry.name === "string") target.name = entry.name;
  if (entry.hidden === true) target.hidden = true;
  if (entry.locked === true) target.locked = true;
  if (entry.scaleLocked === true) target.scaleLocked = true;
  if (entry.castShadow === false) target.castShadow = false;
  if (entry.collision === false) target.collision = false;
  if (typeof entry.groupId === "string") target.groupId = entry.groupId;
  if (typeof entry.nodeId === "string") target.nodeId = entry.nodeId;
  if (typeof entry.parentId === "string") target.parentId = entry.parentId;
  const metadata = validateMetadata(entry.metadata, label);
  if (metadata) target.metadata = metadata;
  const behavior = validateBehavior(entry.behavior, label);
  if (behavior) target.behavior = behavior;

  if (entry.rotationYDeg !== undefined) {
    target.rotationYDeg = validateRotationDeg(entry.rotationYDeg, `${label} rotationYDeg`);
  }
  if (entry.rotation !== undefined) {
    if (!isNumberTuple(entry.rotation)) throw new Error(`invalid ${label} rotation`);
    target.rotation = entry.rotation.map((axis) =>
      validateRotationDeg(axis, `${label} rotation component`),
    );
  }
  if (entry.pivot !== undefined) {
    if (!isNumberTuple(entry.pivot)) throw new Error(`invalid ${label} pivot`);
    target.pivot = entry.pivot.map((axis) => Number(axis.toFixed(3)));
  }
  if (entry.scale !== undefined) {
    target.scale = isNumberTuple(entry.scale)
      ? entry.scale.map((axis) => validateScaleValue(axis, `${label} scale component`))
      : validateScaleValue(entry.scale, `${label} scale`);
  }
}

function validatePlacement(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("placement must be an object");
  }
  const entry = value as Record<string, unknown>;
  if (!isNumberTuple(entry.position)) throw new Error("invalid placement position");

  const placement: Record<string, unknown> = {
    position: entry.position.map((item) => Number(item.toFixed(3))),
  };
  applyTransformFields(entry, placement, "placement");
  return placement;
}

function validateHexColor(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return value;
}

function validateWorldSettings(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") {
    throw new Error("worldSettings must be an object");
  }
  const input = value as Record<string, unknown>;
  const worldSettings: Record<string, unknown> = {};

  if (input.staticObjectsCastShadow !== undefined) {
    if (typeof input.staticObjectsCastShadow !== "boolean") {
      throw new Error("worldSettings.staticObjectsCastShadow must be boolean");
    }
    if (input.staticObjectsCastShadow) worldSettings.staticObjectsCastShadow = true;
  }

  if (input.staticObjectsReceiveShadow !== undefined) {
    if (typeof input.staticObjectsReceiveShadow !== "boolean") {
      throw new Error("worldSettings.staticObjectsReceiveShadow must be boolean");
    }
    if (!input.staticObjectsReceiveShadow) worldSettings.staticObjectsReceiveShadow = false;
  }

  if (input.backgroundColor !== undefined) {
    worldSettings.backgroundColor = validateHexColor(input.backgroundColor, "backgroundColor");
  }
  if (input.ambientColor !== undefined) {
    worldSettings.ambientColor = validateHexColor(input.ambientColor, "ambientColor");
  }
  if (input.ambientIntensity !== undefined) {
    const intensity = validateOptionalNumber(input.ambientIntensity, "ambientIntensity", 0, 20);
    if (intensity !== undefined) worldSettings.ambientIntensity = intensity;
  }

  return Object.keys(worldSettings).length > 0 ? worldSettings : null;
}

function validateLightActor(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("light must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new Error("light id must be a string");
  }
  if (input.type !== "directional" && input.type !== "point" && input.type !== "spot") {
    throw new Error("light type must be directional, point, or spot");
  }
  if (!isNumberTuple(input.position)) throw new Error("invalid light position");

  const light: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    position: input.position.map((number) => Number(number.toFixed(3))),
  };
  if (typeof input.name === "string") light.name = input.name;
  if (input.hidden === true) light.hidden = true;
  if (input.locked === true) light.locked = true;
  if (input.scaleLocked === true) light.scaleLocked = true;
  if (typeof input.groupId === "string") light.groupId = input.groupId;
  if (typeof input.nodeId === "string") light.nodeId = input.nodeId;
  if (typeof input.parentId === "string") light.parentId = input.parentId;
  if (input.rotation !== undefined) {
    if (!isNumberTuple(input.rotation)) throw new Error("invalid light rotation");
    light.rotation = input.rotation.map((axis) =>
      validateRotationDeg(axis, "light rotation component"),
    );
  }
  if (typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)) {
    light.color = input.color;
  }
  const intensity = validateOptionalNumber(input.intensity, "light.intensity", 0, 20);
  if (intensity !== undefined) light.intensity = intensity;
  if (input.castShadow !== undefined) {
    if (typeof input.castShadow !== "boolean") throw new Error("light.castShadow must be boolean");
    light.castShadow = input.castShadow;
  }
  const distance = validateOptionalNumber(input.distance, "light.distance", 0, 100);
  if (distance !== undefined) light.distance = distance;
  const angle = validateOptionalNumber(input.angle, "light.angle", 1, 90);
  if (angle !== undefined) light.angle = angle;
  const penumbra = validateOptionalNumber(input.penumbra, "light.penumbra", 0, 1);
  if (penumbra !== undefined) light.penumbra = penumbra;
  const decay = validateOptionalNumber(input.decay, "light.decay", 0, 8);
  if (decay !== undefined) light.decay = decay;
  return light;
}

function validateLayout(value: unknown): unknown {
  if (!value || typeof value !== "object") throw new Error("layout must be an object");
  const layout = value as Record<string, unknown>;

  if (layout.schema !== 1) throw new Error("layout schema must be 1");
  if (typeof layout.name !== "string") throw new Error("layout name must be a string");
  if (
    !Array.isArray(layout.loadGroups) ||
    !layout.loadGroups.every((item) => typeof item === "string")
  ) {
    throw new Error("loadGroups must be string[]");
  }
  if (!Array.isArray(layout.instances)) throw new Error("instances must be an array");
  if (!Array.isArray(layout.characters)) throw new Error("characters must be an array");
  const worldSettings = validateWorldSettings(layout.worldSettings);
  const lights = layout.lights === undefined
    ? null
    : Array.isArray(layout.lights)
      ? layout.lights.map(validateLightActor)
      : (() => {
          throw new Error("lights must be an array");
        })();

  const instances = layout.instances.map((instance) => {
    if (!instance || typeof instance !== "object") {
      throw new Error("instance must be an object");
    }
    const item = instance as Record<string, unknown>;
    if (typeof item.assetId !== "string" || item.assetId.length === 0) {
      throw new Error("instance assetId must be a string");
    }
    if (!Array.isArray(item.placements)) {
      throw new Error(`placements missing for ${item.assetId}`);
    }
    return {
      assetId: item.assetId,
      placements: item.placements.map(validatePlacement),
    };
  });

  const characters = layout.characters.map((character) => {
    if (!character || typeof character !== "object") {
      throw new Error("character must be an object");
    }
    const item = character as Record<string, unknown>;
    if (typeof item.assetId !== "string" || item.assetId.length === 0) {
      throw new Error("character assetId must be a string");
    }
    if (!isNumberTuple(item.position)) throw new Error("invalid character position");
    const entry: Record<string, unknown> = {
      assetId: item.assetId,
      position: item.position.map((number) => Number(number.toFixed(3))),
    };
    if (typeof item.animation === "string") entry.animation = item.animation;
    applyTransformFields(item, entry, "character");
    return entry;
  });

  const output: Record<string, unknown> = {
    schema: 1,
    name: layout.name,
    loadGroups: layout.loadGroups,
    instances,
    characters,
  };
  if (worldSettings) output.worldSettings = worldSettings;
  if (lights) output.lights = lights;
  return output;
}

function validateEditorSettings(value: unknown): Partial<ProjectManifest["editor"]> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("editor settings must be an object");
  const input = value as Record<string, unknown>;
  const editor: Partial<ProjectManifest["editor"]> = {};

  if (input.gridSize !== undefined) {
    editor.gridSize = validatePositiveSnap(input.gridSize, "editor.gridSize", 100);
  }
  if (input.gridEnabled !== undefined) {
    if (typeof input.gridEnabled !== "boolean") throw new Error("editor.gridEnabled must be boolean");
    editor.gridEnabled = input.gridEnabled;
  }
  if (input.snapRotationDeg !== undefined) {
    editor.snapRotationDeg = validatePositiveSnap(
      input.snapRotationDeg,
      "editor.snapRotationDeg",
      360,
    );
  }
  if (input.snapRotationEnabled !== undefined) {
    if (typeof input.snapRotationEnabled !== "boolean") {
      throw new Error("editor.snapRotationEnabled must be boolean");
    }
    editor.snapRotationEnabled = input.snapRotationEnabled;
  }
  if (input.snapScale !== undefined) {
    editor.snapScale = validatePositiveSnap(input.snapScale, "editor.snapScale", 8);
  }
  if (input.snapScaleEnabled !== undefined) {
    if (typeof input.snapScaleEnabled !== "boolean") {
      throw new Error("editor.snapScaleEnabled must be boolean");
    }
    editor.snapScaleEnabled = input.snapScaleEnabled;
  }

  return editor;
}

function validateSavePayload(value: unknown): {
  layout: unknown;
  editor: Partial<ProjectManifest["editor"]> | null;
} {
  if (value && typeof value === "object" && "layout" in value) {
    const input = value as Record<string, unknown>;
    return {
      layout: validateLayout(input.layout),
      editor: validateEditorSettings(input.editor),
    };
  }
  return {
    layout: validateLayout(value),
    editor: null,
  };
}

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
