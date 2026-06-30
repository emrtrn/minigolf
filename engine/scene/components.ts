import type { Entity, SceneJsonValue } from "./entity";
import type { LayoutPhysicsAxisLocks, ParticleMaterialMode, Vec3 } from "./layout";
import { resolveCapsuleDimensions } from "./capsule";

export type { ParticleMaterialMode };

export const TRANSFORM_COMPONENT = "Transform";
export const MESH_RENDERER_COMPONENT = "MeshRenderer";
export const LIGHT_COMPONENT = "Light";
export const METADATA_COMPONENT = "Metadata";
export const BEHAVIOR_COMPONENT = "Behavior";
export const COLLIDER_COMPONENT = "Collider";
export const AUDIO_COMPONENT = "Audio";
export const PARTICLE_EMITTER_COMPONENT = "ParticleEmitter";
export const INTERACTION_COMPONENT = "Interaction";
export const CHARACTER_MOVEMENT_COMPONENT = "CharacterMovement";
export const CAMERA_COMPONENT = "Camera";
export const SPRING_ARM_COMPONENT = "SpringArm";
export const MESSAGE_BINDINGS_COMPONENT = "MessageBindings";
export const SCRIPT_INTERFACES_COMPONENT = "ScriptInterfaces";
export const SCRIPT_ACTOR_COMPONENT = "ScriptActor";
export const SCRIPT_REFERENCES_COMPONENT = "ScriptReferences";
export const SCRIPT_DISPATCHERS_COMPONENT = "ScriptDispatchers";

export type SceneLightType = "directional" | "point" | "spot";
export type ColliderShape =
  | "box"
  | "sphere"
  | "capsule"
  | "cylinder"
  | "cone"
  | "convex"
  | "trimesh";

