# Forge Improvement Checklist

> Created: 2026-06-15
> Scope: post-migration cleanup + hardening, ordered by value/effort.
> Source: project analysis on 2026-06-15 (tsc clean, 31/31 engine tests pass).

This file is a **cross-session work contract**. Each item is self-contained:
problem, evidence, root cause, plan, acceptance criteria, and verification
commands. Update the status box and the Progress Log as work lands so any
future session (Claude/Codex) can resume without re-deriving context.

## Status Legend

- `[ ]` not started
- `[~]` in progress (see Progress Log for where it stopped)
- `[x]` done and verified

## Overview

| # | Item | Severity | Effort | Status |
|---|------|----------|--------|--------|
| 1 | Editor CSS leaks into production bundle | High (contract violation) | Low | `[x]` |
| 2 | Rapier physics always loaded at runtime | Medium (2.18 MB) | Low–Med | `[x]` |
| 3 | Extract editor-only logic out of `SceneApp` | Medium (maintainability) | High | `[ ]` |
| 4 | Smoke tests for load/save + game/editor split | Medium (safety net) | Medium | `[~]` |

Always-true gate before marking any item `[x]`:

```bash
npx tsc --noEmit        # must be clean
npm run test:engine     # 31/31 (or more) must pass
npm run build           # must succeed
```

---

## Item 1 — Editor CSS leaks into the production bundle  `[x]`

> Done 2026-06-15. Editor styles moved to `src/editor/editorUi.css` (imported
> by `EditorUi.ts:3`); `src/style.css` keeps only runtime/canvas/overlay rules.
> Verified: production `dist/assets/index-*.css` is 0.72 kB with **0** editor
> selectors; no `editor-shell` anywhere in `dist`. tsc + 31 engine tests +
> build all green.

**Severity:** High — violates the architecture contract.

### Problem

`docs/ARCHITECTURE.md` states production output *"must not contain editor UI"*.
The editor **JS** is correctly dead-code-eliminated (dynamic import + `import.meta.env.DEV`
gate in `src/main.ts:29`), but the editor **CSS** is not: it ships in the
production game bundle.

### Evidence

- `index.html:15` statically links the single stylesheet: `<link rel="stylesheet" href="/src/style.css" />`.
- `src/style.css` is 1026 lines and contains **87** editor selectors
  (`.editor-*`, `.outliner-*`, gizmo/details/content-browser styles).
- Editor styles begin at `src/style.css:65` (`body.editor-mode #debug-stats { ... }`)
  and run to the end of the file. Lines 1–64 are game/runtime only
  (canvas, `#ui-overlay`, `#debug-stats`).
- Confirmed leak: `dist/assets/index-*.css` contains `.editor-shell`,
  `.editor-outliner`, etc. (28 `outliner` occurrences in the built CSS).
- `EditorUi` currently imports **no** CSS; it only toggles a body class
  (`document.body.classList.add("editor-mode")` at `src/editor/EditorUi.ts:94`).

### Root cause

All CSS lives in one statically-linked stylesheet, so Vite has no way to scope
the editor portion to the (dynamically imported, dev-gated) editor chunk.

### Plan

1. Create `src/editor/editorUi.css` and move the editor-only rules
   (`src/style.css:65` → EOF) into it. Keep lines 1–64 (canvas, overlay,
   debug-stats) in `src/style.css`.
   - Watch for shared/runtime selectors that happen to live below line 64 —
     re-audit with `grep -nE "^[.#]" src/style.css` before cutting; only move
     rules that are editor/outliner/gizmo/details/content-browser scoped.
2. Add a side-effect import at the **top** of `src/editor/EditorUi.ts`:
   `import "./editorUi.css";`. Because `EditorUi` is only reached through the
   dynamic, DEV-gated import in `src/main.ts`, Vite emits this CSS into the
   editor chunk and excludes it from the production build.
3. Rebuild and confirm the production CSS no longer contains editor selectors.

### Acceptance criteria

- `npm run build` then: production `dist/assets/index-*.css` contains **0**
  `.editor`/`.outliner`/gizmo selectors.
