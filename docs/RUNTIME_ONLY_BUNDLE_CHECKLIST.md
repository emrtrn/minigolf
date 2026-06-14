# Runtime-Only / Bundle Debt Checklist

> Created: 2026-06-14
> Scope: get the production game chunk free of editor and dev-endpoint code and
> clear the chunk-size warning. Closes `CLAUDE.md` Near-Term Order item 1 and the
> standing `verify:dist` baseline warning.
> Interacts with: `EDITOR_STATE_EXTRACTION_CHECKLIST.md` (cleaner editor split)
> and `PHASE7_PHYSICS_AUDIO_CHECKLIST.md` (Rapier WASM chunking).

Today `npm run build` emits a single ~826 kB JS chunk (800 kB warning), and
`verify:dist` reports a known-debt warning: `SceneApp` still ships the
`/__save-layout` dev save endpoint string into the game chunk.

## Working Rules

- Keep each implementation step small and reversible.
- Run `npm run build:verify` after every implementation step.
- Commit and push only after `build:verify` passes.
- Mark an item `[x]` only after implementation, verification, commit, and push
  are complete.
- Game Mode `/` and Editor Mode `/?editor` must keep working after each step.
- Production output must stay runtime-only.

## 0. Tracking

- [x] Create this checklist in `docs/`.

## 1. Save Endpoint Isolation

- [x] Move the `/__save-layout` fetch (and any other `/__*` dev endpoint calls)
  out of `SceneApp` into an editor/dev-only module loaded under the dynamic
  `?editor` import.
- [x] Verify the game chunk contains **no** `/__save-layout` string (this clears
  the current `verify:dist` baseline warning).

## 2. Editor Code-Split Audit

- [x] Confirm `EditorUi` and gizmo/authoring-only code are reachable only via the
  dynamic `?editor` import and never pulled into the game entry chunk.
- [x] Extend `verify-dist` checks if any editor-only string is found in `dist/`.

## 3. Chunking

- [x] Add `build.rollupOptions.output.manualChunks` to split the three.js vendor
  (and later Rapier WASM) and the editor bundle into separate chunks.
- [x] Verify the game entry chunk shrinks and the 800 kB warning clears (or is
  intentionally re-tuned via `chunkSizeWarningLimit`).

## 4. Strict Gate

- [x] Make `npm run verify:dist -- --strict` pass with zero known-debt warnings.
- [x] Wire strict verification into `build:verify` (or a CI script) so runtime-only
  output is enforced, not just reported.
