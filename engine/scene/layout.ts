import type { CollisionPresetId } from "./collision";

export type Vec3 = [number, number, number];
export type LayoutLightType = "directional" | "point" | "spot";
/** Particle blend mode (authoring + runtime VFX). */
export type ParticleMaterialMode = "additive" | "alpha";

/**
 * Generic, project-defined gameplay metadata value. The base editor stays
 * schema-agnostic: it stores whatever scalar/list a project's metadata schema
 * declares without knowing the gameplay semantics.
 */
export type MetadataValue = string | number | boolean | string[];
export type LayoutMetadata = Record<string, MetadataValue>;

/**
 * Authoring reference to a runtime behavior script: a registered `script` id and
 * optional JSON-ish `params`. The runtime behavior registry resolves the id to
 * an update function; the saved layout only stores the reference.
 */
export interface LayoutBehavior {
  script: string;
  params?: LayoutMetadata;
}

export interface LayoutAudio {
  clipId: string;
  volume?: number;
  loop?: boolean;
  spatial?: boolean;
  /** Play this cue automatically when the scene loads (ambient). Absent means false. */
  autoPlay?: boolean;
}

/**
 * Authoring reference to a particle/VFX emitter: a manifest `effectId` plus
 * optional emitter params. The runtime VFX system resolves `effectId` and
 * simulates; the saved layout only stores the reference + overrides.
 */
export interface LayoutParticleEmitter {
  effectId: string;
  loop?: boolean;
  rate?: number;
  lifetime?: number;
  startSize?: number;
  endSize?: number;
  velocity?: Vec3;
  spread?: number;
  materialMode?: ParticleMaterialMode;
  worldSpace?: boolean;
  autoPlay?: boolean;
}

/**
 * Authored interaction marker: an `action` id the runtime interprets, with an
 * optional player-facing `prompt`, default `enabled` flag, a `requires` gate
 * and a `cooldown` (seconds). Project game rules interpret these at runtime.
 */
export interface LayoutInteraction {
  action: string;
  prompt?: string;
  enabled?: boolean;
  requires?: string;
  cooldown?: number;
}

export type LayoutPhysicsAxisLocks = [boolean, boolean, boolean];

export interface LayoutPhysics {
  /** Override mass in kilograms. Absent lets the physics backend derive mass from the collider. */
  massKg?: number;
  /** Linear velocity damping. Absent means the runtime default. */
  linearDamping?: number;
  /** Angular velocity damping. Absent means the runtime default. */
  angularDamping?: number;
  /** Whether world gravity affects this body. Absent means true. */
  enableGravity?: boolean;
  /** Per-axis translation locks, X/Y/Z. Absent means all axes are free. */
  lockPosition?: LayoutPhysicsAxisLocks;
  /** Per-axis rotation locks, X/Y/Z. Absent means all axes are free. */
  lockRotation?: LayoutPhysicsAxisLocks;
}

export interface LayoutPlacement {
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  /** Stable id assigned when this object becomes a parent (referenced by children). */
  nodeId?: string;
  /** This object's parent, referencing the parent's `nodeId`. */
  parentId?: string;
  position: Vec3;
  /** Legacy Y-only rotation in degrees. Read as a fallback when `rotation` is absent. */
  rotationYDeg?: number;
  /** Full Euler rotation (XYZ order) in degrees. Preferred over `rotationYDeg`. */
  rotation?: Vec3;
  /**
   * Authoring pivot: a point in the object's local (model) space that rotation
   * and scale gizmos act around. Absent/`[0,0,0]` means the model origin.
   * Editor-only; runtime should consume the baked world transform.
   */
  pivot?: Vec3;
  /** Uniform scalar (legacy) or per-axis scale. */
  scale?: number | Vec3;
  /** Editor hint: keep scale axes proportional when editing. */
  scaleLocked?: boolean;
  /** Legacy/runtime hint. Editor renderer controls instanced static shadows centrally. */
  castShadow?: boolean;
  /** Runtime hint: object participates in collision. Absent means true (default on). */
  collision?: boolean;
  /** Per-placement collision preset override; absent means inherit the asset default. */
  collisionPreset?: CollisionPresetId;
  /** Per-placement material override. References a manifest material asset id. */
  materialSlot?: string;
  /** Runtime hint: collider is a non-blocking sensor (trigger zone). Absent means false. */
  sensor?: boolean;
  /** Runtime hint: this object is a dynamic rigid body in Play mode. Absent means false. */
  simulatePhysics?: boolean;
  /** Runtime physics body settings used when this object simulates physics. */
  physics?: LayoutPhysics;
  /** Project-defined gameplay metadata (schema-driven; omitted when empty). */
  metadata?: LayoutMetadata;
  /** Runtime behavior script reference (resolved by the behavior registry). */
  behavior?: LayoutBehavior;
  /** Runtime audio cue attached to this object. */
  audio?: LayoutAudio;
  /** Runtime particle/VFX emitter attached to this object. */
  particle?: LayoutParticleEmitter;
  /** Authored interaction marker (interpreted by runtime game rules). */
  interaction?: LayoutInteraction;
}