- `/?editor` in dev still renders fully styled (no visual regression).
- `/` (game mode) is visually unchanged.
- tsc / engine tests / build all green.

### Verification

```bash
npm run build
grep -cE "\.editor|\.outliner" dist/assets/index-*.css   # expect 0
# manual: open /?editor and / in dev, eyeball both
```

---

## Item 2 — Rapier physics always loaded at runtime  `[x]`

> Done 2026-06-15. `PhysicsSubsystem.init()` now derives the Rapier load from
> scene content: with `backend: "rapier"` it loads Rapier only when
> `this.bodies.length > 0` (i.e. the scene yielded collider components),
> otherwise it stays on the placeholder backend (`update()` already falls back
> to AABB overlap). Added `usesRapier()` accessor + an engine test proving a
> collider-free scene never loads Rapier. `vendor-physics` stays a separate
> lazy chunk. **Nuance:** the bundled demo scene (`render-test-room.json`) has
> 15 placements with no explicit `collision` field, and the legacy adapter
> defaults collision **on**, so the demo still (correctly) loads Rapier. A
> copied game that authors a collider-free scene (or sets `collision: false`)
> now skips the 2 MB. tsc + 32 engine tests + build all green.

**Severity:** Medium — `vendor-physics` is 2.18 MB and currently loads for
every game on startup, even with no physics in the scene.

### Problem

The Rapier runtime ships as its own chunk and is dynamically imported (good),
but the runtime app unconditionally selects the `rapier` backend, so the
dynamic import always fires during `init()`.

### Evidence

- Production bundle sizes: `vendor-physics` **2184.9 KB**, `vendor-three`
  597.9 KB, `vendor-meshoptimizer` 111.0 KB, `index` (game) 32.4 KB.
- Already code-split: `vite.config.ts:645` routes `@dimforge/*` to
  `vendor-physics`; `engine/physics/physicsSubsystem.ts:57` does
  `await import("@dimforge/rapier3d-compat")` (the line-29 `typeof import` is
  type-only and erased).
- The cost is unconditional: `src/scene/RuntimeSceneApp.ts:92` constructs
  `new PhysicsSubsystem({ backend: "rapier" })` always.
- A `placeholder` backend already exists (`PhysicsBackend = "placeholder" | "rapier"`),
  and engine tests cover both backends.

### Root cause

Backend is hard-coded to `rapier` regardless of whether the loaded scene
actually needs physics.

### Plan (decide approach first — see Open Questions)

1. Make the physics backend conditional. Candidate signal sources, cheapest first:
   - project manifest flag (e.g. `editor`/runtime config in
     `public/project.3dgame.json`), or
   - derived from the scene document: only use `rapier` when the layout yields
     entities with collider components (`readColliderComponent`), else
     `placeholder` (or skip physics entirely).
2. Ensure the `rapier` dynamic import is reached **only** when the chosen
   backend is `rapier`, so `vendor-physics` is fetched lazily/on demand.
3. Mirror the same decision in `SceneApp` (editor) if it also instantiates
   physics, so editor and runtime stay consistent.

### Acceptance criteria

- A physics-free scene loads without fetching `vendor-physics` (verify via
  network panel or build-time reasoning).
- A scene with colliders still gets working Rapier physics (engine tests stay
  green; manual check of the collision/audio demo cue).
- No change to deterministic test expectations.

### Open questions (RESOLVED 2026-06-15)

- ~~Should "no physics needed" mean `placeholder` backend or **no** physics
  subsystem registered at all?~~ → **Keep the placeholder backend.** The
  subsystem stays registered with `backend: "rapier"` as a preference but does
  not load Rapier; physics queries stay deterministic.
- ~~Where should the physics-needed signal live — manifest flag vs. derived
  from scene colliders?~~ → **Derive from scene colliders** (automatic; zero
  config). Implemented as a `bodies.length` gate inside `init()`.

### Verification

```bash
npm run build            # vendor-physics still a separate chunk
npm run test:engine      # both backends still pass
# manual: load a collider-free scene, confirm vendor-physics is not requested
```

---

## Item 3 — Extract editor-only logic out of `SceneApp`  `[ ]`

