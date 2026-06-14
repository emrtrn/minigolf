# builder/web

Production web build tooling and runtime-only verification for the
Architecture V2 migration (MIGRATION_ROADMAP.md Phase 6).

## verify-dist.mjs

Scans `dist/` after a production build and fails if any editor-only,
dev-endpoint, or legacy launcher/authoring string leaked into the shipped
bundle. It enforces the migration's core invariant: the editor / dev server is
excluded from the runtime package.

```sh
npm run build
node builder/web/verify-dist.mjs
node builder/web/verify-dist.mjs --strict      # warnings also fail
node builder/web/verify-dist.mjs --dist some/dist
```

Exit code `0` = clean (or warnings-only without `--strict`), `1` = FAIL-tier
leak, a `--strict` warning, or `dist/` missing/invalid — so it can gate CI or an
npm script later.

### Severities

- **FAIL** — a broken editor/runtime boundary (`EditorUi`, legacy launcher /
  studio / project-file strings). Must never appear in a correct build; exits
  non-zero.
- **WARN** — known authoring-code-in-game-chunk debt. Today `src/scene/SceneApp.ts`
  still ships the dev `/__save-layout` (and `/__project-dir`) endpoint strings in
  the game chunk (CLAUDE.md Near-Term Order #1). Reported but non-fatal until
  that authoring code is split out. Run with `--strict` once it is, to enforce a
  fully clean bundle.

Current baseline: `EditorUi` is absent from `dist/` (boundary holds); the only
hit is the `/__save-layout` warning above.

### How the boundary holds

`src/main.ts` gates the dynamic `import("@/editor/EditorUi")` behind
`import.meta.env.DEV`, so Vite dead-code-eliminates the whole editor (its chunk
included) from a production build. A correct `dist/` contains no `EditorUi` at
all; if it reappears, the DEV gate or the dynamic-import boundary broke.

### Scope and limits

- Standalone Node script, zero dependencies. Not part of the `tsc` graph or the
  app bundle, so it never affects type-checking or the shipped code.
- Heuristic string scan, not a proof — minification can mangle identifiers.
  Treat it as a fast regression gate, not a security boundary.
- The forbidden list is intentionally precise (high-signal tokens only) to keep
  the gate trustworthy. Extend `FORBIDDEN` in `verify-dist.mjs` as editor-only
  modules move during the migration.

### Not wired into `npm run build` yet

Left as a manual/standalone step on purpose: the roadmap wires it into an npm
script only after the implementation is stable, and this keeps the change
purely additive (new files only) while the render-three extraction is in flight.
