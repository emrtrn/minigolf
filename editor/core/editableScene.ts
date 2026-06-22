import type {
  LayoutAudio,
  LayoutBehavior,
  LayoutInteraction,
  LayoutLightActor,
  LayoutMetadata,
  LayoutParticleEmitter,
  LayoutPhysics,
  LayoutPostProcess,
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
 * Resolved Sky Atmosphere fields for the Details panel (singleton actor). The
 * sun direction is owned by the directional Sun light and edited via its own
 * transform, not this panel. The global sky-light capture is authored here too,
 * replacing the old separate Reflection Environment actor.
 */
export interface EditableSky {
  name: string;
  hidden: boolean;
  rayleigh: number;
  turbidity: number;
  mie: number;
  mieDirectionalG: number;
  exposure: number;
  skyLightCapture: {
    intensity: number;
  };
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

/**
 * Resolved Sphere Reflection Capture fields for the Details panel. Unlike the
 * environment singletons this is a placed actor with a transform; these
 * probe-specific settings ride alongside the transform in
 * {@link EditableSelection.reflectionCapture}.
 */
export interface EditableReflectionCapture {
  name: string;
  hidden: boolean;
  radius: number;
  intensity: number;
  resolution: number;
  near: number;
  far: number;
  parallax: boolean;
  priority: number;
}

/**
 * Resolved Reflective Surface fields for the Details panel. Like the Sphere
 * Reflection Capture this is a placed actor with a transform; the material
 * reference + reflection-blend settings ride alongside in
 * {@link EditableSelection.reflectiveSurface}.
 */
export interface EditableReflectiveSurface {
  name: string;
  hidden: boolean;
  material: string | null;
  reflectionStrength: number;
  fresnelPower: number;
  fresnelBias: number;
  distortion: number;
  tint: string;
  resolution: number;
}

/** Resolved global Post Process fields for the Details panel. */
export interface EditablePostProcess {
  name: string;
  hidden: boolean;
  exposure: number;
  toneMapping: NonNullable<LayoutPostProcess["toneMapping"]>;
  antialias: NonNullable<LayoutPostProcess["antialias"]>;
  bloom: {
    enabled: boolean;
    threshold: number;
    intensity: number;
    radius: number;
  };
  vignette: {
    enabled: boolean;
    intensity: number;
    offset: number;
  };
  chromaticAberration: {
    enabled: boolean;
    amount: number;
  };
  grain: {
    enabled: boolean;
    intensity: number;
  };
  dof: {
    enabled: boolean;
    focusDistance: number;
    aperture: number;
    maxBlur: number;
  };
  ao: {
    enabled: boolean;
    radius: number;
    intensity: number;
  };
  saturation: number;
  contrast: number;
  temperature: number;
  tint: number;
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
  /** Planar Reflection render-target resolution; present only when `kind === "reflectionPlane"`. */
  reflectionResolution?: number;
  /** Resolved Sky Atmosphere settings; present only when `kind === "sky"`. */
  sky?: EditableSky;
  /** Resolved Height Fog settings; present only when `kind === "fog"`. */
  fog?: EditableFog;
  /** Resolved Cloud Layer settings; present only when `kind === "cloud"`. */
  cloud?: EditableCloud;
  /** Resolved Sphere Reflection Capture settings; present only when `kind === "reflectionCapture"`. */
  reflectionCapture?: EditableReflectionCapture;
  /** Resolved Reflective Surface settings; present only when `kind === "reflectiveSurface"`. */
  reflectiveSurface?: EditableReflectiveSurface;
  /** Resolved Post Process settings; present only when `kind === "post"`. */
  post?: EditablePostProcess;
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
