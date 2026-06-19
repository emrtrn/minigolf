# Forge Architecture Contract

> Created: 2026-06-13 | Updated: 2026-06-16
> Scope: architecture-v2 migration workspace for the single-codebase template.
> Migration status: complete (phases 0-7 done); this file is the steady-state
> contract going forward.

This document is the working contract for future Codex/Claude tasks. If a task
conflicts with this file, update the contract first or call out the conflict
before changing code.

## Direction

**Forge** is a reusable, single-codebase Three.js game template. The
player-facing route and the editor viewport now use separate shells over shared
scene/runtime helpers:

- `RuntimeSceneApp` owns the Game Mode shell and must stay free of editor
  imports.
- `SceneApp` owns the Editor Mode viewport shell and hosts editor-only
  controllers through narrow scene callbacks.
- Shared render, scene-build, and subsystem concerns should move into explicit
  scene runtime helpers instead of being copied between the two shells.

- Default route `/` is Game Mode: runtime render, no editor UI.
- `/?editor` is Editor Mode: `SceneApp` plus `EditorUi`.
- `?debug` adds the perf overlay in either mode.
- A new game starts by copying this repository, then replacing the GDD, assets,
  layouts, and project-specific game content.
- The editor travels with each game during development, but is gated behind the
  dev-only `?editor` dynamic import and is excluded from production builds.
- The stable reference repo is `C:\Users\emret\Desktop\3DGameDev`; use it to
  compare behavior if the migrated boundaries ever drift from it.
- `docs/ARCHITECTURE_PLAN_SOURCE.md` is the imported source plan.

Removed architecture:

- Project Browser / launcher route.
- External project references in `projects/*.project-ref.json`.
- `studio` CLI and external-project packaging scripts.
- External-project dev middleware such as `/__project`, `/__project-file`,
  `/__recent-projects`, `/__studio/*`, and `/__select-directory`.

Kept dev middleware:

- `/__save-layout`: writes local authoring data under this repo's `public/`.
- `/__project-dir`: read-only Content Browser directory tree scoped to `public/`.

## Ownership Boundaries

Template/editor code lives in this repo:

- `src/scene/`: `RuntimeSceneApp`, editor `SceneApp`, shared scene runtime
  helpers for renderer/camera/world-lighting setup, scene loading, and save
  hooks.
- `src/editor/`: editor UI, selection panels, authoring affordances.
- `src/project/`: local manifest loading and project public-path helpers.
- `public/project.3dgame.json`: this copy's project identity and editor settings.
- `public/layouts/`: local scene/layout data.
- `public/assets/`: local runtime assets and manifests.
- `tools/`: local dev-server helpers.
- `docs/`: current architecture and workflow notes.

Project-specific game work also lives in the copied repo:

- game rules, scoring, missions, save model, and runtime UI;
- GDD and design docs;
- project assets, layouts, prefabs, data, and metadata;
- production build output in `dist/`.

Final production output must contain only runtime game files:

- `index.html`;
- bundled runtime JS/CSS;
- runtime assets and public data required by the game.

Final output must not contain editor UI, authoring middleware, GDD, internal
docs, raw authoring assets, or local dev scripts.

## Dependency Rules

- Game Mode (`RuntimeSceneApp` and the `/` branch in `src/main.ts`) must not
  import `src/editor/*` or `editor/*`.
- The `EditorUi` import must remain behind `?editor` and `import.meta.env.DEV`.
- Editor code may depend on shared scene/project APIs and editor-owned
  controller modules.
- Shared project/layout data must stay plain JSON or serializable TypeScript
  types; do not store Three.js objects in saved data.
- Runtime code should load project files through manifest-relative public URLs,
  not absolute local filesystem paths.
- Editor state such as selection, panel expansion, hover, and gizmo state must
  not be written into layout files.

Top-level migration dependency rules:

- `engine/*` must not import `editor/*`, `builder/*`, or `game/*`.
- `editor/*` may import `engine/*`, but must remain dev/editor-route owned.
- `game/*` may import `engine/*`, but must not import `editor/*`.
- `builder/*` may read project/engine metadata and built output, but should not
  become runtime code.
- `project/*` is data/config ownership, not runtime implementation.
- `src/*` remains the active implementation; the `engine/*`, `editor/*`,
  `builder/*`, and `game/*` boundaries hold the extracted modules.

## Project Manifest

File:

```text
public/project.3dgame.json
```

Role: this copied game's local identity and editor/runtime configuration.

Current minimum shape:

