/**
 * Legacy RoomLayout -> SceneDocument adapter.
 *
 * Converts the current authoring format (`RoomLayout` with `instances`,
 * `characters`, and `lights`) into the minimal engine `SceneDocument` /
 * entity-component model without changing the saved format. The legacy
 * `RoomLayout` remains the saved authoring format for this stage; this adapter
 * only derives a read model.
 *
 * Identity: entity ids intentionally mirror the editor selection id format
 * (`editor/core/selection.ts#selectionId`) so a derived SceneDocument keeps
 * stable identity with legacy selections:
 *   - instance:  `instance:<encodeURIComponent(assetId)>:<placementIndex>`
 *   - character: `character:<index>`
 *   - light:     `light:<index>`
 * The engine layer must not import editor code, so the format is duplicated
 * here on purpose and must stay in sync with the editor selection id.
 *
 * Hierarchy: the legacy format uses a separate `nodeId`/`parentId` id space
 * (a child's `parentId` references its parent's `nodeId`). This adapter
 * collapses that into the single SceneDocument id space: a child's
 * `entity.parentId` is resolved to the parent entity's id. Dangling parent
 * references (no matching `nodeId`) are dropped rather than preserved invalid.
 *
 * Intentionally NOT mapped in this minimal slice (documented gaps, not
 * oversights):
 *   - `groupId`     editor multi-select grouping
 *   - `pivot`       editor authoring pivot (runtime consumes the baked transform)
 *   - `scaleLocked` editor proportional-scale hint
 *   - `animation`   character animation (future animation/character component)
 *   - per-object `receiveShadow` (world-level static shadow flags are used)
 */
import {
  type LayoutBehavior,
  type LayoutAudio,
  type LayoutCharacter,
  type LayoutLightActor,
  type LayoutMetadata,
  type LayoutPlacement,
  type LayoutPhysics,
  type LayoutWorldSettings,
  type RoomLayout,
  type Vec3,
} from "./layout";
import {
  resolveCollisionProfile,
  type AssetCollisionDef,
  type CollisionPresetId,
  type CollisionPrimitive,
} from "./collision";
import { readRotation, readScale } from "./transform";
import type { Entity, EntityComponentData, EntityComponentMap, SceneJsonValue } from "./entity";
import {
  BEHAVIOR_COMPONENT,
  AUDIO_COMPONENT,
  COLLIDER_COMPONENT,
  LIGHT_COMPONENT,
  MESH_RENDERER_COMPONENT,
  METADATA_COMPONENT,
  TRANSFORM_COMPONENT,
  type AudioComponent,
  type BehaviorComponent,
  type ColliderComponent,
  type ColliderPrimitive,
  type ColliderShape,
  type LightComponent,
  type MeshRendererComponent,
  type MetadataComponent,
  type TransformComponent,
} from "./components";
import {
  SCENE_DOCUMENT_SCHEMA_VERSION,
  type SceneDocument,
  type SceneWorldSettings,
} from "./sceneDocument";

/** Transform-bearing source a collider-box resolver reads to size a collider. */
export type ColliderTransformSource = {
  position: Vec3;
  rotation?: Vec3;
  rotationYDeg?: number;
  scale?: number | Vec3;
};

/**
 * Resolves the world-aligned collider footprint (size + center offset) for a
 * placed asset. Supplied by the render-capable host (it needs the loaded model
 * bounds); returns undefined when bounds are unknown so the adapter falls back
 * to a scaled unit box. Kept as a pure function type so this adapter stays
 * Three.js-free.
 */
export type ColliderBoxResolver = (
  assetId: string,
  source: ColliderTransformSource,
) => { size: Vec3; center: Vec3 } | undefined;

export interface RoomLayoutAdapterOptions {
  colliderBox?: ColliderBoxResolver;
  /** Authored asset collision definitions (sidecars) keyed by asset id. */
  collisionDefs?: ReadonlyMap<string, AssetCollisionDef>;
}

