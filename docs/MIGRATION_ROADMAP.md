# Architecture V2 Migration Roadmap

> Created: 2026-06-14
> Workspace: `C:\Users\emret\Desktop\3DGameDev-architecture-v2`
> Source reference: `docs/ARCHITECTURE_PLAN_SOURCE.md`

This clone is the architecture migration workspace. The stable reference remains
`C:\Users\emret\Desktop\3DGameDev`.

The goal is not to rewrite the engine from scratch. The goal is to preserve the
working single-codebase template and gradually move it toward the architecture
plan's module boundaries:

```text
engine/
editor/
builder/
game/
project/
raw-assets/
library/
cooked/
dist/
docs/
```

## Non-Negotiable Rules

- Keep `/` Game Mode and `/?editor` Editor Mode working throughout the migration.
- Keep one shared runtime scene path until an explicit replacement is proven.
- Do not move many systems at once. Each migration step must build.
- Do not let runtime code import editor UI, editor state, gizmos, or dev
  middleware.
- Do not store Three.js or DOM objects in serialized layout/project data.
- Keep production output runtime-only.
- Keep the stable `3DGameDev` repo untouched while this clone evolves.

## Current Starting Point

The clone starts from the single-codebase template:

- `src/scene/SceneApp.ts` contains most shared runtime/editor scene behavior.
- `src/editor/EditorUi.ts` contains editor panels and command UI.
- `src/project/ProjectSystem.ts` loads `public/project.3dgame.json`.
- `vite.config.ts` owns local dev middleware and save validation.
- `public/` holds the manifest, layouts, and assets.
- `npm run build` currently validates TypeScript and production packaging.

## Target Module Mapping

Initial mapping is conceptual. Do not create all folders just to satisfy the
plan; create each boundary when code is actually moved into it.

| Target | Responsibility | Current source |
| --- | --- | --- |
| `engine/core` | lifecycle, event bus, time, logging, subsystem contracts | `src/core`, parts of `SceneApp` |
| `engine/scene` | entity/layout data, transforms, serialization, prefab-ready data | `src/scene/roomLayout.ts`, data types in `SceneApp` |
| `engine/render-three` | Three.js renderer, cameras, lights, mesh binding, render layers | render-specific parts of `SceneApp`, `assetLoader.ts` |
| `engine/assets` | asset IDs, manifest loading, runtime asset lookup | `src/scene/assetLoader.ts`, `public/assets/manifest.json` |
| `engine/input` | runtime/editor input contexts and action mapping | input handling inside `SceneApp` |
| `editor/core` | editor state, commands, selection, undo/redo | `src/editor/EditorUi.ts`, editor parts of `SceneApp` |
| `editor/gizmos` | transform gizmo, grid, snap, helper rendering | gizmo/editor viewport code in `SceneApp` |
| `editor/inspector` | Details panel, property editors, metadata UI | `src/editor/EditorUi.ts`, `metadataSchema.ts` |
| `editor/level-design` | placement, outliner, hierarchy, authoring tools | `EditorUi`, `SceneApp` |
| `builder/web` | production build rules, runtime-only checks, save/build tooling | `vite.config.ts`, future build scripts |
| `project` | local manifest, layouts, prefabs, settings | `public/project.3dgame.json`, `public/layouts` |
| `game` | project-specific runtime rules and demo gameplay | not separated yet |

## Phase 0 - Baseline Lock

Goal: prove this clone starts from a working baseline.

Baseline note (2026-06-14):

- `npm install` was required after cloning because `node_modules/` is not
  versioned.
- `npm run build` passed.
- Vite reported the existing large chunk warning for the main JS bundle
  (`820.77 kB` after minification). Treat this as baseline technical debt, not a
  regression from the migration docs.
- `dist/` string check found no `EditorUi`, `launcher-shell`, `Project Browser`,
  `__studio`, `__project-file`, or `studio` matches.

Tasks:

- Run `npm run build`.
- Record current Game Mode and Editor Mode URLs in `docs/LAUNCH_WORKFLOW.md`.
- Add a short note in this roadmap if the baseline has warnings.

Exit criteria:

- Build passes.
- `dist/` contains no editor chunk or known launcher/dev endpoint strings.
- No source files are moved in this phase.

## Phase 1 - Boundary Skeleton

Goal: create folder boundaries without changing behavior.

