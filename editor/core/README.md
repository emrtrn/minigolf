# Editor Core

Editor-owned state helpers live here as they are extracted from `SceneApp` and
`src/editor`.

Current files:

- `selection.ts`: editor selection cloning, identity, parsing, equality, and
  deterministic delete/restore ordering helpers.
- `layoutSnapshots.ts`: layout actor/metadata deep-copy helpers and transform
  equality checks used by editor undo/redo snapshots.
- `editableScene.ts`: editor-facing project info, snap settings, scene object,
  selection transform, and world settings contracts consumed by the editor UI.
- `history.ts`: editor command contracts plus undo/redo history stack behavior.
- `layoutTransforms.ts`: pure layout rotation/scale write helpers used when
  committing editor transform changes.
- `numeric.ts`: numeric clamp, rounding, and snap display/value helpers.

Rules:

- May depend on engine data contracts.
- Must not import Three.js, DOM APIs, project dev middleware, or runtime render
  adapters unless a later editor-only layer explicitly needs them.
- Must not write runtime layout/project data directly.
