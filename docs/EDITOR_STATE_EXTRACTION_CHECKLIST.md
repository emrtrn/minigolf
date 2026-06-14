# Editor State Extraction Checklist (finish Phase 5)

> Created: 2026-06-14
> Scope: move editor **state ownership** (not just pure helpers) out of the
> 3672-line `src/scene/SceneApp.ts` into `editor/*`, so the shared runtime path
> stops carrying editor state and the monolith shrinks. Completes
> `MIGRATION_ROADMAP.md` Phase 5.
> Depends on: nothing hard; can run in parallel with the runtime-spine work.

Phase 5 so far moved many **pure** editor helpers into `editor/core`,
`editor/gizmos`, and `editor/input`, but `SceneApp` still **owns** selection
state, the command/undo stack, gizmo interaction, and editor input binding.

## Working Rules

- Keep each implementation step small and reversible.
- Run `npm run build:verify` after every implementation step.
- Commit and push only after `build:verify` passes.
- Mark an item `[x]` only after implementation, verification, commit, and push
  are complete.
- Editor Mode must keep working: selection, multi-select, transform gizmo,
  undo/redo, save, and Play.
- Game Mode `/` must import **no** editor state module after each step.

## 0. Tracking

- [x] Create this checklist in `docs/`.

## 1. Selection Store

- [x] Move `selection` + `selectedSelections` (and their emit/equality logic,
  `SceneApp.ts:301-302`) into an `editor/core` selection store that owns the
  state; `SceneApp` delegates to it.
- [x] Verify selection / multi-select / outliner sync are unchanged.

## 2. History / Command Store

- [x] Move the undo/redo stack instance and `executeCommand` orchestration
  (~25 call sites in `SceneApp`) into `editor/core` (contracts already in
  `editor/core/history.ts`); `SceneApp` calls into the store.
- [x] Verify undo/redo, command labels, and history-changed events are unchanged.

## 3. Gizmo Interaction

- [ ] Move gizmo drag/hover/screen-scale logic (`activeGizmoHandle`,
  `hoveredGizmoHandle`, `startGizmoDrag`, `pickGizmoHandle`,
  `updateGizmoScreenScale`) toward `editor/gizmos`, keeping only the viewport
  render hook in `SceneApp`.
- [ ] Verify move/rotate/scale + plane handles + hover highlight are unchanged.

## 4. Editor Input Binding

- [ ] Move `bindEditorPointerEvents` and the editor `handleKeyDown`/`handleKeyUp`
  handlers into `editor/input` wiring; the runtime path binds none of them.
- [ ] Verify editor pointer/keyboard, camera nav, and shortcuts are unchanged.

## 5. Boundary Check

- [ ] Confirm Game Mode imports no editor state module (extend the
  `verify-dist` string check or add an import-boundary check).
- [ ] Record the `SceneApp.ts` line-count reduction in
  `MIGRATION_ROADMAP.md` Phase 5.
