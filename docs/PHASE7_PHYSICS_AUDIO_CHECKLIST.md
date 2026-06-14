# Phase 7 Physics + Audio Checklist

> Created: 2026-06-14
> Scope: add collider/physics and audio to the engine as deterministic
> subsystems on top of the runtime spine. Closes the two largest Phase 7
> capability gaps (the vertical-slice list in `MIGRATION_ROADMAP.md`).
> Depends on: `RUNTIME_SPINE_CHECKLIST.md` (tick loop + behavior/event plumbing).

Today there is **no** physics or audio code. The layout has a `collision` flag
(`LayoutPlacement.collision` / `LayoutCharacter.collision`) that the scene
adapter intentionally leaves unmapped, and no audio component or manifest.

## Working Rules

- Keep each implementation step small and reversible.
- Run `npm run build:verify` after every implementation step.
- Commit and push only after `build:verify` passes.
- Mark an item `[x]` only after implementation, verification, commit, and push
  are complete.
- Keep `engine/core` and `engine/scene` free of Three.js, DOM, Rapier, and
  editor UI imports. Physics math/state and audio playback live in dedicated
  subsystem modules behind a clean contract.
- Keep Game Mode `/` and Editor Mode `/?editor` working throughout.
- Every subsystem needs a headless/placeholder path so engine-tests can run it
  without a browser, WASM, or audio device.

## 0. Tracking

- [x] Create this checklist in `docs/`.

## 1. Collider Data Model

- [x] Add a `ColliderComponent` to `engine/scene/components.ts`
  (shape: box/sphere/capsule + size, `isStatic`, `isSensor`) with a typed reader.
- [x] Map the legacy `collision` flag into a default collider in
  `legacyRoomLayoutAdapter.ts` (closes the documented adapter gap).
- [x] Add adapter coverage to `tools/engine-tests.ts` (collision flag ->
  collider component; absent -> documented default).

## 2. Physics Subsystem (Placeholder First)

- [x] Add a `PhysicsSubsystem` with a deterministic placeholder step
  (e.g. AABB overlap from collider + transform) that exposes contacts/sensor
  events. Render-free and engine-clean.
- [x] Drive it from `EngineApp.update`; expose contacts to behaviors/events so
  a scripted entity can react.
- [x] Headless test: a moving entity overlaps a static collider and the step
  reports the contact deterministically.

## 3. Rapier-Backed Implementation (After Placeholder)

- [x] Add the Rapier dependency (`@dimforge/rapier3d-compat`) and back the same
  `PhysicsSubsystem` contract with Rapier bodies built from
  `ColliderComponent` + `TransformComponent`.
- [x] Use `Subsystem.init()` for Rapier's async WASM init; keep the placeholder
  path behind the same interface for headless tests.
- [x] Coordinate bundle impact with `RUNTIME_ONLY_BUNDLE_CHECKLIST.md`
  (Rapier WASM is large — must be a separate chunk / lazy-loaded).

## 4. Audio Data + Subsystem

- [ ] Add an `AudioComponent` (clip id, volume, loop, optional spatial) + a
  clip/manifest lookup in `engine/assets`.
- [ ] Add an `AudioSubsystem` (Web Audio) that plays one-shots on a triggered
  action/behavior event; a no-op placeholder path for headless runs.
- [ ] Verify a one-shot fires from a behavior/collision event in Game Mode.

## 5. Readiness Gate

- [ ] `npm run build:verify` reports only known baseline warning(s); engine
  tests cover collider derivation + the placeholder physics step.
- [ ] Game Mode shows a collision-driven behavior reaction and a one-shot sound.
- [ ] No Three.js / Rapier / DOM imports leaked into `engine/core` or
  `engine/scene`.