export interface TransformComponent {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface MeshRendererComponent {
  assetId: string;
  materialSlot?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Local mesh scale authored on the MeshRenderer node (Actor Script `props.scale`),
   * multiplied into the placement scale when the mesh is rendered. Lets a class
   * shrink/grow its visual without changing the placement transform. Absent = unit.
   */
  scale?: Vec3;
}

export interface LightComponent {
  type: SceneLightType;
  color?: string;
  intensity?: number;
  castShadow?: boolean;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
}

export interface MetadataComponent {
  values: Record<string, SceneJsonValue>;
}

/**
 * Attaches a runtime script to an entity: a registered behavior `scriptId` plus
 * opaque JSON `params`. The behavior registry (a runtime concern) resolves the
 * id to an update function; the engine layer only stores the reference.
 */
export interface BehaviorComponent {
  scriptId: string;
  params?: Record<string, SceneJsonValue>;
}

export type MessageBindingTarget = "self" | "any";

export interface MessageBindingComponentEntry {
  message: string;
  scriptId: string;
  params?: Record<string, SceneJsonValue>;
  target: MessageBindingTarget;
}

export interface MessageBindingsComponent {
  bindings: MessageBindingComponentEntry[];
}

export interface ScriptInterfacesComponent {
  interfaces: string[];
}

export interface ScriptActorComponent {
  classRef: string;
  nodeId?: string;
}

export interface ScriptReferenceSelectorComponent {
  byNodeId?: string;
  byName?: string;
  byTag?: string;
  byClassRef?: string;
  byInterface?: string;
}

export interface ScriptReferenceComponentEntry {
  key: string;
  selector: ScriptReferenceSelectorComponent;
}

export interface ScriptReferencesComponent {
  references: ScriptReferenceComponentEntry[];
}

export interface ScriptDispatcherComponentEntry {
  name: string;
  payload: Record<string, string>;
}

export interface ScriptDispatchersComponent {
  dispatchers: ScriptDispatcherComponentEntry[];
}

/**
 * One simple-collision shape of a (possibly compound) collider. Sizes/centers
 * are world-scaled (placement scale baked in), like {@link ColliderComponent};
 * `rotation` is a local Euler rotation in degrees for oriented shapes.
 */
export interface ColliderPrimitive {
  shape: ColliderShape;
  size: Vec3;
  center?: Vec3;
  rotation?: Vec3;
  /** Baked convex hull points (world-scaled, relative to body origin) for `shape === "convex"`. */
  points?: Vec3[];
  /** Baked triangle vertices (world-scaled, relative to body origin) for `shape === "trimesh"`. */
  vertices?: Vec3[];
  /** Triangle index buffer into `vertices`, grouped by threes, for `shape === "trimesh"`. */
  indices?: number[];
}

export interface ColliderComponent {
  shape: ColliderShape;
  /** World-axis-aligned full size (placement scale already baked in). */
  size: Vec3;
  /** Capsule radius before conversion to the legacy size AABB. */
  capsuleRadius?: number;
  /** Capsule half-height from center to top/bottom of the hemispheres. */
  capsuleHalfHeight?: number;
  /**
   * Offset of the collider center from the entity's transform position, in world
   * space (placement scale baked in). Absent means centered on the position.
   */
  center?: Vec3;
  /**
   * Authored compound collision shapes (Static Mesh editor). When present, the
   * physics backend builds one collider per primitive; `shape`/`size`/`center`
   * above describe the encompassing AABB used by the broad-phase / movement.
   */
  primitives?: ColliderPrimitive[];
  isStatic: boolean;
  isSensor: boolean;
  /** Surface friction (Rapier). Absent uses the backend default. */
  friction?: number;
  /** Surface restitution / bounciness (Rapier). Absent uses the backend default. */
  restitution?: number;
  /** Emit begin/end overlap events for sensors. Absent means true. */
  generateOverlapEvents?: boolean;
  /** Emit hit events while simulating physics. Absent means true. */
  simulationGeneratesHitEvents?: boolean;
  /** Packed Rapier interaction groups (membership<<16 | filter). Absent = interact with all. */
  collisionGroups?: number;
  simulatePhysics?: boolean;
  massKg?: number;
  linearDamping?: number;
  angularDamping?: number;
  enableGravity?: boolean;
  lockPosition?: LayoutPhysicsAxisLocks;
  lockRotation?: LayoutPhysicsAxisLocks;
}

export interface AudioComponent {
  clipId: string;
  /** Explicit source asset ID; overrides `clipId` when present. */
  sourceId?: string;
  /** `"soundCue"` when the source is a Sound Cue graph asset; `"sound"` or absent = raw clip. */
  sourceType?: "sound" | "soundCue";
  volume: number;
  /** Pitch / playback-rate multiplier (1 = unchanged). Absent means the runtime default. */
  pitch?: number;
  loop: boolean;
  spatial: boolean;
  /** Spatial attenuation overrides (only used when `spatial`); map to the runtime `PannerNode`. */
  refDistance?: number;
  maxDistance?: number;
  rolloff?: number;
  /** Play automatically on scene load (ambient). Absent means false. */
  autoPlay?: boolean;
}

/**
 * Drives a particle/VFX emitter from a manifest `effectId`. Sizes are in world
 * units, `rate` in particles/second, `lifetime` in seconds; `materialMode` picks
 * the blend and `worldSpace` keeps spawned particles in world space (vs. local to
 * the moving emitter). Absent optional fields let the VFX system apply its
 * defaults. The engine layer only stores the reference; a VFX system (a runtime
 * concern) resolves `effectId` and simulates, like Behavior resolves `scriptId`.
 */
export interface ParticleEmitterComponent {
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
 * Marks an entity as interactable: an `action` id the runtime interprets, an
 * optional player-facing `prompt`, a default `enabled` flag, an optional
 * `requires` gate (e.g. an inventory/key id) and an optional `cooldown` in
 * seconds. Project gameplay rules (runtime) interpret these; the engine only
 * stores the authored data, like Behavior/Metadata. Typically paired with a
 * (sensor) {@link ColliderComponent} so an InteractionSystem can detect overlap.
 */
export interface InteractionComponent {
  action: string;
  prompt?: string;
  enabled?: boolean;
  requires?: string;
  cooldown?: number;
}

export type CharacterMovementMode = "walking" | "falling" | "flying" | "swimming" | "custom";

export interface CharacterMovementComponent {
  maxWalkSpeed: number;
  sprintMultiplier: number;
  jumpSpeed: number;
  gravityScale: number;
  airControl: number;
  acceleration: number;
  brakingDeceleration: number;
  groundFriction: number;
  rotationRate: Vec3;
  orientRotationToMovement: boolean;
  orientRotationToControl: boolean;
  movementMode: CharacterMovementMode;
  capsuleRadius: number;
  capsuleHalfHeight: number;
  maxStepHeight: number;
}

/**
 * A camera viewpoint authored on an actor (Unreal's `UCameraComponent`). A
 * possessed pawn carrying this, typically as a {@link SpringArmComponent} child,
 * drives the play camera's projection and camera-specific gameplay effects.
 * `fieldOfView` is the vertical FOV in degrees; clip planes are in world units;
 * `orthoWidth` applies only when `isOrthographic`. Defaults mirror the current
 * runtime camera (FOV 44, near 0.1, far 100) so the next phase maps 1:1.
 */
export interface CameraComponent {
  fieldOfView: number;
  nearClip: number;
  farClip: number;
  isOrthographic: boolean;
  orthoWidth: number;
  enableSprintCameraShake: boolean;
}

/**
 * A camera boom authored on an actor (Unreal's `USpringArmComponent`). It holds a
 * {@link CameraComponent} at a fixed distance behind a pivot, optionally lagging
 * and collision-probing in the TPS Game Mode.
 *  - `targetArmLength`: distance from the pivot to the camera socket (world units).
 *  - `socketOffset`: offset applied at the camera socket (end of the arm).
 *  - `targetOffset`: offset applied to the pivot the arm orbits.
 *  - `enableCameraLag` / `cameraLagSpeed`: exponential position smoothing.
 *  - `doCollisionTest`: pull the camera in when the boom is blocked.
 */
export interface SpringArmComponent {
  targetArmLength: number;
  socketOffset: Vec3;
  targetOffset: Vec3;
  enableCameraLag: boolean;
  cameraLagSpeed: number;
  doCollisionTest: boolean;
}

function readVec3(value: SceneJsonValue | undefined): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return undefined;
  return [x, y, z];
}

function readPhysicsAxisLocks(
  value: SceneJsonValue | undefined,
): LayoutPhysicsAxisLocks | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  if (typeof x !== "boolean" || typeof y !== "boolean" || typeof z !== "boolean") {
    return undefined;
  }
  return [x, y, z];
}