/** Mirrors `editor/core/selection.ts#selectionId` for the instance kind. */
export function instanceEntityId(assetId: string, placementIndex: number): string {
  return `instance:${encodeURIComponent(assetId)}:${placementIndex}`;
}

/** Mirrors `editor/core/selection.ts#selectionId` for the character kind. */
export function characterEntityId(index: number): string {
  return `character:${index}`;
}

/** Mirrors `editor/core/selection.ts#selectionId` for the light kind. */
export function lightEntityId(index: number): string {
  return `light:${index}`;
}

/**
 * Derives the instance entities for a single asset's placements, in placement
 * order. Used by the render adapter to drive static mesh instances from the
 * entity/component model. Parent hierarchy is not resolved here because
 * instanced static meshes bake each placement's own world transform (they do
 * not apply parent transforms).
 */
export function instanceEntitiesForAsset(
  assetId: string,
  placements: LayoutPlacement[],
): Entity[] {
  return placements.map((placement, index) =>
    buildEntity(
      instanceEntityId(assetId, index),
      placement.name,
      instanceComponents(assetId, placement),
      flagTags(placement),
    ),
  );
}

/**
 * Derives the entity for a single character placement at its layout index.
 * Used by the render adapter to drive character objects from the
 * entity/component model. The index mirrors the editor character selection id;
 * it does not affect render output (the render builder reads only transform,
 * mesh-renderer, and the `hidden` tag). Parent hierarchy is not resolved here
 * because a character object bakes its own world transform like instances do.
 */
export function characterEntity(index: number, character: LayoutCharacter): Entity {
  return buildEntity(
    characterEntityId(index),
    character.name,
    characterComponents(character),
    flagTags(character),
  );
}

/**
 * Derives the entity for a single light actor at its layout index. Used by the
 * render adapter to drive light objects from the entity/component model. The
 * index mirrors the editor light selection id. The actor's display name
 * (`name ?? id`) is resolved into `entity.name` here because the light's `id`
 * is not a component field; the render builder reads `entity.name` directly.
 * Parent hierarchy is not resolved here (a light bakes its own world transform).
 */
export function lightEntity(index: number, light: LayoutLightActor): Entity {
  return buildEntity(
    lightEntityId(index),
    light.name ?? light.id,
    lightComponents(light),
    flagTags(light),
  );
}

export function roomLayoutToSceneDocument(
  layout: RoomLayout,
  options: RoomLayoutAdapterOptions = {},
): SceneDocument {
  const pending: PendingEntity[] = [];
  const nodeIdToEntityId = new Map<string, string>();

  const registerNode = (entityId: string, nodeId: string | undefined): void => {
    if (nodeId !== undefined) nodeIdToEntityId.set(nodeId, entityId);
  };

  for (const instance of layout.instances) {
    instance.placements.forEach((placement, index) => {
      const id = instanceEntityId(instance.assetId, index);
      registerNode(id, placement.nodeId);
      pending.push({
        entity: buildEntity(
          id,
          placement.name,
          instanceComponents(
            instance.assetId,
            placement,
            options.colliderBox,
            options.collisionDefs?.get(instance.assetId),
          ),
          flagTags(placement),
        ),
        legacyParentId: placement.parentId,
      });
    });
  }

  layout.characters.forEach((character, index) => {
    const id = characterEntityId(index);
    registerNode(id, character.nodeId);
    pending.push({
      entity: buildEntity(
        id,
        character.name,
        characterComponents(
          character,
          options.colliderBox,
          options.collisionDefs?.get(character.assetId),
        ),
        flagTags(character),
      ),
      legacyParentId: character.parentId,
    });
  });

  (layout.lights ?? []).forEach((light, index) => {
    const entity = lightEntity(index, light);
    registerNode(entity.id, light.nodeId);
    pending.push({ entity, legacyParentId: light.parentId });
  });

  for (const item of pending) {
    if (item.legacyParentId === undefined) continue;
    const parentEntityId = nodeIdToEntityId.get(item.legacyParentId);
    if (parentEntityId !== undefined) item.entity.parentId = parentEntityId;
  }

  const document: SceneDocument = {
    schema: SCENE_DOCUMENT_SCHEMA_VERSION,
    name: layout.name,
    entities: pending.map((item) => item.entity),
  };
  if (layout.worldSettings) {
    const settings = sceneWorldSettings(layout.worldSettings);
    if (Object.keys(settings).length > 0) document.worldSettings = settings;
  }
  return document;
}

