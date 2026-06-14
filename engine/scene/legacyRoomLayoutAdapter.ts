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
 *   - `collision`   runtime physics hint (future Collider component)
 *   - `animation`   character animation (future animation/character component)
 *   - per-object `receiveShadow` (world-level static shadow flags are used)
 */
import {
  type LayoutCharacter,
  type LayoutLightActor,
  type LayoutMetadata,
  type LayoutPlacement,
  type LayoutWorldSettings,
  type RoomLayout,
  type Vec3,
} from "./layout";
import { readRotation, readScale } from "./transform";
import type { Entity, EntityComponentData, EntityComponentMap, SceneJsonValue } from "./entity";
import {
  LIGHT_COMPONENT,
  MESH_RENDERER_COMPONENT,
  METADATA_COMPONENT,
  TRANSFORM_COMPONENT,
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

export function roomLayoutToSceneDocument(layout: RoomLayout): SceneDocument {
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
          instanceComponents(instance.assetId, placement),
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
      entity: buildEntity(id, character.name, characterComponents(character), flagTags(character)),
      legacyParentId: character.parentId,
    });
  });

  (layout.lights ?? []).forEach((light, index) => {
    const id = lightEntityId(index);
    registerNode(id, light.nodeId);
    pending.push({
      entity: buildEntity(id, light.name, lightComponents(light), flagTags(light)),
      legacyParentId: light.parentId,
    });
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

function instanceComponents(assetId: string, placement: LayoutPlacement): EntityComponentMap {
  const components: EntityComponentMap = {
    [TRANSFORM_COMPONENT]: toData(transformComponent(placement)),
    [MESH_RENDERER_COMPONENT]: toData(meshRendererComponent(assetId, placement.castShadow)),
  };
  const metadata = metadataComponent(placement.metadata);
  if (metadata) components[METADATA_COMPONENT] = toData(metadata);
  return components;
}

function characterComponents(character: LayoutCharacter): EntityComponentMap {
  const components: EntityComponentMap = {
    [TRANSFORM_COMPONENT]: toData(transformComponent(character)),
    [MESH_RENDERER_COMPONENT]: toData(meshRendererComponent(character.assetId, character.castShadow)),
  };
  const metadata = metadataComponent(character.metadata);
  if (metadata) components[METADATA_COMPONENT] = toData(metadata);
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
  component: TransformComponent | MeshRendererComponent | LightComponent | MetadataComponent,
): EntityComponentData {
  return component as unknown as EntityComponentData;
}