export interface LayoutModelInstances {
  assetId: string;
  placements: LayoutPlacement[];
}

/**
 * A placed instance of an Actor Script class (`*.actor.json`). Unlike a
 * {@link LayoutPlacement} (which references a mesh asset directly), an actor
 * instance references a reusable *class* via `classRef` and carries only its
 * world transform + hierarchy/flags. The runtime resolves the class and spawns
 * its component template + event bindings (see `engine/scene/actorInstance.ts`).
 *
 * Sınıf ≠ Instance: the class is authored once and placed many times. Per-instance
 * variable/component `overrides` are a deferred phase (kept off the type for now).
 */
export interface LayoutActorInstance {
  /** Path to the `*.actor.json` class-asset, relative to the public root. */
  classRef: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  /** Stable id assigned when this object becomes a parent (referenced by children). */
  nodeId?: string;
  /** This object's parent, referencing the parent's `nodeId`. */
  parentId?: string;
  position: Vec3;
  /** Legacy Y-only rotation in degrees. Read as a fallback when `rotation` is absent. */
  rotationYDeg?: number;
  /** Full Euler rotation (XYZ order) in degrees. Preferred over `rotationYDeg`. */
  rotation?: Vec3;
  /** Uniform scalar (legacy) or per-axis scale. */
  scale?: number | Vec3;
  /** Editor hint: keep scale axes proportional when editing. */
  scaleLocked?: boolean;
}

export interface LayoutCharacter {
  assetId: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  /** Stable id assigned when this object becomes a parent (referenced by children). */
  nodeId?: string;
  /** This object's parent, referencing the parent's `nodeId`. */
  parentId?: string;
  position: Vec3;
  /** Legacy Y-only rotation in degrees. Read as a fallback when `rotation` is absent. */
  rotationYDeg?: number;
  /** Full Euler rotation (XYZ order) in degrees. Preferred over `rotationYDeg`. */
  rotation?: Vec3;
  /**
   * Authoring pivot: a point in the object's local (model) space that rotation
   * and scale gizmos act around. Absent/`[0,0,0]` means the model origin.
   * Editor-only; runtime should consume the baked world transform.
   */
  pivot?: Vec3;
  /** Uniform scalar (legacy) or per-axis scale. */
  scale?: number | Vec3;
  /** Editor hint: keep scale axes proportional when editing. */
  scaleLocked?: boolean;
  /** Runtime hint: character casts shadows. Absent means true (default on). */
  castShadow?: boolean;
  /** Runtime hint: object participates in collision. Absent means true (default on). */
  collision?: boolean;
  /** Per-placement collision preset override; absent means inherit the asset default. */
  collisionPreset?: CollisionPresetId;
  /** Runtime hint: collider is a non-blocking sensor (trigger zone). Absent means false. */
  sensor?: boolean;
  /** Runtime hint: this object is a dynamic rigid body in Play mode. Absent means false. */
  simulatePhysics?: boolean;
  /** Runtime physics body settings used when this object simulates physics. */
  physics?: LayoutPhysics;
  /** Project-defined gameplay metadata (schema-driven; omitted when empty). */
  metadata?: LayoutMetadata;
  animation?: string;
  /** Runtime behavior script reference (resolved by the behavior registry). */
  behavior?: LayoutBehavior;
  /** Runtime audio cue attached to this object. */
  audio?: LayoutAudio;
  /** Runtime particle/VFX emitter attached to this object. */
  particle?: LayoutParticleEmitter;
  /** Authored interaction marker (interpreted by runtime game rules). */
  interaction?: LayoutInteraction;
}

export interface LayoutWorldSettings {
  /** Central static/instanced shadow casting. Absent means false. */
  staticObjectsCastShadow?: boolean;
  /** Central static/instanced shadow receiving. Absent means true. */
  staticObjectsReceiveShadow?: boolean;
  /** Scene background color (hex). Absent means the default. */
  backgroundColor?: string;
  /** Ambient light color (hex). Absent means the default white. */
  ambientColor?: string;
  /** Ambient light intensity. Absent means 0 (no ambient). */
  ambientIntensity?: number;
  /** World gravity (units/s^2); negative Y pulls down. Absent means the default. */
  gravity?: Vec3;
  /**
   * Selected runtime Game Mode id (Unreal's GameMode analogue). Absent means the
   * built-in default camera mode; the runtime resolves unknown ids to that
   * default. Editor-authored; runtime-only behavior — never written back here by
   * a running session.
   */
  gameMode?: string;
}

