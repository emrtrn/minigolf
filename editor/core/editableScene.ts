import type { LayoutLightActor, LayoutMetadata, Vec3 } from "@engine/scene/layout";
import type { Selection } from "./selection";

export interface EditableTransform {
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation: Vec3;
  /** Per-axis scale. */
  scale: Vec3;
}

export interface EditableSelection {
  id: string;
  kind: Selection["kind"];
  assetId: string;
  /** Asset catalog/manifest category, resolved for display. Empty when unknown. */
  category: string;
  label: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  /** Local-space authoring pivot offset; `[0,0,0]` means the model origin. */
  pivot: Vec3;
  scaleLocked: boolean;
  locked: boolean;
  /** Resolved cast-shadow flag (absent in data means true). */
  castShadow: boolean;
  /** Resolved collision flag (absent in data means true). */
  collision: boolean;
  /** Project-defined gameplay metadata (schema-driven); empty when none set. */
  metadata: LayoutMetadata;
  lightType?: LayoutLightActor["type"];
  color?: string;
  intensity?: number;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
}

export interface EditableSceneObject extends EditableSelection {
  selected: boolean;
  hidden: boolean;
  locked: boolean;
  /** Flat group id shared by grouped objects (move together). */
  groupId?: string | undefined;
  /** Stable id used to reference this object as a parent. */
  nodeId?: string | undefined;
  /** Parent reference (the parent's nodeId). */
  parentId?: string | undefined;
}

export interface EditorWorldSettings {
  lightingMode: "Dynamic";
  shadowFilter: "PCF Soft";
  staticObjectsCastShadow: boolean;
  staticObjectsReceiveShadow: boolean;
  backgroundColor: string;
  ambientColor: string;
  ambientIntensity: number;
}

export interface EditorProjectInfo {
  manifest: {
    publicDir: string;
    editor: {
      assetManifest: string;
      previewUrl?: string;
    };
  };
  rootName: string;
  assetRoot: string;
}

export interface EditorSnapSettings {
  move: number;
  rotate: number;
  scale: number;
  moveEnabled: boolean;
  rotateEnabled: boolean;
  scaleEnabled: boolean;
}

export function selectionToTransform(selection: EditableSelection): EditableTransform {
  return {
    position: [...selection.position],
    rotation: [...selection.rotation],
    scale: [...selection.scale],
  };
}

export function worldSettingsEqual(
  left: EditorWorldSettings,
  right: EditorWorldSettings,
): boolean {
  return (
    left.staticObjectsCastShadow === right.staticObjectsCastShadow &&
    left.staticObjectsReceiveShadow === right.staticObjectsReceiveShadow &&
    left.backgroundColor.toLowerCase() === right.backgroundColor.toLowerCase() &&
    left.ambientColor.toLowerCase() === right.ambientColor.toLowerCase() &&
    left.ambientIntensity === right.ambientIntensity
  );
}
