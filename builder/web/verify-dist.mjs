#!/usr/bin/env node
/**
 * builder/web/verify-dist.mjs
 *
 * Runtime-only packaging verification for the Architecture V2 migration.
 *
 * Scans the production `dist/` output after `npm run build` and reports
 * editor-only, dev-endpoint, or legacy launcher/authoring strings that leaked
 * into the shipped bundle. This turns the migration's core invariant — editor /
 * runtime / build separation (ARCHITECTURE_PLAN_SOURCE.md §20,
 * MIGRATION_ROADMAP.md Phase 6) — into an automated check.
 *
 * Two severities:
 *   FAIL  — a broken editor/runtime boundary (e.g. EditorUi in the bundle).
 *           Exits non-zero. These must never appear in a correct build.
 *   WARN  — known authoring-code-in-game-chunk debt (e.g. the dev `/__save-*`
 *           endpoint strings still shipped by src/scene/SceneApp.ts). Reported
 *           but non-fatal until that code is split out (CLAUDE.md Near-Term
 *           Order #1). Use `--strict` to promote warnings to failures once the
 *           split lands, so the gate can enforce a fully clean bundle.
 *
 * How the FAIL boundary is supposed to hold: src/main.ts gates the dynamic
 * `import("@/editor/EditorUi")` behind `import.meta.env.DEV`, so Vite
 * dead-code-eliminates the entire editor (chunk included) from a production
 * build. A correct `dist/` therefore contains NO `EditorUi` at all.
 *
 * This is a heuristic string scan, not a proof: minification can mangle
 * identifiers. It is a fast regression gate, not a security boundary.
 *
 * Zero dependencies (Node built-ins only). Standalone — not part of the tsc
 * graph or the app bundle.
 *
 * Usage:
 *   npm run build
 *   node builder/web/verify-dist.mjs
 *   node builder/web/verify-dist.mjs --strict          # warnings also fail
 *   node builder/web/verify-dist.mjs --dist path/to/dist
 *
 * Exit code: 0 = clean (or warnings-only without --strict),
 *            1 = FAIL-tier leak, --strict warning, or dist missing/invalid.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");

// ---------------------------------------------------------------------------
// Forbidden strings, grouped by severity. Keep precise/high-signal so the gate
// stays trustworthy. Extend the right list as editor-only modules move.
// ---------------------------------------------------------------------------

// Hard failures: presence means the editor/runtime boundary is broken.
const FAIL_TOKENS = [
  { token: "EditorUi", reason: "editor UI leaked into the runtime bundle" },
  { token: "launcher-shell", reason: "legacy launcher shell string in dist" },
  { token: "Project Browser", reason: "legacy project-browser UI string in dist" },
  { token: "__studio", reason: "legacy studio endpoint/string in dist" },
  { token: "__project-file", reason: "legacy project-file endpoint/string in dist" },
];

// Warnings: known authoring-code-in-game-chunk debt, expected to disappear once
// authoring logic is split out of SceneApp. Non-fatal unless --strict.
const WARN_TOKENS = [
  { token: "/__save-layout", reason: "dev save endpoint shipped by SceneApp (authoring code in game chunk)" },
  { token: "/__project-dir", reason: "dev content-tree endpoint shipped in game chunk" },
];
// Note: bare "studio" is intentionally NOT listed — too broad, false-positive
// prone. "__studio" covers the same legacy surface with high signal.

// Extensions worth reading as text. Binary assets (.glb, images) are skipped.
const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".html", ".css", ".json", ".map", ".txt", ".svg",
]);

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const strict = argv.includes("--strict");
  const i = argv.indexOf("--dist");
  const distDir =
    i !== -1 && argv[i + 1]
      ? resolve(process.cwd(), argv[i + 1])
      : join(projectRoot, "dist");
  return { strict, distDir };
}

async function walk(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

async function main() {
  const { strict, distDir } = parseArgs(process.argv.slice(2));
  const rel = (p) => relative(projectRoot, p).replace(/\\/g, "/");

  console.log(
    `[verify-dist] scanning ${rel(distDir)}/${strict ? " (strict)" : ""}`,
  );

  // --- structural sanity ---------------------------------------------------
  if (!existsSync(distDir)) {
    console.error(
      `[FAIL] ${rel(distDir)}/ does not exist. Run \`npm run build\` first.`,
    );
    process.exitCode = 1;
    return;
  }

  const allFiles = await walk(distDir);
  const structural = [];
  if (!allFiles.some((f) => f.toLowerCase().endsWith("index.html"))) {
    structural.push("missing index.html (dist looks incomplete)");
  }
  if (!allFiles.some((f) => extname(f).toLowerCase() === ".js")) {
    structural.push("no .js bundle found (dist looks incomplete)");
  }

  // --- forbidden-string scan ----------------------------------------------
  const textFiles = allFiles.filter((f) => TEXT_EXT.has(extname(f).toLowerCase()));
  const fails = [];
  const warns = [];

  for (const file of textFiles) {
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const { token, reason } of FAIL_TOKENS) {
      const count = countOccurrences(content, token);
      if (count > 0) fails.push({ file: rel(file), token, count, reason });
    }
    for (const { token, reason } of WARN_TOKENS) {
      const count = countOccurrences(content, token);
      if (count > 0) warns.push({ file: rel(file), token, count, reason });
    }
  }

  // --- report --------------------------------------------------------------
  const tokenCount = FAIL_TOKENS.length + WARN_TOKENS.length;
  console.log(
    `[verify-dist] scanned ${textFiles.length} text file(s) ` +
      `of ${allFiles.length} total; ${tokenCount} forbidden token(s).`,
  );

  for (const p of structural) console.error(`[FAIL] ${p}`);

  for (const { file, token, count, reason } of warns) {
    console.warn(`[WARN] ${file}: "${token}" x${count} — ${reason}`);
  }

  if (fails.length > 0) {
    console.error(`[FAIL] ${fails.length} boundary-violation hit(s):`);
    for (const { file, token, count, reason } of fails) {
      console.error(`  - ${file}: "${token}" x${count} — ${reason}`);
    }
  }

  // --- verdict -------------------------------------------------------------
  const hardFail = structural.length > 0 || fails.length > 0;
  const strictFail = strict && warns.length > 0;

  if (!hardFail && !strictFail) {
    if (warns.length > 0) {
      console.log(
        `[PASS] no boundary violations. ${warns.length} known-debt warning(s) ` +
          `(pass --strict to enforce).`,
      );
    } else {
      console.log("[PASS] dist/ is runtime-only — no forbidden strings found.");
    }
    process.exitCode = 0;
  } else {
    if (strictFail && !hardFail) {
      console.error(`[FAIL] --strict: ${warns.length} warning(s) treated as errors.`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[verify-dist] unexpected error:", err);
  process.exitCode = 1;
});