/**
 * Singleton environment actor: a physically-inspired sky dome (Rayleigh + Mie
 * scattering, à la Unreal's Sky Atmosphere). Rendered with three.js's analytic
 * `Sky` shader as the scene background.
 *
 * Like Unreal, the **directional Sun light is the source of truth** for the sun:
 * the sky reads that light's rotation each frame to place the sun disc + horizon
 * glow, so rotating the Sun (gizmo or its rotation fields) moves the sky live.
 * The Details panel exposes elevation/azimuth as a two-way convenience that just
 * rewrites the light's rotation; nothing about the sun is stored on the sky. Only
 * the scattering parameters live here; all fields are optional and absent reads
 * the defaults in `engine/scene/skyAtmosphere.ts`.
 */
export interface LayoutSkyAtmosphere {
  /** Display name in the Outliner. Absent means "Sky Atmosphere". */
  name?: string;
  /** Hidden in the viewport + runtime (no sky dome). Absent means false. */
  hidden?: boolean;
  /** Rayleigh scattering strength — controls the blueness of the sky (0..6). */
  rayleigh?: number;
  /** Atmospheric turbidity / haziness (1..20). */
  turbidity?: number;
  /** Mie scattering coefficient — the haze/glow around the sun (0..0.1). */
  mie?: number;
  /** Mie directional anisotropy — sun halo tightness (0..1). */
  mieDirectionalG?: number;
  /** Sky exposure / overall brightness, mapped to tone-mapping exposure (0..1). */
  exposure?: number;
}

/**
 * Singleton environment actor: an Exponential Height Fog (à la Unreal). Faz 1 is
 * a distance-based scene fog — `exp` maps to three's `FogExp2`, `linear` to `Fog`
 * (near/far). All fields are optional; absent reads the defaults in
 * `engine/scene/heightFog.ts`. True world-height falloff is Faz 2 and not modeled
 * here.
 */
export interface LayoutHeightFog {
  /** Display name in the Outliner. Absent means "Exponential Height Fog". */
  name?: string;
  /** Hidden in the viewport + runtime (no fog). Absent means false. */
  hidden?: boolean;
  /** `exp` = FogExp2 (density), `linear` = Fog (start/end). Absent means `exp`. */
  mode?: "exp" | "linear";
  /** Fog inscattering color (hex `#rrggbb`). */
  color?: string;
  /** Exponential density (exp mode), tuned to the ~100u scene scale. */
  density?: number;
  /** Linear fog near distance (linear mode). */
  start?: number;
  /** Linear fog far distance (linear mode). */
  end?: number;
}

/**
 * Singleton environment actor: a **static** Cloud Layer (the non-volumetric
 * counterpart to Unreal's Volumetric Clouds). A camera-following dome backdrop
 * whose cloud cover is painted by a procedural fBm-noise shader — no raymarching,
 * no textures. All fields are optional; absent reads the defaults in
 * `engine/scene/cloudLayer.ts`. True volumetric clouds are intentionally out of
 * scope.
 */
export interface LayoutCloudLayer {
  /** Display name in the Outliner. Absent means "Cloud Layer". */
  name?: string;
  /** Hidden in the viewport + runtime (no clouds). Absent means false. */
  hidden?: boolean;
  /** Cloud tint (hex `#rrggbb`). */
  color?: string;
  /** Fraction of the sky covered (0 = clear, 1 = overcast). */
  coverage?: number;
  /** Overall cloud opacity (0 = invisible, 1 = solid). */
  density?: number;
  /** Edge feathering of the cloud shapes (0 = hard, 1 = very soft). */
  softness?: number;
  /** Feature size of the noise — larger = bigger cloud masses. */
  scale?: number;
  /** Drift speed (wind). Absent/0 keeps the clouds static. */
  speed?: number;
}

export interface LayoutLightActor {
  id: string;
  type: LayoutLightType;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  /** Stable id assigned when this object becomes a parent (referenced by children). */
  nodeId?: string;
  /** This object's parent, referencing the parent's `nodeId`. */
  parentId?: string;
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation?: Vec3;
  color?: string;
  intensity?: number;
  castShadow?: boolean;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
}

export interface RoomLayout {
  schema: 1;
  name: string;
  loadGroups: string[];
  worldSettings?: LayoutWorldSettings;
  /** Optional singleton sky/atmosphere environment actor. */
  skyAtmosphere?: LayoutSkyAtmosphere;
  /** Optional singleton Exponential Height Fog environment actor. */
  heightFog?: LayoutHeightFog;
  /** Optional singleton static Cloud Layer environment actor. */
  cloudLayer?: LayoutCloudLayer;
  lights?: LayoutLightActor[];
  instances: LayoutModelInstances[];
  characters: LayoutCharacter[];
  /** Placed Actor Script class instances (resolved + spawned at runtime). */
  actors?: LayoutActorInstance[];
}
