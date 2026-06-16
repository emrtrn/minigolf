import { AmbientLight, AnimationMixer, Box3, Color, Scene, Vector3 } from "three";
import type {
  DirectionalLight,
  Group,
  InstancedMesh,
  Object3D,
  PerspectiveCamera,
  WebGLRenderer,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  applyResponsiveCameraViewport,
  createSceneCamera,
} from "@engine/render-three/camera";
import {
  createSceneRenderer,
  readRenderStats,
} from "@engine/render-three/renderer";
import { composePlacementMatrix } from "@engine/render-three/transforms";
import {
  createCharacterSceneObject,
  createInstancedModelGroup,
  entityCharacterItem,
  entityInstanceItems,
} from "@engine/render-three/models";
import {
  createLightObject as createThreeLightObject,
  entityLightItem,
  type LightObjectRecord,
} from "@engine/render-three/lights";
import {
  characterEntity,
  instanceEntitiesForAsset,
  lightEntity,
} from "@engine/scene/legacyRoomLayoutAdapter";
import type {
  LayoutCharacter,
  LayoutLightActor,
  LayoutPlacement,
  RoomLayout,
} from "@engine/scene/layout";

const MAX_PIXEL_RATIO = 2;

export const SCENE_CAMERA_TARGET = new Vector3(0, 0.65, -0.2);
export const DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS = false;
export const DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS = true;
export const DEFAULT_SCENE_LIGHT_COLOR = "#ffffff";
export const DEFAULT_SCENE_SUN_ID = "sun";
export const DEFAULT_SCENE_BACKGROUND_COLOR = "#d7d7c7";
export const DEFAULT_SCENE_AMBIENT_COLOR = "#ffffff";
export const DEFAULT_SCENE_AMBIENT_INTENSITY = 0;

export interface SceneRuntimeCore {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}

export interface ResolvedSceneWorldSettings {
  staticObjectsCastShadow: boolean;
  staticObjectsReceiveShadow: boolean;
  backgroundColor: string;
  ambientColor: string;
  ambientIntensity: number;
}

export function createSceneRuntimeCore(
  canvas: HTMLCanvasElement,
  options: { backgroundColor: string | number },
): SceneRuntimeCore {
  const renderer = createSceneRenderer(canvas, MAX_PIXEL_RATIO);
  const scene = new Scene();
  scene.background = new Color(options.backgroundColor);
  const camera = createSceneCamera();
  return { renderer, scene, camera };
}

export function readSceneRuntimeStats(
  renderer: WebGLRenderer,
): { drawCalls: number; triangles: number } {
  return readRenderStats(renderer);
}

export function resizeSceneRuntimeViewport(options: {
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  width: number;
  height: number;
  viewTouched: boolean;
}): boolean {
  const resetView = applyResponsiveCameraViewport(options.camera, {
    width: options.width,
    height: options.height,
    target: SCENE_CAMERA_TARGET,
    viewTouched: options.viewTouched,
  });
  options.renderer.setSize(options.width, options.height, false);
  return resetView;
}

export function resolveSceneWorldSettings(
  layout: RoomLayout | null,
): ResolvedSceneWorldSettings {
  return {
    staticObjectsCastShadow:
      layout?.worldSettings?.staticObjectsCastShadow ??
      DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS,
    staticObjectsReceiveShadow:
      layout?.worldSettings?.staticObjectsReceiveShadow ??
      DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS,
    backgroundColor: layout?.worldSettings?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND_COLOR,
    ambientColor: layout?.worldSettings?.ambientColor ?? DEFAULT_SCENE_AMBIENT_COLOR,
    ambientIntensity: layout?.worldSettings?.ambientIntensity ?? DEFAULT_SCENE_AMBIENT_INTENSITY,
  };
}

export function ensureDefaultSceneLights(layout: RoomLayout | null): void {
  if (!layout) return;
  if (layout.lights && layout.lights.length > 0) return;
  layout.lights = [
    {
      id: DEFAULT_SCENE_SUN_ID,
      type: "directional",
      name: "Sun",
      position: [3, 9, 4],
      rotation: [-55, 35, 0],
      color: DEFAULT_SCENE_LIGHT_COLOR,
      intensity: 2,
      castShadow: true,
    },
  ];
}

export function computeSceneRoomBounds(
  layout: RoomLayout | null,
  localBounds: ReadonlyMap<string, Box3>,
  options: { includeAsset?: (assetId: string) => boolean } = {},
): Box3 | null {
  if (!layout) return null;
  const box = new Box3();
  let found = false;
  for (const instance of layout.instances) {
    if (options.includeAsset && !options.includeAsset(instance.assetId)) continue;
    const bounds = localBounds.get(instance.assetId);
    if (!bounds) continue;
    for (const placement of instance.placements) {
      box.union(bounds.clone().applyMatrix4(composePlacementMatrix(placement)));
      found = true;
    }
  }
  return found ? box : null;
}