Status (2026-06-14): complete.

Added documentation-only boundaries:

- `engine/README.md`
- `editor/README.md`
- `builder/README.md`
- `game/README.md`
- `project/README.md`

No source imports were changed in this phase.

Tasks:

- Add empty or minimal `engine/`, `editor/`, `builder/`, `game/`, and `project/`
  README files that define ownership.
- Keep existing `src/` imports intact.
- Add dependency rules to `docs/ARCHITECTURE.md` for the new folders.

Exit criteria:

- Build still passes.
- New folders are documentation-backed, not fake implementations.

## Phase 2 - Extract Data Contracts

Goal: move serializable types before moving runtime logic.

Status (2026-06-14): complete for the first data-contract extraction slice.

Completed:

- Added `@engine/*`, `@editor/*`, `@builder/*`, `@game/*`, and `@project/*`
  path aliases in TypeScript and Vite.
- Moved the first serializable layout contract into `engine/scene/layout.ts`.
- Moved schema-driven metadata contracts/helpers into
  `engine/scene/metadataSchema.ts`.
- Moved pure transform helpers (`degreesToRadians`, `readRotation`,
  `readScale`, `readPivot`) into `engine/scene/transform.ts`.
- Kept `src/scene/roomLayout.ts` as the compatibility wrapper for layout loading
  and legacy imports.
- Kept `src/scene/metadataSchema.ts` as a compatibility wrapper for legacy
  imports.
- `npm run build` passed after extraction.
- `engine/scene` string/dependency check found no Three.js, DOM, or
  `import.meta` usage.

Tasks:

- Move layout, transform, actor, and metadata data types into `engine/scene`.
- Keep functions as wrappers if needed to avoid breaking imports.
- Verify saved layout JSON does not gain editor-only fields.

Exit criteria:

- Existing layout loads in Game Mode and Editor Mode.
- TypeScript imports show data contracts do not depend on Three.js.

Notes:

- This phase did not move layout loading yet; `src/scene/roomLayout.ts` still
  owns the Vite/public URL fetch helper because it uses `import.meta.env`.

## Phase 3 - Extract Asset System

Goal: isolate asset lookup and manifest loading.

Status (2026-06-14): complete for the first asset-contract extraction slice.

Completed:

- Added `engine/assets/manifest.ts` for serializable asset manifest/catalog
  contracts.
- Moved pure asset lookup helpers into the engine boundary:
  `assetRecordById`, `recordsForGroup`, `totalBytesForGroups`, and
  `editableAssetsFromManifest`.
- Moved type-only consumers to `@engine/assets/manifest` where practical.
- Kept GLTF/Three loading in `src/scene/assetLoader.ts`; this file is still the
  current adapter that fetches public URLs and resolves models.
- Split GLTF/Three loading into `src/scene/gltfModelLoader.ts`, keeping
  `AssetLoader` focused on manifest/catalog/schema fetch orchestration and asset
  record lookup.
- Documented asset ID/path rules in `engine/assets/README.md`.
- `npm run build` passed after extraction.
- `engine/assets` string/dependency check found no Three.js, DOM, or
  `import.meta` usage.

Tasks:

- Move asset manifest types and lookup helpers into `engine/assets`.
- Keep Three.js GLB loading in render adapter code, not in generic asset data.
- Document asset ID/path rules.

Exit criteria:

- Content Browser still lists assets.
- Runtime still loads models from `public/assets/manifest.json`.

Notes:

- Manifest/catalog fetches remain in `src/scene/assetLoader.ts` because they use
  project public URLs. Moving generic fetch/loading to `engine/assets` should
  wait until the project/public URL boundary is migrated.
- The GLTF adapter was later moved in Phase 4; `src/scene/gltfModelLoader.ts`
  remains only as a compatibility export.

## Phase 4 - Extract Render-Three Adapter

Goal: separate Three.js binding from scene/editor state.

Status (2026-06-14): started.

Completed:

- Added `engine/render-three/README.md` to define the render adapter boundary.
- Moved `GltfModelLoader` into `engine/render-three/gltfModelLoader.ts`.
- Kept `src/scene/gltfModelLoader.ts` as a compatibility export.
- Updated `src/scene/assetLoader.ts` to import the GLTF adapter from
  `@engine/render-three/gltfModelLoader`.
