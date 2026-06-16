import { AmbientLight, Box3, Color, Scene, Vector3 } from "three";
import type { DirectionalLight, PerspectiveCamera, WebGLRenderer } from "three";

import {
  applyResponsiveCameraViewport,
  createSceneCamera,
} from "@engine/render-three/camera";
import {
  createSceneRenderer,
  readRenderStats,
} from "@engine/render-three/renderer";
import { composePlacementMatrix } from "@engine/render-three/transforms";
import type { RoomLayout } from "@engine/scene/layout";

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