export function fitDirectionalShadowToBounds(
  sun: DirectionalLight | null,
  room: Box3 | null,
): void {
  if (!sun || !room || room.isEmpty()) return;
  const size = room.getSize(new Vector3());
  const half = Math.max(size.x, size.z) * 0.6 + 1;
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.far = size.y + 30;
  cam.updateProjectionMatrix();
}

export function applySceneBackgroundAndAmbient(options: {
  scene: Scene;
  ambientLight: AmbientLight | null;
  settings: Pick<
    ResolvedSceneWorldSettings,
    "backgroundColor" | "ambientColor" | "ambientIntensity"
  >;
  ambientName?: string;
}): AmbientLight | null {
  options.scene.background = new Color(options.settings.backgroundColor);
  if (options.settings.ambientIntensity <= 0) {
    options.ambientLight?.removeFromParent();
    return null;
  }

  if (!options.ambientLight) {
    const ambientLight = new AmbientLight(
      new Color(options.settings.ambientColor),
      options.settings.ambientIntensity,
    );
    if (options.ambientName) ambientLight.name = options.ambientName;
    options.scene.add(ambientLight);
    return ambientLight;
  }

  options.ambientLight.color.set(options.settings.ambientColor);
  options.ambientLight.intensity = options.settings.ambientIntensity;
  return options.ambientLight;
}

/**
 * Build the instanced render group for one asset's placements. Derives the
 * placements into instance entities → render items (same matrices as the legacy
 * placement path) and hands them to the engine instanced-mesh builder. The
 * caller registers the returned group/meshes into its own bookkeeping maps.
 */
export function buildSceneInstancedModel(options: {
  assetId: string;
  gltf: GLTF;
  placements: LayoutPlacement[];
  castShadow: boolean;
  receiveShadow: boolean;
}): { group: Group; meshes: InstancedMesh[] } {
  const items = entityInstanceItems(
    instanceEntitiesForAsset(options.assetId, options.placements),
  );
  return createInstancedModelGroup({
    assetId: options.assetId,
    gltf: options.gltf,
    items,
    castShadow: options.castShadow,
    receiveShadow: options.receiveShadow,
  });
}

/**
 * Build the scene object for a character placement. Routes the layout character
 * through the entity/component model (same transform round-trip as the legacy
 * placement path) before the engine builds the renderable object.
 */
export function buildSceneCharacterObject(
  gltf: GLTF,
  placement: LayoutCharacter,
  index: number,
): Object3D {
  return createCharacterSceneObject(
    gltf,
    entityCharacterItem(characterEntity(index, placement)),
  );
}

/**
 * Create a playing animation mixer for a character if the named clip exists,
 * otherwise return null. The caller registers the mixer with its animation
 * subsystem.
 */
export function createSceneCharacterMixer(
  character: Object3D,
  gltf: GLTF,
  animationName: string | undefined,
): AnimationMixer | null {
  const clip = animationName
    ? gltf.animations.find((candidate) => candidate.name === animationName)
    : null;
  if (!clip) return null;
  const mixer = new AnimationMixer(character);
  mixer.clipAction(clip).play();
  return mixer;
}

/**
 * Build the Three.js light record for a layout actor. Routes the actor through
 * the entity/component model (same light/transform round-trip as the legacy
 * actor path). The caller adds the record to the scene and tracks it.
 */
export function buildSceneLightObject(
  actor: LayoutLightActor,
  index: number,
): LightObjectRecord {
  return createThreeLightObject(
    entityLightItem(lightEntity(index, actor)),
    DEFAULT_SCENE_LIGHT_COLOR,
  );
}

/** Tag a light record's root + descendants with their light index for picking. */
export function tagSceneLightRecordIndex(record: LightObjectRecord, index: number): void {
  record.root.userData.lightIndex = index;
  record.root.traverse((child) => {
    child.userData.lightIndex = index;
  });
}

/**
 * Whether a newly added directional actor should become the scene sun: true when
 * no sun is tracked yet, or the actor is the canonical default-sun id.
 */
export function isSceneSunLight(
  actor: LayoutLightActor,
  currentSun: DirectionalLight | null,
): boolean {
  return (
    actor.type === "directional" &&
    (!currentSun || actor.id === DEFAULT_SCENE_SUN_ID)
  );
}
