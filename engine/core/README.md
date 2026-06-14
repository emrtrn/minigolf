# Engine Core

`engine/core` owns the runtime lifecycle spine that can be shared by Game Mode,
Editor Mode, tests, and future packaged games.

Current files:

- `Subsystem.ts`: subsystem lifecycle contracts and update context.
- `SubsystemRegistry.ts`: deterministic subsystem registration, lookup,
  forward lifecycle calls, and reverse disposal.
- `EngineApp.ts`: small coordinator for registry lifecycle and tick/update
  context creation.

Rules:

- Must not import Three.js, DOM APIs, Rapier, editor UI, or project dev
  middleware.
- Must not own renderer loops, browser events, asset loading, scene data, or
  editor state directly.
- May define plain TypeScript contracts used by engine modules.
- Runtime adapters should plug into this layer through subsystem contracts,
  not by adding renderer/editor knowledge here.