/** Reads a typed transform from an entity's serializable component data. */
export function readTransformComponent(entity: Entity): TransformComponent | undefined {
  const data = entity.components[TRANSFORM_COMPONENT];
  if (!data) return undefined;
  const position = readVec3(data.position);
  const rotation = readVec3(data.rotation);
  const scale = readVec3(data.scale);
  if (!position || !rotation || !scale) return undefined;
  return { position, rotation, scale };
}

/** Reads a typed mesh renderer from an entity's serializable component data. */
export function readMeshRendererComponent(entity: Entity): MeshRendererComponent | undefined {
  const data = entity.components[MESH_RENDERER_COMPONENT];
  if (!data) return undefined;
  if (typeof data.assetId !== "string") return undefined;
  const component: MeshRendererComponent = { assetId: data.assetId };
  if (typeof data.materialSlot === "string") component.materialSlot = data.materialSlot;
  if (typeof data.castShadow === "boolean") component.castShadow = data.castShadow;
  if (typeof data.receiveShadow === "boolean") component.receiveShadow = data.receiveShadow;
  const scale = readVec3(data.scale);
  if (scale) component.scale = scale;
  return component;
}

/** Reads a typed metadata component from an entity's serializable component data. */
export function readMetadataComponent(entity: Entity): MetadataComponent | undefined {
  const data = entity.components[METADATA_COMPONENT];
  if (!data) return undefined;
  const values = data.values;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return undefined;
  return { values: { ...(values as Record<string, SceneJsonValue>) } };
}

/** Reads a typed behavior reference from an entity's serializable component data. */
export function readBehaviorComponent(entity: Entity): BehaviorComponent | undefined {
  const data = entity.components[BEHAVIOR_COMPONENT];
  if (!data) return undefined;
  if (typeof data.scriptId !== "string" || data.scriptId.length === 0) return undefined;
  const component: BehaviorComponent = { scriptId: data.scriptId };
  const params = data.params;
  if (typeof params === "object" && params !== null && !Array.isArray(params)) {
    component.params = { ...(params as Record<string, SceneJsonValue>) };
  }
  return component;
}