**Severity:** Medium — maintainability. This is CLAUDE.md "Near-Term Order #1".

### Working agreement (decided 2026-06-15)

- **Branch:** all Item 3 work happens on `refactor/sceneapp-split` (off `main`).
  Open a PR when the milestone below is reached. Keep `main` clean.
- **Auto-commit, do not ask:** this is a large refactor done in many small,
  build-passing pieces. After **each** small piece that passes the gate
  (`npx tsc --noEmit` + `npm run test:engine` + `npm run build`), commit with a
  semantic message and `git push` — **without pausing to ask the user** whether
  to continue or whether to commit. The user has authorized this explicitly.
  First push uses `git push -u origin refactor/sceneapp-split`.
- Never commit a broken intermediate state: only commit after the gate is green.
- Update the Progress Log below after each piece so a fresh session can resume.

### Problem

`src/scene/SceneApp.ts` is **3999 lines** and mixes the shared render path with
editor-only authoring concerns (gizmos, picking, selection plumbing, transform
handles). The runtime path already has a slimmer `RuntimeSceneApp` (374 lines),
but `SceneApp` remains a monolith.

### Evidence

- `src/scene/SceneApp.ts` — 3999 lines (largest file in the repo).
- `src/scene/RuntimeSceneApp.ts` — 374 lines (game-only shell already exists).
- Editor module boundaries already exist and hold extracted code:
  `editor/gizmos/*`, `editor/core/*`, `editor/input/*`, `editor/render-three/*`.

### Root cause

The architecture-v2 migration extracted many helpers into `engine/*` and
`editor/*`, but `SceneApp` still owns a large amount of editor-authoring code
inline.

### Plan (incremental — keep every step build-passing)

1. Map `SceneApp`'s responsibilities into buckets: shared render (keep) vs.
   editor authoring (move). Produce the inventory in the Progress Log first.
2. Move editor-only concerns into `editor/*` (or a new editor scene controller)
   in small, individually building+testing commits. Likely candidates: gizmo
   interaction wiring, selection/pick handling, transform-handle math,
   authoring overlays.
3. Prefer composition: have the editor controller drive a shared scene API that
   both `SceneApp` and `RuntimeSceneApp` expose, reducing duplication between
   the two app shells (see Item 3b risk note).
4. Stop when `SceneApp` no longer carries editor authoring logic that the game
   bundle would otherwise need to tree-shake around.

### Item 3b note — `SceneApp` / `RuntimeSceneApp` duplication

Two scene shells now exist and share large amounts of logic (asset loading,
camera, render stats, layout→scene building). They are guarded by engine
"render parity" tests but can still drift. While doing Item 3, consolidate
shared logic into one place rather than copying it.

### Acceptance criteria

- `SceneApp.ts` line count materially reduced (target: under ~2500 as a first
  milestone; refine later).
- No editor symbols imported by the game/runtime path
  (`grep` of `RuntimeSceneApp` + `main` game branch shows no `@/editor` /
  `editor/*` imports).
- Editor still fully functional at `/?editor`; tsc/tests/build green at every
  intermediate commit.

### Verification

```bash
npx tsc --noEmit && npm run test:engine && npm run build
# editor smoke: open /?editor, exercise select/move/rotate/scale, save
```

---

## Item 4 — Smoke tests for load/save + game/editor split  `[~]`

**Severity:** Medium — safety net. CLAUDE.md "Near-Term Order #2".

### Problem

Current automated coverage (`tools/engine-tests.ts`, 31 checks) exercises the
engine core (entities, layout serialization, render parity, subsystems) but not
the **application shells**: layout load→save round-trip and the
game-vs-editor mode split.

### Evidence

- Test harness is a dependency-free node runner: `tools/run-engine-tests.mjs`
  bundles `tools/engine-tests.ts` with esbuild and runs `check("name", fn)`
  assertions. New suites can follow the same pattern (no framework needed).
- Save path: `/__save-layout` dev middleware in `vite.config.ts` (with the save
  validator allowlist), `src/editor/layoutSaver.ts`.
- Mode split: `src/main.ts` (DEV + `?editor` gate) and `RuntimeSceneApp` vs
  `SceneApp`.

