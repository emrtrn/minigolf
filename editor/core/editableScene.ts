import type {
  LayoutAudio,
  LayoutBehavior,
  LayoutInteraction,
  LayoutLightActor,
  LayoutMetadata,
  LayoutParticleEmitter,
  LayoutPhysics,
  Vec3,
} from "@engine/scene/layout";
import type { CollisionPresetId } from "@engine/scene/collision";
import type { Selection } from "./selection";

export interface EditableTransform {
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation: Vec3;
  /** Per-axis scale. */
  scale: Vec3;
}

/**
 * Resolved Sky Atmosphere fields for the Details panel (singleton actor). Only
 * scattering/exposure live here; the sun direction is owned by the directional
 * Sun light and edited via its own transform, not this panel.
 */
export interface EditableSky {
  name: string;
  hidden: boolean;
  rayleigh: number;
  turbidity: number;
  mie: number;
  mieDirectionalG: number;
  exposure: number;
}

/**
 * Resolved Exponential Height Fog fields for the Details panel (singleton actor).
 * Faz 1 is distance-based: `exp` mode uses `density`, `linear` mode uses
 * `start`/`end`.
 */
export interface EditableFog {
  name: string;
  hidden: boolean;
  mode: "exp" | "linear";
  color: string;
  density: number;
  start: number;
  end: number;
}

/**
 * Resolved static Cloud Layer fields for the Details panel (singleton actor). A
 * procedural cloud dome — coverage/density/softness/scale paint the noise,
 * `speed` drives the optional drift (0 = static).
 */
export interface EditableCloud {
  name: string;
  hidden: boolean;
  color: string;
  coverage: number;
  density: number;
  softness: number;
  scale: number;
  speed: number;
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
  /** Per-placement collision preset override; absent means inherit asset default. */
  collisionPreset?: CollisionPresetId;
  /** Per-placement material override. References a manifest material asset id. */
  materialSlot?: string;
  /** Dynamic rigid-body simulation in Play mode. */
  simulatePhysics: boolean;
  /** Runtime physics settings for the selected object. */
  physics: LayoutPhysics;
  /** Project-defined gameplay metadata (schema-driven); empty when none set. */
  metadata: LayoutMetadata;
  /** Authored audio cue; absent when the object has no Audio component. */
  audio?: LayoutAudio;
  /** Authored runtime behavior reference; absent when the object has no Behavior component. */
  behavior?: LayoutBehavior;
  /** Authored particle emitter; absent when the object has no Particle component. */
  particle?: LayoutParticleEmitter;
  /** Authored interaction marker; absent when the object has no Interaction component. */
  interaction?: LayoutInteraction;
  lightType?: LayoutLightActor["type"];
  color?: string;
  intensity?: number;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
  /** Resolved Sky Atmosphere settings; present only when `kind === "sky"`. */
  sky?: EditableSky;
  /** Resolved Height Fog settings; present only when `kind === "fog"`. */
  fog?: EditableFog;
  /** Resolved Cloud Layer settings; present only when `kind === "cloud"`. */
  cloud?: EditableCloud;
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
  /** Selected runtime Game Mode id (resolved to a default when unknown/absent). */
  gameMode: string;
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
    left.ambientIntensity === right.ambientIntensity &&
    left.gameMode === right.gameMode
  );
}