/** Reads runtime script message bindings from an entity. */
export function readMessageBindingsComponent(entity: Entity): MessageBindingsComponent | undefined {
  const data = entity.components[MESSAGE_BINDINGS_COMPONENT];
  if (!data) return undefined;
  const rawBindings = Array.isArray(data.bindings) ? data.bindings : [];
  const bindings: MessageBindingComponentEntry[] = [];
  for (const raw of rawBindings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, SceneJsonValue>;
    if (typeof record.message !== "string" || record.message.length === 0) continue;
    if (typeof record.scriptId !== "string" || record.scriptId.length === 0) continue;
    const binding: MessageBindingComponentEntry = {
      message: record.message,
      scriptId: record.scriptId,
      target: record.target === "any" ? "any" : "self",
    };
    if (typeof record.params === "object" && record.params !== null && !Array.isArray(record.params)) {
      binding.params = { ...(record.params as Record<string, SceneJsonValue>) };
    }
    bindings.push(binding);
  }
  return bindings.length > 0 ? { bindings } : undefined;
}

/** Reads interface/capability labels advertised by a script-authored entity. */
export function readScriptInterfacesComponent(entity: Entity): ScriptInterfacesComponent | undefined {
  const data = entity.components[SCRIPT_INTERFACES_COMPONENT];
  if (!data || !Array.isArray(data.interfaces)) return undefined;
  const interfaces = data.interfaces.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return interfaces.length > 0 ? { interfaces } : undefined;
}

/** Reads placed Actor Script instance metadata used by world queries. */
export function readScriptActorComponent(entity: Entity): ScriptActorComponent | undefined {
  const data = entity.components[SCRIPT_ACTOR_COMPONENT];
  if (!data || typeof data.classRef !== "string" || data.classRef.length === 0) return undefined;
  const component: ScriptActorComponent = { classRef: data.classRef };
  if (typeof data.nodeId === "string" && data.nodeId.length > 0) component.nodeId = data.nodeId;
  return component;
}

function readScriptReferenceSelector(
  value: SceneJsonValue | undefined,
): ScriptReferenceSelectorComponent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, SceneJsonValue>;
  const selector: ScriptReferenceSelectorComponent = {};
  if (typeof input.byNodeId === "string" && input.byNodeId.length > 0) {
    selector.byNodeId = input.byNodeId;
  }
  if (typeof input.byName === "string" && input.byName.length > 0) selector.byName = input.byName;
  if (typeof input.byTag === "string" && input.byTag.length > 0) selector.byTag = input.byTag;
  if (typeof input.byClassRef === "string" && input.byClassRef.length > 0) {
    selector.byClassRef = input.byClassRef;
  }
  if (typeof input.byInterface === "string" && input.byInterface.length > 0) {
    selector.byInterface = input.byInterface;
  }
  return Object.keys(selector).length > 0 ? selector : undefined;
}

/** Reads class-authored reference selectors from an entity. */
export function readScriptReferencesComponent(entity: Entity): ScriptReferencesComponent | undefined {
  const data = entity.components[SCRIPT_REFERENCES_COMPONENT];
  if (!data || !Array.isArray(data.references)) return undefined;
  const references: ScriptReferenceComponentEntry[] = [];
  for (const raw of data.references) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, SceneJsonValue>;
    if (typeof record.key !== "string" || record.key.length === 0) continue;
    const selector = readScriptReferenceSelector(record.selector);
    if (!selector) continue;
    references.push({ key: record.key, selector });
  }
  return references.length > 0 ? { references } : undefined;
}

/** Reads message dispatcher metadata advertised by a script-authored entity. */
export function readScriptDispatchersComponent(entity: Entity): ScriptDispatchersComponent | undefined {
  const data = entity.components[SCRIPT_DISPATCHERS_COMPONENT];
  if (!data || !Array.isArray(data.dispatchers)) return undefined;
  const dispatchers: ScriptDispatcherComponentEntry[] = [];
  for (const raw of data.dispatchers) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, SceneJsonValue>;
    if (typeof record.name !== "string" || record.name.length === 0) continue;
    const payload: Record<string, string> = {};
    if (record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)) {
      for (const [key, value] of Object.entries(record.payload)) {
        if (typeof value === "string" && value.length > 0) payload[key] = value;
      }
    }
    dispatchers.push({ name: record.name, payload });
  }
  return dispatchers.length > 0 ? { dispatchers } : undefined;
}

const COLLIDER_SHAPES: readonly ColliderShape[] = [
  "box",
  "sphere",
  "capsule",
  "cylinder",
  "cone",
  "convex",
  "trimesh",
];

