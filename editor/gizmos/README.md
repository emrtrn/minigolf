# Editor Gizmos

Editor transform gizmo helpers live here as they are extracted from `SceneApp`.

Current files:

- `axes.ts`: transform gizmo axis contracts and axis-index helpers.
- `handles.ts`: transform gizmo handle contracts, materials, and pickable registration.
- `interaction.ts`: active/hovered handle state, handle picking, screen-scale,
  and plane/screen-basis interaction helpers.

Rules:

- Gizmo modules may depend on editor-core and engine data contracts.
- Runtime game code must not import this folder.
- Three.js helper rendering can move here when the gizmo renderer is extracted.
