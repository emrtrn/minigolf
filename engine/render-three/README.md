# Engine Render Three

This folder owns Three.js adapter code as it is extracted from the current
`src/scene` implementation.

Current files:

- `gltfModelLoader.ts`: GLTFLoader + meshoptimizer adapter with per-asset
  promise caching.
- `transforms.ts`: Three.js transform helpers for layout placement matrices and
  Euler-degree application.
- `materials.ts`: renderable mesh guard, material stats, and unlit-to-lit
  material conversion helpers.
- `lights.ts`: Three.js light shadow configuration plus editor light icon and
  wire gizmo construction/disposal helpers.

Rules:

- Three.js runtime objects may live here.
- Serializable scene, asset, and project data must not depend on this folder.
- Editor overlays and gizmos may use this adapter later, but editor state should
  remain editor-owned.