/** Parses the optional compound-collider `primitives` array. */
function readColliderPrimitives(
  value: SceneJsonValue | undefined,
): ColliderPrimitive[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const primitives: ColliderPrimitive[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, SceneJsonValue>;
    if (
      typeof record.shape !== "string" ||
      !COLLIDER_SHAPES.includes(record.shape as ColliderShape)
    ) {
      continue;
    }
    const size = readVec3(record.size);
    if (!size) continue;
    const primitive: ColliderPrimitive = { shape: record.shape as ColliderShape, size };
    const center = readVec3(record.center);
    if (center) primitive.center = center;
    const rotation = readVec3(record.rotation);
    if (rotation) primitive.rotation = rotation;
    if (Array.isArray(record.points)) {
      const points = record.points
        .map((point) => readVec3(point))
        .filter((point): point is Vec3 => point !== undefined);
      if (points.length > 0) primitive.points = points;
    }
    if (Array.isArray(record.vertices)) {
      const vertices = record.vertices
        .map((point) => readVec3(point))
        .filter((point): point is Vec3 => point !== undefined);
      if (vertices.length > 0) primitive.vertices = vertices;
    }
    if (Array.isArray(record.indices)) {
      const indices = record.indices.filter(
        (index): index is number =>
          typeof index === "number" && Number.isInteger(index) && index >= 0,
      );
      if (indices.length > 0) primitive.indices = indices;
    }
    primitives.push(primitive);
  }
  return primitives.length > 0 ? primitives : undefined;
}

/** Reads a typed collider from an entity's serializable component data. */
export function readColliderComponent(entity: Entity): ColliderComponent | undefined {
  const data = entity.components[COLLIDER_COMPONENT];
  if (!data) return undefined;
  if (typeof data.shape !== "string" || !COLLIDER_SHAPES.includes(data.shape as ColliderShape)) {
    return undefined;
  }
  const shape = data.shape as ColliderShape;
  const authoredSize = readVec3(data.size);
  const capsuleRadius =
    shape === "capsule" ? readFiniteNumber(data.capsuleRadius, NaN, 0) : NaN;
  const capsuleHalfHeight =
    shape === "capsule" ? readFiniteNumber(data.capsuleHalfHeight, NaN, 0) : NaN;
  const capsule =
    shape === "capsule" && Number.isFinite(capsuleRadius) && Number.isFinite(capsuleHalfHeight)
      ? resolveCapsuleDimensions(capsuleRadius, capsuleHalfHeight)
      : null;
  const size = capsule?.size ?? authoredSize;
  if (!size) return undefined;
  if (typeof data.isStatic !== "boolean" || typeof data.isSensor !== "boolean") return undefined;
  const center = readVec3(data.center) ?? capsule?.center;
  const component: ColliderComponent = {
    shape,
    size,
    isStatic: data.isStatic,
    isSensor: data.isSensor,
  };
  if (capsule) {
    component.capsuleRadius = capsule.radius;
    component.capsuleHalfHeight = capsule.halfHeight;
  }
  if (center) component.center = center;
  const primitives = readColliderPrimitives(data.primitives);
  if (primitives) component.primitives = primitives;
  if (typeof data.friction === "number") component.friction = data.friction;
  if (typeof data.restitution === "number") component.restitution = data.restitution;
  if (typeof data.generateOverlapEvents === "boolean") {
    component.generateOverlapEvents = data.generateOverlapEvents;
  }
  if (typeof data.simulationGeneratesHitEvents === "boolean") {
    component.simulationGeneratesHitEvents = data.simulationGeneratesHitEvents;
  }
  if (typeof data.collisionGroups === "number") component.collisionGroups = data.collisionGroups;
  if (typeof data.simulatePhysics === "boolean") component.simulatePhysics = data.simulatePhysics;
  if (typeof data.massKg === "number") component.massKg = data.massKg;
  if (typeof data.linearDamping === "number") component.linearDamping = data.linearDamping;
  if (typeof data.angularDamping === "number") component.angularDamping = data.angularDamping;
  if (typeof data.enableGravity === "boolean") component.enableGravity = data.enableGravity;
  const lockPosition = readPhysicsAxisLocks(data.lockPosition);
  if (lockPosition) component.lockPosition = lockPosition;
  const lockRotation = readPhysicsAxisLocks(data.lockRotation);
  if (lockRotation) component.lockRotation = lockRotation;
  return component;
}