interface PendingEntity {
  entity: Entity;
  /** Legacy parent reference (a parent object's `nodeId`), resolved in a second pass. */
  legacyParentId: string | undefined;
}

function buildEntity(
  id: string,
  name: string | undefined,
  components: EntityComponentMap,
  tags: string[],
): Entity {
  const entity: Entity = { id, components };
  if (name !== undefined) entity.name = name;
  if (tags.length > 0) entity.tags = tags;
  return entity;
}

function instanceComponents(
  assetId: string,
  placement: LayoutPlacement,
  resolveBox?: ColliderBoxResolver,
  collisionDef?: AssetCollisionDef,
): EntityComponentMap {
  const components: EntityComponentMap = {
    [TRANSFORM_COMPONENT]: toData(transformComponent(placement)),
    [MESH_RENDERER_COMPONENT]: toData(meshRendererComponent(assetId, placement.castShadow)),
  };
  const collider = colliderComponent(assetId, placement, true, resolveBox, collisionDef);
  if (collider) components[COLLIDER_COMPONENT] = toData(collider);
  const metadata = metadataComponent(placement.metadata);
  if (metadata) components[METADATA_COMPONENT] = toData(metadata);
  const behavior = behaviorComponent(placement.behavior);
  if (behavior) components[BEHAVIOR_COMPONENT] = toData(behavior);
  const audio = audioComponent(placement.audio);
  if (audio) components[AUDIO_COMPONENT] = toData(audio);
  return components;
}

function characterComponents(
  character: LayoutCharacter,
  resolveBox?: ColliderBoxResolver,
  collisionDef?: AssetCollisionDef,
): EntityComponentMap {
  const components: EntityComponentMap = {
    [TRANSFORM_COMPONENT]: toData(transformComponent(character)),
    [MESH_RENDERER_COMPONENT]: toData(meshRendererComponent(character.assetId, character.castShadow)),
  };
  const collider = colliderComponent(character.assetId, character, false, resolveBox, collisionDef);
  if (collider) components[COLLIDER_COMPONENT] = toData(collider);
  const metadata = metadataComponent(character.metadata);
  if (metadata) components[METADATA_COMPONENT] = toData(metadata);
  const behavior = behaviorComponent(character.behavior);
  if (behavior) components[BEHAVIOR_COMPONENT] = toData(behavior);
  const audio = audioComponent(character.audio);
  if (audio) components[AUDIO_COMPONENT] = toData(audio);
  return components;
}

function lightComponents(light: LayoutLightActor): EntityComponentMap {
  return {
    [TRANSFORM_COMPONENT]: toData(transformComponent(light)),
    [LIGHT_COMPONENT]: toData(lightComponent(light)),
  };
}

function transformComponent(source: {
  position: Vec3;
  rotation?: Vec3;
  rotationYDeg?: number;
  scale?: number | Vec3;
}): TransformComponent {
  return {
    position: [source.position[0], source.position[1], source.position[2]],
    rotation: readRotation(source),
    scale: readScale(source),
  };
}

function meshRendererComponent(assetId: string, castShadow: boolean | undefined): MeshRendererComponent {
  const component: MeshRendererComponent = { assetId };
  if (castShadow !== undefined) component.castShadow = castShadow;
  return component;
}

