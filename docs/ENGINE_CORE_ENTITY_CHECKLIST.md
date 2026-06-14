# Engine Core + Entity Checklist

> Created: 2026-06-14
> Scope: start the architecture-v2 engine spine before continuing broad
> `SceneApp` extraction.

This checklist tracks the next migration direction after the helper-extraction
passes. The goal is to introduce a small, serializable engine/scene spine while
keeping the current `RoomLayout` runtime/editor path working.

## Working Rules

- Keep each implementation step small and reversible.
- Run `npm run build:verify` after every implementation step.
- Commit and push only after `build:verify` passes.
- Mark an item `[x]` only after the implementation, verification, commit, and
  push are complete.
- Keep `engine/core` and `engine/scene` free of Three.js, DOM, Rapier, and
  editor UI imports.
- Keep the legacy `RoomLayout` format working until a replacement scene format
  is proven end to end.

## 0. Tracking

- [x] Create this checklist in `docs/`.

## 1. Engine Core Spine

- [x] Add `engine/core/Subsystem.ts` with a minimal subsystem lifecycle
  contract: `init`, `start`, `update`, and `dispose` hooks.
- [x] Add `engine/core/SubsystemRegistry.ts` with deterministic registration,
  lookup, forward lifecycle order, and reverse dispose order.
- [x] Add `engine/core/EngineApp.ts` as the lifecycle coordinator for the
  registry and tick/update calls.
- [x] Add a short `engine/core/README.md` documenting ownership rules and
  forbidden dependencies.

## 2. Minimal Scene Data Model

- [x] Add `engine/scene/entity.ts` with plain JSON-safe `EntityId`, `Entity`,
  and component-map contracts.
- [x] Add `engine/scene/components.ts` with the first component contracts:
  `TransformComponent`, `MeshRendererComponent`, `LightComponent`, and
  `MetadataComponent`.
- [x] Add `engine/scene/sceneDocument.ts` with a versioned `SceneDocument`
  contract containing entities and optional world settings.
- [ ] Add serialization helpers that clone/validate the minimal scene document
  without importing render/editor/runtime objects.

## 3. Legacy Layout Adapter

- [ ] Add `engine/scene/legacyRoomLayoutAdapter.ts` to convert current
  `RoomLayout.instances`, `characters`, and `lights` into `SceneDocument`
  entities.
- [ ] Preserve stable identity mapping for legacy selections where possible
  (`instance:<assetId>:<index>`, `character:<index>`, `light:<index>`).
- [ ] Add adapter coverage for transform, mesh/model reference, light data,
  visibility/lock flags, hierarchy ids, and metadata.
- [ ] Keep `RoomLayout` as the saved authoring format for this stage.

## 4. First Integration Slice

- [ ] Load the current `RoomLayout` as before, then derive a `SceneDocument`
  through the adapter without changing visible behavior.
- [ ] Add a debug/internal getter for the derived `SceneDocument` so the new
  spine can be inspected without driving rendering yet.
- [ ] Verify Game Mode and Editor Mode still render from the existing path.
- [ ] Update `docs/MIGRATION_ROADMAP.md` with the completed engine-core and
  scene-data slice.

## 5. Render Adapter Preparation

- [ ] Identify the smallest render path that can consume `SceneDocument`
  entities while the legacy `RoomLayout` path remains available.
- [ ] Move only one render binding at a time toward entity/component input:
  static mesh instances first, then characters, then lights.
- [ ] Keep compatibility wrappers until both Game Mode and Editor Mode are
  proven against the new path.

## 6. Vertical Slice Readiness Gate

- [ ] Confirm the engine core can initialize and tick deterministic subsystems.
- [ ] Confirm the scene model can represent at least one mesh entity, one light
  entity, metadata, and transform hierarchy.
- [ ] Confirm the legacy adapter can derive that scene model from the current
  saved layout.
- [ ] Confirm `npm run build:verify` still reports only the known baseline
  warnings.