```json
{
  "schema": 1,
  "name": "forge-template",
  "type": "three-game",
  "version": "0.1.0",
  "entry": "src/main.ts",
  "publicDir": "public",
  "editor": {
    "defaultScene": "layouts/render-test-room.json",
    "assetManifest": "assets/manifest.json",
    "metadataSchema": "assets/metadata-schema.json",
    "gridSize": 1,
    "gridEnabled": true,
    "snapRotationDeg": 15,
    "snapRotationEnabled": true,
    "snapScale": 0.1,
    "snapScaleEnabled": false
  },
  "scripts": {
    "preview": "npm run dev",
    "build": "npm run build",
    "package": "npm run build"
  },
  "output": {
    "distDir": "dist"
  }
}
```

Rules:

- Paths inside `editor` are relative to the public root.
- The manifest is small and hand-readable.
- Schema changes require an explicit migration note.
- `editor.previewUrl` may point Play/Test to an external runtime during a
  migration, but the default path is `/`.

## Authoring Files

### Runtime Asset Manifest

Suggested path:

```text
public/assets/manifest.json
```

Role: runtime and editor asset loading metadata.

Rules:

- Runtime loaders use this for final asset paths and IDs.
- Content Browser can derive placeable assets from it unless a richer catalog is
  added later.
- Saved scenes reference asset IDs or manifest entries, not absolute paths.

### Level/Layout JSON

Suggested path:

```text
public/layouts/<name>.json
```

Role: scene object data authored by the editor and consumed by Game Mode.

Rules:

- Store stable IDs and transforms, not Three.js objects.
- Keep editor-only state out of layout files.
- Save through `/__save-layout` in dev; production builds have no write
  middleware.
- New saved fields must be allowlisted in the `vite.config.ts` save validator.

### Metadata Schema

Suggested path:

```text
public/assets/metadata-schema.json
```

Role: schema-driven gameplay metadata for the Details panel.

Rules:

- Gameplay metadata must stay serializable.
- Editor controls may expose fields, but game rules interpret them at runtime.

## Runtime Modes

### Game Mode

Purpose: player-facing game route.

Allowed:

- `RuntimeSceneApp` and shared scene runtime helpers;
- runtime assets and layout data;
- game UI and game systems;
- debug overlay only when explicitly requested.

Not allowed:

- editor panels;
- transform gizmo UI;
- authoring saves;
- dev-only directory/write middleware.

### Editor Mode

Purpose: local authoring in development.

Allowed:

- editor panels;
- selection and transform tools;
- gizmo rendering;
- authoring overlays;
- local save/load through dev middleware.

Not allowed:

- relying on editor code in production builds;
- writing outside the local copied repo's public data.

### Package Mode

Purpose: produce static web output.

Current command:

```text
npm run build
```

Rules:

- Build output goes to `dist/`.
- The editor dynamic import is dev-gated and should not produce an editor chunk.
- Dev middleware is Vite-dev-only and must not exist in production output.

## Undo/Redo Command Model

Editor actions that mutate project files or editor-authored scene state should
use commands.

Command shape:

```ts
interface EditorCommand {
  id: string;
  label: string;
  do(): void | Promise<void>;
  undo(): void | Promise<void>;
}
```

Rules:

- Commands must capture enough previous state to undo deterministically.
- Continuous drags should collapse into one command at pointer-up.
- Save operations persist the current document state; they are not themselves
  undo history.
- File writes happen after command application through project-system APIs.

Initial command candidates:

- `AddObjectCommand`
- `DeleteObjectCommand`
- `TransformObjectCommand`
- `UpdatePropertyCommand`
- `RenameObjectCommand`
- `CreatePrefabCommand`

## Directory Intent

```text
Forge/
  builder/       build/package verification boundary
  docs/          current architecture, roadmap, and workflow notes
  editor/        future editor-only module boundary
  engine/        future runtime engine module boundary
  game/          future project-specific runtime code boundary
  project/       future project config/data boundary
  public/        local manifest, layouts, and runtime assets for this copy
  src/core/      shared utility/core code
  src/editor/    dev-only editor UI and authoring panels
  src/project/   local project manifest/path helpers
  src/scene/     RuntimeSceneApp, editor SceneApp, shared scene runtime helpers
  tools/         local dev-server helpers
  dist/          production build output
```

Package boundaries such as `engine/core`, `engine/scene`,
`engine/render-three`, `engine/assets`, `editor/core`, `editor/gizmos`,
`editor/inspector`, `builder/web`, `project`, and `game` now hold real
extracted code. Keep new code inside the boundary that owns it; do not
introduce empty architecture for its own sake.

## Not In Scope Yet

- full pnpm/Turborepo migration;
- node editor;
- shader graph or material graph;
- full Unreal-style Material Instance stack; if material reuse needs it later,
  prefer Material Instance Lite / Material Variant: parent canonical material plus
  field overrides resolved to a normal Three.js material;
- physics editor;
- generic engine marketplace/plugin ecosystem;
- reviving the Project Browser / external-project system.