function lightComponent(light: LayoutLightActor): LightComponent {
  const component: LightComponent = { type: light.type };
  if (light.color !== undefined) component.color = light.color;
  if (light.intensity !== undefined) component.intensity = light.intensity;
  if (light.castShadow !== undefined) component.castShadow = light.castShadow;
  if (light.distance !== undefined) component.distance = light.distance;
  if (light.angle !== undefined) component.angle = light.angle;
  if (light.penumbra !== undefined) component.penumbra = light.penumbra;
  if (light.decay !== undefined) component.decay = light.decay;
  return component;
}

function behaviorComponent(behavior: LayoutBehavior | undefined): BehaviorComponent | null {
  if (!behavior) return null;
  const component: BehaviorComponent = { scriptId: behavior.script };
  if (behavior.params) {
    const params: Record<string, SceneJsonValue> = {};
    for (const [key, value] of Object.entries(behavior.params)) {
      params[key] = Array.isArray(value) ? [...value] : value;
    }
    if (Object.keys(params).length > 0) component.params = params;
  }
  return component;
}

function colliderComponent(
  assetId: string,
  source: ColliderTransformSource & {
    collision?: boolean;
    collisionPreset?: CollisionPresetId;
    sensor?: boolean;
    simulatePhysics?: boolean;
    physics?: LayoutPhysics;
  },
  isStatic: boolean,
  resolveBox: ColliderBoxResolver | undefined,
  collisionDef?: AssetCollisionDef,
): ColliderComponent | null {
  const simulatePhysics = source.simulatePhysics === true;
  if (source.collision === false && !simulatePhysics) return null;
  // A per-placement collision preset maps onto the runtime collider: a
  // collision-disabled preset drops the collider (unless it's a simulated
  // body), and a query-only preset becomes a non-blocking sensor. Physics
  // presets stay solid blockers.
  const profile = source.collisionPreset
    ? resolveCollisionProfile(source.collisionPreset)
    : null;
  if (profile?.collisionEnabled === "none" && !simulatePhysics) return null;
  const isSensor = source.sensor === true || profile?.collisionEnabled === "query";
  const isStaticFinal = isStatic && !simulatePhysics;

  let component: ColliderComponent;
  // Authored simple-collision primitives (Static Mesh editor sidecar) drive a
  // compound collider; placement scale is baked into each primitive, and the
  // top-level size/center is the encompassing AABB (broad-phase + movement).
  const primitives =
    collisionDef && collisionDef.primitives.length > 0
      ? bakeColliderPrimitives(collisionDef.primitives, readScale(source))
      : null;
  if (primitives && primitives.length > 0) {
    const aabb = encompassingAabb(primitives);
    component = { shape: "box", size: aabb.size, isStatic: isStaticFinal, isSensor, primitives };
    if (!isZeroVec3(aabb.center)) component.center = aabb.center;
  } else {
    // World-aligned footprint from the model's bounds when the host can supply
    // them; otherwise a scaled unit box. Rotation intentionally does not resize
    // the collider; placement scale is baked into `size`, since the physics
    // layer no longer rescales.
    const box = resolveBox?.(assetId, source);
    component = {
      shape: "box",
      size: box?.size ?? readScale(source),
      isStatic: isStaticFinal,
      isSensor,
    };
    if (box && !isZeroVec3(box.center)) component.center = box.center;
  }
  if (simulatePhysics) component.simulatePhysics = true;
  copyPhysicsSettings(component, source.physics);
  return component;
}

/** Bakes authored local primitives into world-scaled collider primitives. */
function bakeColliderPrimitives(
  primitives: readonly CollisionPrimitive[],
  scale: Vec3,
): ColliderPrimitive[] {
  return primitives.map((primitive) => {
    // `convex` has no runtime collider yet; approximate with its bounding box.
    const shape: ColliderShape = primitive.shape === "convex" ? "box" : primitive.shape;
    const baked: ColliderPrimitive = {
      shape,
      size: [
        primitive.size[0] * scale[0],
        primitive.size[1] * scale[1],
        primitive.size[2] * scale[2],
      ],
    };
    if (primitive.center) {
      const center: Vec3 = [
        primitive.center[0] * scale[0],
        primitive.center[1] * scale[1],
        primitive.center[2] * scale[2],
      ];
      if (!isZeroVec3(center)) baked.center = center;
    }
    if (primitive.rotation && !isZeroVec3(primitive.rotation)) {
      baked.rotation = [...primitive.rotation];
    }
    return baked;
  });
}