### Plan

1. **Load/save round-trip:** load `public/layouts/render-test-room.json`,
   serialize back, assert stable IDs/transforms and that the save validator
   does not silently drop allowlisted fields (`applyTransformFields` /
   `validateLightActor` in `vite.config.ts`). Guard against the documented
   "allowlist gotcha".
2. **Mode split (static guard):** assert the production/runtime import graph
   never reaches `src/editor/*`. Cheapest form: a build-time check (extend
   `builder/web/verify-dist.mjs`) that `dist` contains no editor JS/CSS
   selectors — this also locks in Item 1's fix.
3. Wire new checks into `npm run test:engine` (or a sibling script) so they run
   in `npm run build:verify`.

### Acceptance criteria

- New checks run in the existing harness and pass.
- A deliberately broken save field (not allowlisted) is caught by the test.
- The dist editor-leak guard fails if editor CSS/JS reappears in `dist`.

### Verification

```bash
npm run test:engine
npm run build:verify     # build + engine tests + verify-dist --strict
```

---

## Progress Log

Append newest entries at the top. Record: date, item #, what changed, where it
stopped, and any decision made (so the next session does not re-litigate it).

- *2026-06-15* — **Item 4 started — save validator extracted + load/save tests.**
  (New branch `test/item4-smoke-tests` off the Item 3 tip / PR #1. Started Item 4
  per the agreed sequence: merge PR #1 → Item 4 safety net → resume `<2500`.)
  Extracted the entire `/__save-layout` payload validator out of `vite.config.ts`
  into a dependency-free `tools/saveValidator.ts` (`validateSavePayload`,
  `validateLayout`, `validateLightActor`, `validatePlacement`,
  `applyTransformFields`, `EditorSettingsPatch`); `vite.config.ts` imports it.
  Behavior-identical (the saved layout validates to itself). Added **3 engine
  tests** (41 → 44): load/save round-trip idempotency on the real
  `render-test-room.json`, plus two allowlist-footgun guards proving unknown
  placement/light fields are dropped while known ones survive. This directly
  guards the CLAUDE.md "save-validator allowlist gotcha". Gate green (tsc, 44
  tests, build). Next Item 4 sub-pieces: (2) dist editor-leak static guard in
  `builder/web/verify-dist.mjs`; then resume Item 3 `<2500`.

- *2026-06-15* — **Item 3 Piece 7 done — pivot-corrected position extracted + tested.**
  Moved the pure `pivotCorrectedPosition` (origin that keeps a pivot world point
  fixed under rotation+scale: p' = pivotWorld − R·S·pivotLocal) into
  `editor/render-three/transformMatrices.ts` next to `transformToMatrix`/
  `matrixToTransform`. `updateRotateDrag`/`updateScaleDrag` import it; dropped the
  now-unused `Quaternion` + `eulerDegrees` imports. Added 1 engine test
  (41 checks). `SceneApp.ts` 3203 → 3179 lines. Gate green (tsc, 41 tests,
  build).

  **Milestone status / handoff.** Session total: `SceneApp.ts` **3999 → 3179
  (−820, ~20.5%)** across 7 green, pushed, editor-only pieces (gizmo builders,
  camera controller, scene picker, scene-object builders, drag math, wall snap,
  pivot math) + **9 new engine tests** (32 → 41). The <2500 first-milestone
  target is **not yet reached**: per the 2026-06-15 user decision (safe + tests),
  the remaining ~680 lines are deeply-coupled *interactive command orchestration*
  (gizmo drag apply/commit, duplicate/delete, group/parent, metadata/flags,
  world-settings, light CRUD). Their *pure cores were already extracted in prior
  migrations* (commandLabels, hierarchy, selection comparators, layoutSnapshots
  clones) and in these 7 pieces; what remains in `SceneApp` is orchestration glue
  that mutates `this.layout` + the live scene + the command stack. Cutting it
  further means an `EditorSceneController` that owns that state and is driven by a
  shared scene API — a larger structural change to do deliberately (ideally after
  Item 4's load/save smoke tests give the command paths a net). Opening a PR for
  this safe milestone; `<2500` continues next.

- *2026-06-15* — **Item 3 Piece 6 done — wall-snap geometry extracted + unit-tested.**
  Moved the pure `computeWallSnap` (nearest-wall slide + interior-facing
  orientation) into `editor/render-three/wallSnap.ts`, taking the asset/room
  AABBs as parameters (caller now guards `localBounds`/`getRoomBounds`). Both
  callers (`performWallSnap`, `addAssetAt`) delegate; behavior identical (the
  old null-return path == the new bounds/room guard). Added 1 engine test
  (40 checks) pinning the +Z-wall snap (180° + flush slide to 4.9).
  `SceneApp.ts` 3272 → 3203 lines. Gate green (tsc, 40 tests, build). Running
  total: 3999 → 3203 (−796, ~20%) across 6 green, pushed, editor-only pieces.
  Next: continue pure extractions (selection helpers, duplicate/clone logic).

- *2026-06-15* — **Item 3 Piece 5 done — pointer-drag transform MATH extracted + unit-tested.**
  Per the agreed approach (safe + tests; user decision 2026-06-15): extracted the
  *pure* drag arithmetic into `editor/gizmos/transformDrag.ts`
  (`freeMoveDragPosition`, `planeMoveDragPosition`, `axisYMoveDragPosition`,
  `localAxisMoveDragPosition`, `worldAxisMoveDragPosition`, `rotateDragRotation`,
  `scaleDragScale` + `DragSnapSettings`). The interactive *orchestration*
  (raycasts via the picker, applying transforms, pivot correction, cascade,
  emits) stays in `SceneApp.updateMove/Rotate/ScaleDrag` — only the verbose,
  error-prone math moved. Added **7 headless engine tests** pinning the
  arithmetic (32 → 39 checks): free/world/vertical/plane/local move, rotate
  degrees+snap, and scale uniform/axis/planar/0.05-floor. Dropped now-unused
  `axisToIndex`/`planeAxisIndices`/`degreesToRadians` imports. `SceneApp.ts`
  3360 → 3272 lines. Gate green (tsc, 39 tests, build). This is the
  no-test-coverage-risk mitigation: the drag math now has a safety net the
  inline version never had. Next: wall/surface snapping geometry (also pure).

- *2026-06-15* — **Item 3 Piece 4 done — scene-object view-model builders extracted.**
  New `editor/core/sceneObjects.ts`: `buildSceneObjects(layout, deps)` (Outliner
  rows, empty metadata) and `buildEditableSelection(layout, selection, deps)`
  (Details payload, real cloned metadata). Pure layout→view-model transforms;
  deps are `assetCategory` (manifest lookup, stays in SceneApp), `isSelected`
  (selection store), and the resolved `staticObjectsCastShadow` flag.
  `SceneApp.getSceneObjects`/`getSelected` now delegate. Dropped the now-unused
  `cloneMetadata` import (`noUnusedLocals` confirmed it). Logic byte-identical.
  `SceneApp.ts` 3514 → 3360 lines. Gate green (tsc, 32 tests, build). These
  builders are deterministic and a good Item 4 unit-test target later. Next:
  pointer-drag transform math.

- *2026-06-15* — **Item 3 Piece 3 done — viewport raycasting extracted (ScenePicker).**
  (Re-scoped: did picking before drag math, since the drag methods reuse
  `clientToFloor`/`clientToPlane`.) New `editor/render-three/scenePicker.ts`
  (`ScenePicker`) owns the scratch raycaster + NDC vector + floor plane and the
  pointer→scene resolution: `pickSelection`, `pickGizmoHandle`, `clientToFloor`,
  `clientToSurface`, `clientToPlane`, `raycastSurfaceBelow`, `isSelfHit`,
  `setPointerNdc`. It reads the live scene through supplier callbacks
  (`pickables`/`surfacePickables`/`gizmo`) so it stays correct as the scene
  mutates. SceneApp keeps its own `raycaster`+`floorPlane` only for the
  selection-aware orbit target (`getCameraOrbitTarget`); the `pointerNdc`+
  `floorHit` fields and the moved imports (`findParent*`, `Intersection`,
  `Vector2`, `pickGizmoHandle`) were dropped. Call sites delegate to
  `this.picker.*`. Logic byte-identical. `SceneApp.ts` 3615 → 3514 lines. Gate
  green (tsc, 32 tests, build; editor-only). Next: drag-math controller (reuses
  the picker), then wall/surface snapping.

- *2026-06-15* — **Item 3 Piece 2 done — editor camera controller extracted.**
  New `editor/input/editorCameraController.ts` (`EditorCameraController`) owns
  all viewport-camera navigation state (fly/orbit/pan/dolly, yaw/pitch, move
  speed, pressed keys, scratch vectors) and methods (begin/end navigation,
  alt-drag, updateDrag, look, wheel, per-frame `update`, angle sync). It takes
  the shared `SceneApp` camera + canvas plus callbacks: `getOrbitTarget`
  (selection-aware, stays in SceneApp), `onInteractionStart` (clears pending
  gizmo drag / asset placement), and `onStatus`. SceneApp now holds one
  `cameraController` field; the rAF loop, `bindEditorInput` wiring,
  `isCameraNavigating`, `updateGizmoHover`, `handleResize`, `focusSelected`,
  and `setTechnicalView` delegate to it. Removed the 8 camera-tuning constants
  and the `CameraDrag` type (moved into the controller). Behavior preserved
  exactly (incl. the redundant orbit-branch angle sync). `SceneApp.ts`
  3841 → 3615 lines. Gate green (tsc, 32 tests, build; game `index` chunk
  byte-identical at 33.27 kB → controller is editor-only). Next: Piece 3
  (pointer-drag transform math).

- *2026-06-15* — **Item 3 Piece 1 done — gizmo visual builders extracted.**
  Moved `clearGizmo` + all `add*Gizmo`/`add*Handle`/`addRotateRing` +
  `gizmoMaterialFor` + `registerGizmoHandle` out of `SceneApp` into a new
  `editor/gizmos/builder.ts` (`buildGizmoHandles`, `clearGizmoGroup`,
  `GizmoHighlight`). `SceneApp.updateGizmo` now delegates, passing the
  `GizmoInteractionStore` directly as the highlight source (its
  `activeHandle`/`hoveredHandle` getters satisfy `GizmoHighlight`). Dropped the
  now-unused Three.js geometry/material imports and the gizmo axis/handle
  imports that moved with the code. `SceneApp.ts` 3999 → 3841 lines. Gate green
  (tsc clean, 32 engine tests, build; game `index` chunk 33.27 kB, editor code
  stays out of it). Next: Piece 2 (editor camera controller).

- *2026-06-15* — **Item 3 inventory (no code yet).** Mapped all of
  `SceneApp.ts` (3999 lines) into KEEP (shared render) vs MOVE (editor
  authoring). Baseline gate green (tsc clean, 32 engine tests). Acceptance
  criterion "runtime path imports no editor" is **already satisfied**:
  `main.ts` game branch uses `RuntimeSceneApp`, which imports only `@engine/*`
  and `@/*` — no `@editor/*`. So Item 3 is purely (a) shrink `SceneApp` toward
  <2500 lines and (b) relocate editor authoring code into `editor/*`.

  **KEEP in SceneApp (shared render — mirrors `RuntimeSceneApp`):** renderer/
  scene/camera/sun/ambient fields; engine spine + subsystems (animation, input,
  physics, audio, behavior) and their ctor wiring; `syncEntityTransform`;
  `start()` rAF loop; `dispose()`; `registerSubsystem`; `getRenderStats`;
  `loadActiveProjectScene` (asset/model/light build); `createInstancedModel`,
  `addCharacter`, `createCharacterObject`, `playCharacterAnimation`, `addLight`,
  `createLightObject`, `ensureDefaultLights`/`createDefaultLightActor`/
  `createLightId`/`defaultActorPosition`; `fitSunShadowToScene`/`getRoomBounds`;
  `applyBackgroundAndAmbient` + `staticObjects*`/`backgroundColor`/`ambient*`;
  `handleResize`. (These duplicate `RuntimeSceneApp`; Item 3b consolidation is a
  later step, tracked separately — not blocking the line-count milestone.)

  **MOVE out of SceneApp (editor authoring), grouped by cohesion:**
  - *Gizmo visuals* — `clearGizmo`, `addMoveGizmo`/`addRotateGizmo`/
    `addRotateRing`/`addScaleGizmo`/`addPlaneHandle`/`addArrowHandle`/
    `addScaleHandle`, `gizmoMaterialFor`, `registerGizmoHandle`. Pure Three.js
    construction → `editor/gizmos/builder.ts`. **(Piece 1)**
  - *Editor camera* — all `camera*Navigation*`/`cameraDrag`/`beginAltCameraDrag`/
    `updateCameraDrag`/`endCameraDrag`/`updateCameraLook`/`getCameraLook*`/
    `getCameraOrbitTarget`/`dollyCamera`/`adjustCameraMoveSpeed`/
    `updateCameraNavigation`/`getCameraBasis`/`syncCameraAnglesFromCurrentView`/
    `applyCameraOrientation`/`handleWheel`. Self-contained interactive camera →
    `editor/camera/editorCameraController.ts`. **(Piece 2)**
  - *Pointer-drag transform math* — `startGizmoDrag`, `updateMoveDrag`,
    `updateMoveDragPosition`, `updateRotateDrag`, `updateScaleDrag`,
    `commitPointerDrag`, `cascadeActiveDragToLinks`, `applyCascadeToLinks`,
    `captureLinkedMoveStarts`, `captureDescendantStarts` → `editor/gizmos/*`.
    **(Piece 3)**
  - *Picking + snapping geometry* — `pickSelection`, `pickGizmoHandle`,
    `raycastSurfaceBelow`, `isSelfHit`, `clientToFloor`/`clientToSurface`/
    `clientToPlane`/`setPointerNdc`, wall/surface snap (`computeWallSnap`,
    `performWallSnap`, `wallSnapSelected`, `snapSelectedToWall`,
    `surfaceSnapSelected`, `isWallAsset`, `isRoomAsset`). **(Piece 4)**
  - *Remaining editor API surface* (selection store + public commands EditorUi
    calls: select/delete/duplicate/group/parent/pivot/metadata/world-settings/
    tools/history/save) — large; stays in `SceneApp` for now and is the
    candidate for a later `EditorSceneController` extraction once Pieces 1–4
    land. Not required to reach the first <2500 milestone.

  **Strategy:** peel cohesive, low-coupling modules first (Pieces 1→4), each its
  own green commit. Each piece: extract to `editor/*`, delegate from `SceneApp`,
  run gate, commit+push. Next action: Piece 1 (gizmo builders).

- *2026-06-15* — **Item 3 setup.** Decided workflow (see Item 3 "Working
  agreement"): branch `refactor/sceneapp-split` off `main`, auto-commit + push
  each green sub-step without asking, PR at the end. An auto-commit Stop hook was
  considered but the harness safety classifier blocked installing a
  self-executing push-to-main hook — so the agent performs the commits itself
  instead. Created the branch; Item 3 work starts next session.
- *2026-06-15* — **Item 2 done.** Decisions: derive physics from scene
  colliders; keep placeholder backend when none. Gated Rapier's dynamic import
  in `PhysicsSubsystem.init()` behind `this.bodies.length > 0`; added
  `usesRapier()` + engine test for the collider-free path (now 32 checks).
  `vendor-physics` remains a lazy chunk. Gate green (tsc / 32 tests / build).
  Next action: Item 3 (extract editor logic from `SceneApp`) — produce the
  responsibility inventory in this log first; it is large, so split across
  commits/sessions.
- *2026-06-15* — **Item 1 done.** Split `src/style.css` (runtime, lines 1–63)
  from new `src/editor/editorUi.css` (editor, former lines 65–1026); added
  `import "./editorUi.css"` at top of `EditorUi.ts`. Verified the production CSS
  no longer contains editor selectors (0 matches; CSS is now 0.72 kB). Gate
  green (tsc / 31 tests / build).
- *2026-06-15* — Checklist created from project analysis. No code changes yet.
  Next action: begin Item 1 (editor CSS split).
