import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Color,
  SRGBColorSpace,
  Scene,
  Vector3,
} from "three";
import type {
  BufferGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  PerspectiveCamera,
  WebGLRenderer,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyRootMotionToClip, type RootMotionClipSetting } from "@engine/render-three/rootMotion";

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
import { isProceduralAssetId } from "@engine/scene/shapes";
import { createProceduralAssetGltf } from "./shapePrimitives";
import type {
  LayoutCharacter,
  LayoutLightActor,
  LayoutPlacement,
  RoomLayout,
  Vec3,
} from "@engine/scene/layout";
import type { Entity } from "@engine/scene/entity";
import type { SceneDocument } from "@engine/scene/sceneDocument";

const MAX_PIXEL_RATIO = 2;

export const SCENE_CAMERA_TARGET = new Vector3(0, 0.65, -0.2);
export const DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS = false;
export const DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS = true;
export const DEFAULT_SCENE_LIGHT_COLOR = "#ffffff";
export const DEFAULT_SCENE_SUN_ID = "sun";
export const DEFAULT_SCENE_BACKGROUND_COLOR = "#d7d7c7";
export const DEFAULT_SCENE_AMBIENT_COLOR = "#ffffff";
export const DEFAULT_SCENE_AMBIENT_INTENSITY = 0;
export const DEFAULT_SCENE_GRAVITY: Vec3 = [0, -9.81, 0];

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
  gravity: Vec3;
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

export function applyEditorMatchedPlayLook(renderer: WebGLRenderer): void {
  // Match the editor's OutputPass: encode the linear-rendered scene to sRGB for
  // display. Play renders directly (no composer), so this is the only place the
  // sRGB transfer is applied — without it the image is rendered linear and looks
  // dark. (SRGBColorSpace is the renderer default; set explicitly to document it.)
  renderer.outputColorSpace = SRGBColorSpace;
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
    gravity: layout?.worldSettings?.gravity ?? DEFAULT_SCENE_GRAVITY,
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
  rootMotion?: readonly RootMotionClipSetting[],
): AnimationMixer | null {
  const clip = animationName
    ? gltf.animations.find((candidate) => candidate.name === animationName)
    : null;
  if (!clip) return null;
  const mixer = new AnimationMixer(character);
  mixer.clipAction(applyRootMotionToClip(clip, rootMotion?.find((setting) => setting.clip === clip.name))).play();
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

/**
 * Compute the local-space bounding box of every loaded model, keyed by asset id.
 * Mirrors the bounds both shells build before placing instances; the world
 * matrices are refreshed first so `setFromObject` sees the model's own geometry.
 */
export function computeModelLocalBounds(
  models: ReadonlyMap<string, GLTF>,
): Map<string, Box3> {
  const localBounds = new Map<string, Box3>();
  for (const [assetId, gltf] of models) {
    gltf.scene.updateMatrixWorld(true);
    localBounds.set(assetId, new Box3().setFromObject(gltf.scene));
  }
  return localBounds;
}

export interface AssetComplexCollisionMesh {
  vertices: Vec3[];
  indices: number[];
  size: Vec3;
  center: Vec3;
}

/**
 * Triangle data (render-mesh) for every model in `assetIds`, used by the
 * `complexAsSimple` collision complexity to build a static trimesh collider.
 * `assetIds` is required so we never pay the per-vertex flatten for models that
 * don't opt in (the common case).
 */
export function computeComplexCollisionMeshes(
  models: ReadonlyMap<string, GLTF>,
  assetIds: ReadonlySet<string>,
): Map<string, AssetComplexCollisionMesh> {
  const meshes = new Map<string, AssetComplexCollisionMesh>();
  for (const assetId of assetIds) {
    const gltf = models.get(assetId);
    if (!gltf) continue;
    const mesh = complexCollisionMeshFromGltf(gltf);
    if (mesh) meshes.set(assetId, mesh);
  }
  return meshes;
}

function complexCollisionMeshFromGltf(gltf: GLTF): AssetComplexCollisionMesh | null {
  gltf.scene.updateMatrixWorld(true);
  const vertices: Vec3[] = [];
  const indices: number[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    const geometry = mesh.geometry as BufferGeometry | undefined;
    if (!geometry || typeof geometry.getAttribute !== "function") return;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const base = vertices.length;
    const vertex = new Vector3();
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      vertices.push([vertex.x, vertex.y, vertex.z]);
    }
    const indexAttr = geometry.getIndex();
    if (indexAttr) {
      for (let index = 0; index < indexAttr.count; index += 3) {
        indices.push(
          base + indexAttr.getX(index),
          base + indexAttr.getX(index + 1),
          base + indexAttr.getX(index + 2),
        );
      }
    } else {
      for (let index = 0; index < position.count - 2; index += 3) {
        indices.push(base + index, base + index + 1, base + index + 2);
      }
    }
  });
  if (vertices.length < 3 || indices.length < 3) return null;
  const box = new Box3().setFromPoints(vertices.map((point) => new Vector3(point[0], point[1], point[2])));
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  return {
    vertices,
    indices,
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
  };
}

