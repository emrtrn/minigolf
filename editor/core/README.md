# Editor Core

Editor-owned state helpers live here as they are extracted from `SceneApp` and
`src/editor`.

Current files:

- `selection.ts`: editor selection identity, parsing, equality, and deterministic
  delete/restore ordering helpers.
- `layoutSnapshots.ts`: layout actor/metadata deep-copy helpers and transform
  equality checks used by editor undo/redo snapshots.
- `editableScene.ts`: editor-facing scene object, selection transform, and world
  settings contracts consumed by the editor UI.

Rules:

- May depend on engine data contracts.
- Must not import Three.js, DOM APIs, project dev middleware, or runtime render
  adapters unless a later editor-only layer explicitly needs them.
- Must not write runtime layout/project data directly.