/** Encompassing AABB (size + center) of a set of baked primitives, ignoring rotation. */
function encompassingAabb(primitives: readonly ColliderPrimitive[]): { size: Vec3; center: Vec3 } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const primitive of primitives) {
    const center = primitive.center ?? [0, 0, 0];
    const hx = primitive.size[0] / 2;
    const hy = primitive.size[1] / 2;
    const hz = primitive.size[2] / 2;
    minX = Math.min(minX, center[0] - hx);
    maxX = Math.max(maxX, center[0] + hx);
    minY = Math.min(minY, center[1] - hy);
    maxY = Math.max(maxY, center[1] + hy);
    minZ = Math.min(minZ, center[2] - hz);
    maxZ = Math.max(maxZ, center[2] + hz);
  }
  return {
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

function isZeroVec3(vec: Vec3): boolean {
  return vec[0] === 0 && vec[1] === 0 && vec[2] === 0;
}

function copyPhysicsSettings(component: ColliderComponent, physics: LayoutPhysics | undefined): void {
  if (!physics) return;
  if (physics.massKg !== undefined) component.massKg = physics.massKg;
  if (physics.linearDamping !== undefined) component.linearDamping = physics.linearDamping;
  if (physics.angularDamping !== undefined) component.angularDamping = physics.angularDamping;
  if (physics.enableGravity !== undefined) component.enableGravity = physics.enableGravity;
  if (physics.lockPosition !== undefined) component.lockPosition = [...physics.lockPosition];
  if (physics.lockRotation !== undefined) component.lockRotation = [...physics.lockRotation];
}

function audioComponent(audio: LayoutAudio | undefined): AudioComponent | null {
  if (!audio) return null;
  return {
    clipId: audio.clipId,
    volume: audio.volume ?? 1,
    loop: audio.loop ?? false,
    spatial: audio.spatial ?? false,
  };
}

function metadataComponent(metadata: LayoutMetadata | undefined): MetadataComponent | null {
  if (!metadata) return null;
  const entries = Object.entries(metadata);
  if (entries.length === 0) return null;
  const values: Record<string, SceneJsonValue> = {};
  for (const [key, value] of entries) {
    values[key] = Array.isArray(value) ? [...value] : value;
  }
  return { values };
}

function flagTags(source: { hidden?: boolean; locked?: boolean }): string[] {
  const tags: string[] = [];
  if (source.hidden) tags.push("hidden");
  if (source.locked) tags.push("locked");
  return tags;
}

function sceneWorldSettings(source: LayoutWorldSettings): SceneWorldSettings {
  const settings: SceneWorldSettings = {};
  if (source.backgroundColor !== undefined) settings.backgroundColor = source.backgroundColor;
  if (source.ambientColor !== undefined) settings.ambientColor = source.ambientColor;
  if (source.ambientIntensity !== undefined) settings.ambientIntensity = source.ambientIntensity;
  if (source.staticObjectsCastShadow !== undefined) {
    settings.staticObjectsCastShadow = source.staticObjectsCastShadow;
  }
  if (source.staticObjectsReceiveShadow !== undefined) {
    settings.staticObjectsReceiveShadow = source.staticObjectsReceiveShadow;
  }
  return settings;
}

/**
 * The single controlled bridge where typed component values (interfaces, which
 * TypeScript does not give an implicit string index signature) enter the
 * generic serializable `EntityComponentData` map. Component construction above
 * is fully type-checked; only this final storage step is cast.
 */
function toData(
  component:
    | TransformComponent
    | MeshRendererComponent
    | LightComponent
    | MetadataComponent
    | BehaviorComponent
    | ColliderComponent
    | AudioComponent,
): EntityComponentData {
  return component as unknown as EntityComponentData;
}
