import type { Entity, SceneJsonValue } from "./entity";
import type { LayoutPhysicsAxisLocks, Vec3 } from "./layout";

export const TRANSFORM_COMPONENT = "Transform";
export const MESH_RENDERER_COMPONENT = "MeshRenderer";
export const LIGHT_COMPONENT = "Light";
export const METADATA_COMPONENT = "Metadata";
export const BEHAVIOR_COMPONENT = "Behavior";
export const COLLIDER_COMPONENT = "Collider";
export const AUDIO_COMPONENT = "Audio";

export type SceneLightType = "directional" | "point" | "spot";
export type ColliderShape = "box" | "sphere" | "capsule";

export interface TransformComponent {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface MeshRendererComponent {
  assetId: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
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
}

export interface ColliderComponent {
  shape: ColliderShape;
  /** World-axis-aligned full size (placement scale already baked in). */
  size: Vec3;
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
  volume: number;
  loop: boolean;
  spatial: boolean;
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
  if (typeof data.castShadow === "boolean") component.castShadow = data.castShadow;
  if (typeof data.receiveShadow === "boolean") component.receiveShadow = data.receiveShadow;
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

const COLLIDER_SHAPES: readonly ColliderShape[] = ["box", "sphere", "capsule"];

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
  const size = readVec3(data.size);
  if (!size) return undefined;
  if (typeof data.isStatic !== "boolean" || typeof data.isSensor !== "boolean") return undefined;
  const center = readVec3(data.center);
  const component: ColliderComponent = {
    shape: data.shape as ColliderShape,
    size,
    isStatic: data.isStatic,
    isSensor: data.isSensor,
  };
  if (center) component.center = center;
  const primitives = readColliderPrimitives(data.primitives);
  if (primitives) component.primitives = primitives;
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

/** Reads a typed audio cue from an entity's serializable component data. */
export function readAudioComponent(entity: Entity): AudioComponent | undefined {
  const data = entity.components[AUDIO_COMPONENT];
  if (!data) return undefined;
  if (typeof data.clipId !== "string" || data.clipId.length === 0) return undefined;
  if (typeof data.volume !== "number" || !Number.isFinite(data.volume)) return undefined;
  if (typeof data.loop !== "boolean" || typeof data.spatial !== "boolean") return undefined;
  return {
    clipId: data.clipId,
    volume: data.volume,
    loop: data.loop,
    spatial: data.spatial,
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