/**
 * Reads a typed audio cue from an entity's serializable component data.
 *
 * Tolerant of partial component data: an Actor Blueprint Audio component stores
 * only the props the author set (no adapter defaults are applied on the actor
 * path), so `volume`/`loop`/`spatial` may be absent and default here (1/false/
 * false). The only hard requirement is something to play — a raw `clipId` OR a
 * Sound Cue `sourceId` (a cue resolves its own clips, so `clipId` may be absent).
 */
export function readAudioComponent(entity: Entity): AudioComponent | undefined {
  const data = entity.components[AUDIO_COMPONENT];
  if (!data) return undefined;
  const clipId = typeof data.clipId === "string" ? data.clipId : "";
  const isCueSource =
    data.sourceType === "soundCue" && typeof data.sourceId === "string" && data.sourceId.length > 0;
  if (clipId.length === 0 && !isCueSource) return undefined;
  const component: AudioComponent = {
    clipId,
    volume: typeof data.volume === "number" && Number.isFinite(data.volume) ? data.volume : 1,
    loop: data.loop === true,
    spatial: data.spatial === true,
  };
  if (typeof data.sourceId === "string" && data.sourceId.length > 0) component.sourceId = data.sourceId;
  if (data.sourceType === "sound" || data.sourceType === "soundCue") {
    component.sourceType = data.sourceType;
  }
  if (typeof data.pitch === "number" && Number.isFinite(data.pitch)) component.pitch = data.pitch;
  if (typeof data.refDistance === "number" && Number.isFinite(data.refDistance)) {
    component.refDistance = data.refDistance;
  }
  if (typeof data.maxDistance === "number" && Number.isFinite(data.maxDistance)) {
    component.maxDistance = data.maxDistance;
  }
  if (typeof data.rolloff === "number" && Number.isFinite(data.rolloff)) component.rolloff = data.rolloff;
  if (typeof data.autoPlay === "boolean") component.autoPlay = data.autoPlay;
  return component;
}

const PARTICLE_MATERIAL_MODES: readonly ParticleMaterialMode[] = ["additive", "alpha"];

/** Reads a typed particle emitter from an entity's serializable component data. */
export function readParticleEmitterComponent(
  entity: Entity,
): ParticleEmitterComponent | undefined {
  const data = entity.components[PARTICLE_EMITTER_COMPONENT];
  if (!data) return undefined;
  if (typeof data.effectId !== "string" || data.effectId.length === 0) return undefined;
  const component: ParticleEmitterComponent = { effectId: data.effectId };
  if (typeof data.loop === "boolean") component.loop = data.loop;
  if (typeof data.rate === "number") component.rate = data.rate;
  if (typeof data.lifetime === "number") component.lifetime = data.lifetime;
  if (typeof data.startSize === "number") component.startSize = data.startSize;
  if (typeof data.endSize === "number") component.endSize = data.endSize;
  const velocity = readVec3(data.velocity);
  if (velocity) component.velocity = velocity;
  if (typeof data.spread === "number") component.spread = data.spread;
  if (
    typeof data.materialMode === "string" &&
    PARTICLE_MATERIAL_MODES.includes(data.materialMode as ParticleMaterialMode)
  ) {
    component.materialMode = data.materialMode as ParticleMaterialMode;
  }
  if (typeof data.worldSpace === "boolean") component.worldSpace = data.worldSpace;
  if (typeof data.autoPlay === "boolean") component.autoPlay = data.autoPlay;
  return component;
}

/** Reads a typed interaction marker from an entity's serializable component data. */
export function readInteractionComponent(entity: Entity): InteractionComponent | undefined {
  const data = entity.components[INTERACTION_COMPONENT];
  if (!data) return undefined;
  if (typeof data.action !== "string" || data.action.length === 0) return undefined;
  const component: InteractionComponent = { action: data.action };
  if (typeof data.prompt === "string") component.prompt = data.prompt;
  if (typeof data.enabled === "boolean") component.enabled = data.enabled;
  if (typeof data.requires === "string") component.requires = data.requires;
  if (typeof data.cooldown === "number") component.cooldown = data.cooldown;
  return component;
}

const CHARACTER_MOVEMENT_MODES: readonly CharacterMovementMode[] = [
  "walking",
  "falling",
  "flying",
  "swimming",
  "custom",
];