/**
 * Register synthetic procedural models for every `shape:<type>` instance in the
 * layout, mutating `models` + `localBounds` in place. Shape actors persist as
 * ordinary instances under a synthetic `shape:<type>` asset id that no loadGroup
 * provides, so both shells must build the primitive GLTF (and its bounds) before
 * the scene is constructed — otherwise the instanced-model builder throws on the
 * missing asset, aborting the rest of scene construction (lights, characters,
 * world settings included). Already-registered or non-shape ids are skipped.
 */
export function registerSceneShapeModels(
  layout: RoomLayout | null,
  models: Map<string, GLTF>,
  localBounds: Map<string, Box3>,
): void {
  for (const instance of layout?.instances ?? []) {
    const assetId = instance.assetId;
    if (models.has(assetId)) continue;
    const gltf = createProceduralAssetGltf(assetId);
    if (!gltf) continue;
    models.set(assetId, gltf);
    for (const [id, box] of computeModelLocalBounds(new Map([[assetId, gltf]]))) {
      localBounds.set(id, box);
    }
  }
}

/**
 * Model asset ids that the scene graph will instantiate. This includes authored
 * instances and characters, but excludes procedural `shape:<type>` ids because
 * those are registered locally instead of loaded from the asset manifest.
 */
export function sceneModelAssetIds(layout: RoomLayout | null): string[] {
  const ids = new Set<string>();
  for (const instance of layout?.instances ?? []) {
    if (!isProceduralAssetId(instance.assetId)) ids.add(instance.assetId);
  }
  for (const character of layout?.characters ?? []) {
    ids.add(character.assetId);
  }
  return [...ids];
}

/**
 * Drive the shared scene-build iteration: instances, then characters, then
 * lights, in the exact order both shells use. The handlers stay in the shell so
 * each can apply its own per-entity policy (editor selection refresh, etc.).
 */
export function buildSceneEntities(
  layout: RoomLayout,
  handlers: {
    addInstance: (assetId: string, placements: LayoutPlacement[]) => void;
    addCharacter: (assetId: string, character: LayoutCharacter) => void;
    addLight: (light: LayoutLightActor) => void;
  },
): void {
  for (const instance of layout.instances) {
    handlers.addInstance(instance.assetId, instance.placements);
  }
  for (const character of layout.characters) {
    handlers.addCharacter(character.assetId, character);
  }
  for (const light of layout.lights ?? []) {
    handlers.addLight(light);
  }
}

/** Receives the derived entity set (physics + behavior subsystems). */
export interface SceneEntitySink {
  setEntities(entities: readonly Entity[]): void;
}

/** Engine-core spine brought online once the scene is fully built. */
export interface SceneEngineSpine {
  init(): Promise<void>;
  start(): Promise<void>;
}

/**
 * Bring the engine-core spine online once the scene graph is built: hand the
 * derived entity set to physics + behavior, then init and start the engine.
 * The order is a shared contract — physics relies on `setEntities()` running
 * before `init()` to decide whether to load Rapier (see PhysicsSubsystem).
 */
export async function startSceneRuntime(options: {
  sceneDocument: SceneDocument;
  physics: SceneEntitySink;
  behavior: SceneEntitySink;
  characterMovement?: SceneEntitySink;
  engineApp: SceneEngineSpine;
}): Promise<void> {
  options.physics.setEntities(options.sceneDocument.entities);
  options.characterMovement?.setEntities(options.sceneDocument.entities);
  options.behavior.setEntities(options.sceneDocument.entities);
  await options.engineApp.init();
  await options.engineApp.start();
}