- Moved Three.js transform helpers (`composePlacementMatrix`, `eulerDegrees`,
  `applyEulerDegrees`) into `engine/render-three/transforms.ts`.
- Moved material helpers (`isRenderableMesh`, `collectMaterialStats`,
  `convertUnlitModelMaterialsToLit`) into `engine/render-three/materials.ts`.
- Moved pure light naming/default helpers into `engine/scene/lights.ts`.
- Moved Three.js light object creation/sync, shadow, and gizmo helpers into
  `engine/render-three/lights.ts`.
- Moved WebGLRenderer creation/shadow defaults and render-stat reading into
  `engine/render-three/renderer.ts`.
- Moved scene camera creation and responsive viewport/FOV application into
  `engine/render-three/camera.ts`.
- Moved GLTF-to-scene binding for instanced static meshes and character objects
  into `engine/render-three/models.ts`.

Tasks:

- Move renderer/camera/light/mesh binding code into `engine/render-three`.
- Keep editor overlay rendering as a distinct layer.
- Avoid storing Three.js objects in layout/component data.

Exit criteria:

- Game Mode renders the same scene.
- Editor Mode still has grid, selection, and transform visuals.
- Build passes after the move.

## Phase 5 - Extract Editor Modules

Goal: make editor-only code visibly editor-owned.

Status (2026-06-14): started.

Completed:

- Added `editor/core/selection.ts` for editor selection cloning, identity,
  parsing, equality, selected-map state helpers, and deterministic
  delete/restore ordering helpers.
- Added `editor/core/layoutSnapshots.ts` for layout actor/metadata deep-copy
  helpers and transform equality checks used by undo/redo snapshots.
- Added `editor/core/editableScene.ts` for editor-facing project info, snap
  settings, scene object, selection transform, and world settings contracts
  consumed by the editor UI.
- Added `editor/core/history.ts` for editor command contracts plus undo/redo
  history stack behavior.
- Added `editor/core/hierarchy.ts` for selection grouping, direct child lookup,
  and cycle-safe descendant traversal helpers.
- Added `editor/core/ids.ts` for collision-checked editor id generation used by
  grouping/hierarchy helpers.
- Added `editor/core/layoutTransforms.ts` for pure layout rotation/scale write
  helpers used when committing editor transform changes.
- Added `editor/core/numeric.ts` for numeric clamp, rounding, and snap
  display/value helpers.
- Kept selection state ownership in `SceneApp` for now; this step only moved
  pure editor-core helper logic.

Tasks:

- Move editor command/selection/undo state into `editor/core`.
- Move Details panel code toward `editor/inspector`.
- Move gizmo and placement code toward `editor/gizmos` and
  `editor/level-design`.

Exit criteria:

- `src/main.ts` still dynamically imports editor entry only in dev.
- Game Mode imports no editor module.
- Editor Mode supports selection, transform, save, and Play.

## Phase 6 - Builder Web Checks

Goal: turn runtime-only packaging into an explicit check.

Status (2026-06-14): started.

Completed:

- Added `builder/web/verify-dist.mjs` and `builder/web/README.md`.
- Added `npm run verify:dist` for checking the current `dist/`.
- Added `npm run build:verify` for build + runtime-only package verification.
- Kept `npm run build` unchanged while `/__save-layout` remains warning-only
  authoring-code debt.

Tasks:

- Add a small build verification script under `builder/web`.
- Check `dist/` for editor strings, dev endpoint strings, and authoring-only
  files after `npm run build`.
- Wire it into an npm script after the implementation is stable.

Exit criteria:

- `npm run build` passes.
- Package verification reports runtime-only output.

## Phase 7 - Vertical Slice Engine

Goal: prove the architecture with a tiny playable scene.

Required slice:

- scene load/save;
- entity placement;
- mesh render;
- basic collider/physics placeholder or Rapier-backed implementation;
- audio placeholder or Web Audio-backed one-shot;
- input action map;
- behavior/script update;
- runtime-only build.

Exit criteria:

- The demo proves the engine pipeline, not a full game.
- Second-game reuse is plausible without rewriting render, asset, scene, input,
  audio, and build systems.

## Deferred

- Blueprint or node graph.
- Shader/material graph.
- Terrain editor.
- marketplace/plugin ecosystem.
- multiplayer replication.
- broad Unity/Unreal replacement scope.