function readFiniteNumber(
  value: SceneJsonValue | undefined,
  fallback: number,
  minExclusive?: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (minExclusive !== undefined && value <= minExclusive) return fallback;
  return value;
}

/** Reads a typed character movement component from an entity. */
export function readCharacterMovementComponent(
  entity: Entity,
): CharacterMovementComponent | undefined {
  const data = entity.components[CHARACTER_MOVEMENT_COMPONENT];
  if (!data) return undefined;
  const mode =
    typeof data.movementMode === "string" &&
    CHARACTER_MOVEMENT_MODES.includes(data.movementMode as CharacterMovementMode)
      ? (data.movementMode as CharacterMovementMode)
      : "walking";
  return {
    maxWalkSpeed: readFiniteNumber(data.maxWalkSpeed, 3, 0),
    sprintMultiplier: readFiniteNumber(data.sprintMultiplier, 2, 0),
    jumpSpeed: readFiniteNumber(data.jumpSpeed, 4, 0),
    gravityScale: readFiniteNumber(data.gravityScale, 1),
    airControl: readFiniteNumber(data.airControl, 0.25),
    acceleration: readFiniteNumber(data.acceleration, 30, 0),
    brakingDeceleration: readFiniteNumber(data.brakingDeceleration, 24, 0),
    groundFriction: readFiniteNumber(data.groundFriction, 8, 0),
    rotationRate: readVec3(data.rotationRate) ?? [0, 0, 500],
    orientRotationToMovement: data.orientRotationToMovement !== false,
    orientRotationToControl: data.orientRotationToControl === true,
    movementMode: mode,
    capsuleRadius: readFiniteNumber(data.capsuleRadius, 0.3, 0),
    capsuleHalfHeight: readFiniteNumber(data.capsuleHalfHeight, 0.9, 0),
    maxStepHeight: readFiniteNumber(data.maxStepHeight, 0.45, 0),
  };
}

/** Reads a typed camera viewpoint from an entity's serializable component data. */
export function readCameraComponent(entity: Entity): CameraComponent | undefined {
  const data = entity.components[CAMERA_COMPONENT];
  if (!data) return undefined;
  return {
    fieldOfView: readFiniteNumber(data.fieldOfView, 44, 0),
    nearClip: readFiniteNumber(data.nearClip, 0.1, 0),
    farClip: readFiniteNumber(data.farClip, 100, 0),
    isOrthographic: data.isOrthographic === true,
    orthoWidth: readFiniteNumber(data.orthoWidth, 10, 0),
    enableSprintCameraShake: data.enableSprintCameraShake !== false,
  };
}

/** Reads a typed camera-boom (spring arm) from an entity's serializable data. */
export function readSpringArmComponent(entity: Entity): SpringArmComponent | undefined {
  const data = entity.components[SPRING_ARM_COMPONENT];
  if (!data) return undefined;
  return {
    targetArmLength: readFiniteNumber(data.targetArmLength, 3, 0),
    socketOffset: readVec3(data.socketOffset) ?? [0, 0, 0],
    targetOffset: readVec3(data.targetOffset) ?? [0, 0, 0],
    enableCameraLag: data.enableCameraLag === true,
    cameraLagSpeed: readFiniteNumber(data.cameraLagSpeed, 10, 0),
    doCollisionTest: data.doCollisionTest !== false,
  };
}

const LIGHT_TYPES: readonly SceneLightType[] = ["directional", "point", "spot"];

/** Reads a typed light from an entity's serializable component data. */
export function readLightComponent(entity: Entity): LightComponent | undefined {
  const data = entity.components[LIGHT_COMPONENT];
  if (!data) return undefined;
  if (typeof data.type !== "string" || !LIGHT_TYPES.includes(data.type as SceneLightType)) {
    return undefined;
  }
  const component: LightComponent = { type: data.type as SceneLightType };
  if (typeof data.color === "string") component.color = data.color;
  if (typeof data.intensity === "number") component.intensity = data.intensity;
  if (typeof data.castShadow === "boolean") component.castShadow = data.castShadow;
  if (typeof data.distance === "number") component.distance = data.distance;
  if (typeof data.angle === "number") component.angle = data.angle;
  if (typeof data.penumbra === "number") component.penumbra = data.penumbra;
  if (typeof data.decay === "number") component.decay = data.decay;
  return component;
}
