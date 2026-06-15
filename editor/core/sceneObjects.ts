import { defaultLightIntensity } from "@engine/scene/lights";
import { readPivot, readRotation, readScale } from "@engine/scene/transform";
import type { LayoutLightActor, RoomLayout } from "@engine/scene/layout";

import {
  type EditableSceneObject,
  type EditableSelection,
} from "./editableScene";
import { cloneMetadata } from "./layoutSnapshots";
import { selectionId, type Selection } from "./selection";

const DEFAULT_LIGHT_COLOR = "#ffffff";

/** Shared inputs the editable view-models need that aren't on the layout. */
export interface SceneObjectDeps {
  /** Resolves an asset's manifest category for Details display. */
  assetCategory: (assetId: string) => string;
  /** Resolved world-settings flag applied to all static instances. */
  staticObjectsCastShadow: boolean;
}

/**
 * Builds the Outliner row view-models for every object in the layout. Pure
 * transform from layout data → `EditableSceneObject[]`; `metadata` is left empty
 * here (the Details panel reads full metadata via {@link buildEditableSelection}).
 */
export function buildSceneObjects(
  layout: RoomLayout,
  deps: SceneObjectDeps & { isSelected: (selection: Selection) => boolean },
): EditableSceneObject[] {
  const objects: EditableSceneObject[] = [];

  for (const instance of layout.instances) {
    instance.placements.forEach((placement, placementIndex) => {
      const selection: Selection = {
        kind: "instance",
        assetId: instance.assetId,
        placementIndex,
      };
      objects.push({
        id: selectionId(selection),
        kind: "instance",
        assetId: instance.assetId,
        category: deps.assetCategory(instance.assetId),
        label: placement.name ?? `${instance.assetId} #${placementIndex + 1}`,
        position: [...placement.position],
        rotation: readRotation(placement),
        scale: readScale(placement),
        pivot: readPivot(placement),
        scaleLocked: placement.scaleLocked ?? false,
        selected: deps.isSelected(selection),
        hidden: placement.hidden ?? false,
        locked: placement.locked ?? false,
        castShadow: deps.staticObjectsCastShadow,
        collision: placement.collision ?? true,
        metadata: {},
        groupId: placement.groupId,
        nodeId: placement.nodeId,
        parentId: placement.parentId,
      });
    });
  }

  layout.characters.forEach((character, index) => {
    const selection: Selection = { kind: "character", index };
    objects.push({
      id: selectionId(selection),
      kind: "character",
      assetId: character.assetId,
      category: deps.assetCategory(character.assetId),
      label: character.name ?? `${character.assetId} #${index + 1}`,
      position: [...character.position],
      rotation: readRotation(character),
      scale: readScale(character),
      pivot: readPivot(character),
      scaleLocked: character.scaleLocked ?? false,
      selected: deps.isSelected(selection),
      hidden: character.hidden ?? false,
      locked: character.locked ?? false,
      castShadow: character.castShadow ?? true,
      collision: character.collision ?? true,
      metadata: {},
      groupId: character.groupId,
      nodeId: character.nodeId,
      parentId: character.parentId,
    });
  });

  layout.lights?.forEach((light, index) => {
    const selection: Selection = { kind: "light", index };
    const sceneObject: EditableSceneObject = {
      id: selectionId(selection),
      kind: "light",
      assetId: light.type,
      category: "light",
      label: light.name ?? light.id,
      position: [...light.position],
      rotation: readRotation(light),
      scale: [1, 1, 1],
      pivot: [0, 0, 0],
      scaleLocked: true,
      selected: deps.isSelected(selection),
      hidden: light.hidden ?? false,
      locked: light.locked ?? false,
      castShadow: light.castShadow ?? light.type === "directional",
      collision: false,
      metadata: {},
      groupId: light.groupId,
      nodeId: light.nodeId,
      parentId: light.parentId,
      lightType: light.type,
      color: light.color ?? DEFAULT_LIGHT_COLOR,
      intensity: light.intensity ?? defaultLightIntensity(light.type),
    };
    applyOptionalLightFields(sceneObject, light);
    objects.push(sceneObject);
  });

  return objects;
}

/**
 * Builds the Details-panel view-model for a single selection. Unlike
 * {@link buildSceneObjects} it carries the object's real (cloned) metadata and
 * omits Outliner-only tree/selection fields. Returns null if the selection no
 * longer resolves in the layout.
 */
export function buildEditableSelection(
  layout: RoomLayout,
  selection: Selection,
  deps: SceneObjectDeps,
): EditableSelection | null {
  if (selection.kind === "instance") {
    const instance = layout.instances.find((entry) => entry.assetId === selection.assetId);
    const placement = instance?.placements[selection.placementIndex];
    if (!placement) return null;
    return {
      id: selectionId(selection),
      kind: "instance",
      assetId: selection.assetId,
      category: deps.assetCategory(selection.assetId),
      label: placement.name ?? `${selection.assetId} #${selection.placementIndex + 1}`,
      position: [...placement.position],
      rotation: readRotation(placement),
      scale: readScale(placement),
      pivot: readPivot(placement),
      scaleLocked: placement.scaleLocked ?? false,
      locked: placement.locked ?? false,
      castShadow: deps.staticObjectsCastShadow,
      collision: placement.collision ?? true,
      metadata: cloneMetadata(placement.metadata),
    };
  }

  if (selection.kind === "light") {
    const light = layout.lights?.[selection.index];
    if (!light) return null;
    const editable: EditableSelection = {
      id: selectionId(selection),
      kind: "light",
      assetId: light.type,
      category: "light",
      label: light.name ?? light.id,
      position: [...light.position],
      rotation: readRotation(light),
      scale: [1, 1, 1],
      pivot: [0, 0, 0],
      scaleLocked: true,
      locked: light.locked ?? false,
      castShadow: light.castShadow ?? light.type === "directional",
      collision: false,
      metadata: {},
      lightType: light.type,
      color: light.color ?? DEFAULT_LIGHT_COLOR,
      intensity: light.intensity ?? defaultLightIntensity(light.type),
    };
    applyOptionalLightFields(editable, light);
    return editable;
  }

  const character = layout.characters[selection.index];
  if (!character) return null;
  return {
    id: selectionId(selection),
    kind: "character",
    assetId: character.assetId,
    category: deps.assetCategory(character.assetId),
    label: character.name ?? character.assetId,
    position: [...character.position],
    rotation: readRotation(character),
    scale: readScale(character),
    pivot: readPivot(character),
    scaleLocked: character.scaleLocked ?? false,
    locked: character.locked ?? false,
    castShadow: character.castShadow ?? true,
    collision: character.collision ?? true,
    metadata: cloneMetadata(character.metadata),
  };
}

/** Copies the optional point/spot-light fields onto a view-model when set. */
function applyOptionalLightFields(
  target: { distance?: number; angle?: number; penumbra?: number; decay?: number },
  light: LayoutLightActor,
): void {
  if (light.distance !== undefined) target.distance = light.distance;
  if (light.angle !== undefined) target.angle = light.angle;
  if (light.penumbra !== undefined) target.penumbra = light.penumbra;
  if (light.decay !== undefined) target.decay = light.decay;
}
