import type { Entity, SceneJsonValue } from "./entity";
import type { Vec3 } from "./layout";

export const TRANSFORM_COMPONENT = "Transform";
export const MESH_RENDERER_COMPONENT = "MeshRenderer";
export const LIGHT_COMPONENT = "Light";
export const METADATA_COMPONENT = "Metadata";

export type SceneLightType = "directional" | "point" | "spot";

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

function readVec3(value: SceneJsonValue | undefined): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return undefined;
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
