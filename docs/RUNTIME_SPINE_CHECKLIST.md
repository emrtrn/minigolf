# Runtime Spine + First Subsystem Checklist

> Created: 2026-06-14
> Scope: wire the (currently inert) engine-core spine into the live runtime,
> prove the tick drives real work, then add the first real gameplay subsystems
> (input action map -> behavior/script update). Foundation for Phase 7.
> Depends on: engine-core + scene-data spine (complete, see
> `ENGINE_CORE_ENTITY_CHECKLIST.md`).

Today `EngineApp` / `SubsystemRegistry` exist and are tested but are **not used
anywhere in `src/`**; `SceneApp.start()` owns its own `requestAnimationFrame`
loop (`src/scene/SceneApp.ts:403-418`) and `getSceneDocument()` is
inspection-only. This checklist makes the spine actually run.

## Working Rules

- Keep each implementation step small and reversible.
- Run `npm run build:verify` after every implementation step.
- Commit and push only after `build:verify` passes.
- Mark an item `[x]` only after implementation, verification, commit, and push
  are complete.
- Keep `engine/core` and `engine/scene` free of Three.js, DOM, Rapier, and
  editor UI imports. (Subsystems that touch Three/DOM live in `engine/render-three`,
  `engine/input`, or a runtime/game location — not in `engine/core`.)
- Keep Game Mode `/` and Editor Mode `/?editor` working throughout.

## 0. Tracking

- [x] Create this checklist in `docs/`.

## 1. Tick Ownership

- [x] Instantiate an `EngineApp` in `SceneApp` and call
  `engineApp.update(deltaSeconds)` inside the existing `start()` loop, alongside
  the current per-frame work, with **no behavior change** yet.
- [x] Call `engineApp.init()` / `start()` during scene load and
  `engineApp.dispose()` from `SceneApp.dispose()`.
- [x] Expose a way to register subsystems so later sections can attach to the
  same tick.

## 2. Prove the Tick Drives Real Work

- [x] Move the per-frame `AnimationMixer` update
  (`for (const mixer of this.mixers) mixer.update(...)`, formerly
  `SceneApp.ts:410`) into an `AnimationSubsystem` registered on `EngineApp`.
  The subsystem is Three-touching, so it lives in `engine/render-three`
  (`engine/render-three/animationSubsystem.ts`), outside `engine/core`.
- [x] The `start()` loop now drives mixers only through `engineApp.update`
  (the inline mixer loop is gone; `playCharacterAnimation` adds mixers to the
  subsystem instead).
- [x] Verify: parity locked by the `animation subsystem ticks mixers with engine
  deltaSeconds` engine test (same delta reaches the same mixers as the old inline
  loop). Live browser observation still recommended before relying on it.

## 3. Input Action Map

- [x] Add `engine/input/actionMap.ts`: a pure, DOM-free mapping from raw
  key/pointer codes to named actions and per-tick action state (pressed/held/
  released). No `engine/core` or render imports. (Plus `engine/input/README.md`
  with the folder rules.)
- [x] Add a DOM input source (runtime/editor location) that feeds raw events
  into the action map; keep existing editor camera/keyboard handling intact.
  (`src/input/keyboardInputSource.ts` — observer only, never `preventDefault`,
  attached in both modes; editor camera/keyboard listeners are untouched.)
- [x] Add an `InputSubsystem` that advances action state each tick
  (`engine/input/inputSubsystem.ts`, registered after AnimationSubsystem and
  before any future behavior subsystem).
- [x] Verify: covered by the `input subsystem maps raw codes to named action
  edges per tick` engine test (raw->named mapping + pressed/held/released edges
  via `EngineApp.update`). Editor shortcuts/camera nav are structurally safe
  (observer-only source); live browser confirmation still recommended.

## 4. Behavior / Script Update

- [x] Add a minimal `BehaviorComponent` to `engine/scene/components.ts`
  (script id + JSON params) plus a typed reader (`readBehaviorComponent`).
- [x] Add a behavior registry (script id -> update function) in a runtime/game
  location (`src/game/behaviors.ts`: `spin` + input-driven `input-move`);
  behaviors receive `EngineUpdateContext` + input actions + params and mutate the
  entity transform.
- [x] Add a `BehaviorSubsystem` that ticks behaviors against the live entity set
  derived from the scene (`SceneApp` derives `getSceneDocument().entities` once
  at load and calls `setEntities`). `SceneDocument` is now a runtime source of
  truth: behaviors mutate per-entity transform copies, synced back to the
  rendered character objects each tick via `syncEntityTransform`.
- [x] Map the legacy authoring path so a placement/character can carry a
  behavior (`LayoutBehavior` field -> adapter `BehaviorComponent` mapping ->
  `vite.config.ts` `validateBehavior` in the save-validator allowlist).

## 5. Readiness Gate

- [x] `tools/engine-tests.ts` covers: action-map raw->named mapping (`input
  subsystem maps raw codes to named action edges per tick`) and a behavior tick
  mutating an entity transform deterministically (`behavior subsystem ticks
  behaviors and mutates transforms deterministically`).
- [x] `npm run build:verify` reports only the known baseline warning(s)
  (`/__save-layout` in the game chunk; 22 engine checks pass).
- [ ] Game Mode demonstrates one scripted entity reacting to an input action
  (the smallest "the spine drives gameplay" proof). Authored + pipeline-tested:
  the `customer-character-a` character carries the `input-move` behavior, and the
  full chain is covered by engine tests with the real components — real
  `KeyboardInputSource` (injected fake window) -> `ActionMap` -> `InputSubsystem`
  -> `BehaviorSubsystem` -> transform sink. Only the literal in-browser visual is
  unobserved (no Playwright/Puppeteer in the repo; would need a dep install).
  To confirm by hand: open Game Mode `/`, press W/A/S/D or the arrow keys, and
  watch `customer-character-a` slide across the floor.
