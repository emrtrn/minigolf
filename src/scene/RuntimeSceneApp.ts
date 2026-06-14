import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Object3D,
  Scene,
  Vector3,
} from "three";
import type { InstancedMesh, PerspectiveCamera, WebGLRenderer } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AssetLoader } from "./assetLoader";
import { loadRoomLayout } from "./roomLayout";
import { EngineApp } from "@engine/core/EngineApp";
import { AnimationSubsystem } from "@engine/render-three/animationSubsystem";
import { ActionMap, type ActionBindings } from "@engine/input/actionMap";
import { InputSubsystem } from "@engine/input/inputSubsystem";
import { BehaviorSubsystem } from "@engine/behavior/behaviorSubsystem";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { createBehaviorRegistry } from "@/game/behaviors";
import { loadActiveProject, type ActiveProject } from "@/project/ProjectSystem";
import {
  applyResponsiveCameraViewport,
  createSceneCamera,
} from "@engine/render-three/camera";
import {
  createSceneRenderer,
  readRenderStats,
} from "@engine/render-three/renderer";
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
import { collectMaterialStats, convertUnlitModelMaterialsToLit } from "@engine/render-three/materials";
import { applyEulerDegrees, composePlacementMatrix } from "@engine/render-three/transforms";
import type { LayoutCharacter, LayoutLightActor, LayoutPlacement, RoomLayout } from "@engine/scene/layout";
import {
  characterEntity,
  instanceEntitiesForAsset,
  lightEntity,
  roomLayoutToSceneDocument,
} from "@engine/scene/legacyRoomLayoutAdapter";
import type { TransformComponent } from "@engine/scene/components";

const MAX_PIXEL_RATIO = 2;
const CAMERA_TARGET = new Vector3(0, 0.65, -0.2);
const DEFAULT_STATIC_OBJECTS_CAST_SHADOWS = false;
const DEFAULT_STATIC_OBJECTS_RECEIVE_SHADOWS = true;
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_SUN_ID = "sun";
const DEFAULT_BACKGROUND_COLOR = "#d7d7c7";
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_INTENSITY = 0;

const DEFAULT_INPUT_BINDINGS: ActionBindings = {
  KeyW: "move-forward",
  ArrowUp: "move-forward",
  KeyS: "move-back",
  ArrowDown: "move-back",
  KeyA: "move-left",
  ArrowLeft: "move-left",
  KeyD: "move-right",
  ArrowRight: "move-right",
  Space: "jump",
};

export interface RuntimeStatsApp {
  onFrame: ((deltaMs: number) => void) | null;
  getRenderStats(): { drawCalls: number; triangles: number };
}

export class RuntimeSceneApp implements RuntimeStatsApp {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly engineApp = new EngineApp();
  private readonly animationSubsystem = new AnimationSubsystem();
  private readonly inputActions = new ActionMap(DEFAULT_INPUT_BINDINGS);
  private readonly inputSubsystem = new InputSubsystem(this.inputActions);
  private readonly physicsSubsystem = new PhysicsSubsystem({ backend: "rapier" });
  private readonly keyboardInput = new KeyboardInputSource(this.inputActions);
  private readonly behaviorSubsystem: BehaviorSubsystem;
  private frameHandle = 0;
  private lastTime = 0;
  private activeProject: ActiveProject | null = null;
  private assetLoader: AssetLoader | null = null;
  private layout: RoomLayout | null = null;
  private models = new Map<string, GLTF>();
  private instanceGroups = new Map<string, Group>();
  private instanceMeshes = new Map<string, InstancedMesh[]>();
  private characterObjects: Object3D[] = [];
  private lightObjects: LightObjectRecord[] = [];
  private localBounds = new Map<string, Box3>();
  private sun: DirectionalLight | null = null;
  private ambientLight: AmbientLight | null = null;
  private cameraViewTouched = false;

  onFrame: ((deltaMs: number) => void) | null = null;

  private readonly syncEntityTransform = (entityId: string, transform: TransformComponent): void => {
    const index = parseCharacterEntityIndex(entityId);
    if (index === null) return;
    const object = this.characterObjects[index];
    if (!object) return;
    object.position.set(transform.position[0], transform.position[1], transform.position[2]);
    applyEulerDegrees(object, transform.rotation);
    object.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
    this.physicsSubsystem.setEntityTransform(entityId, transform);
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = createSceneRenderer(canvas, MAX_PIXEL_RATIO);
    this.scene.background = new Color(DEFAULT_BACKGROUND_COLOR);
    this.camera = createSceneCamera();

    this.engineApp.registerSubsystem(this.animationSubsystem);
    this.engineApp.registerSubsystem(this.inputSubsystem);
    this.engineApp.registerSubsystem(this.physicsSubsystem);
    this.behaviorSubsystem = new BehaviorSubsystem(
      createBehaviorRegistry(),
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
    );
    this.engineApp.registerSubsystem(this.behaviorSubsystem);
    this.keyboardInput.attach();

    void this.loadActiveProjectScene();
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
  }

  start(): void {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      const deltaMs = Math.min(now - this.lastTime, 100);
      this.lastTime = now;
      this.engineApp.update(deltaMs / 1000);
      this.renderer.render(this.scene, this.camera);
      this.onFrame?.(deltaMs);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    this.keyboardInput.detach();
    void this.engineApp.dispose();
    this.renderer.dispose();
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return readRenderStats(this.renderer);
  }

  private async loadActiveProjectScene(): Promise<void> {
    this.activeProject = await loadActiveProject();
    this.assetLoader = new AssetLoader(this.activeProject.manifest);
    this.layout = await loadRoomLayout(this.activeProject.manifest.editor.defaultScene);
    this.ensureDefaultLights();
    this.models = await this.assetLoader.loadGroups(this.layout.loadGroups);
    const convertedUnlitMaterials = convertUnlitModelMaterialsToLit(this.models);
    this.localBounds.clear();
    for (const [assetId, gltf] of this.models) {
      gltf.scene.updateMatrixWorld(true);
      this.localBounds.set(assetId, new Box3().setFromObject(gltf.scene));
    }

    for (const instance of this.layout.instances) {
      this.scene.add(this.createInstancedModel(instance.assetId, instance.placements));
    }
    for (const character of this.layout.characters) {
      this.addCharacter(this.models.get(character.assetId), character);
    }
    for (const light of this.layout.lights ?? []) {
      this.addLight(light);
    }

    this.fitSunShadowToScene();
    this.applyBackgroundAndAmbient();

    const bytes = await this.assetLoader.totalBytesForGroups(this.layout.loadGroups);
    const materialStats = collectMaterialStats(this.models);
    console.info(
      "[runtime] scene loaded",
      JSON.stringify({
        project: this.activeProject.manifest.name,
        layout: this.layout.name,
        processedAssetBytes: bytes,
        materialStats,
        convertedUnlitMaterials,
      }),
    );

    const sceneDocument = roomLayoutToSceneDocument(this.layout);
    this.physicsSubsystem.setEntities(sceneDocument.entities);
    this.behaviorSubsystem.setEntities(sceneDocument.entities);
    await this.engineApp.init();
    await this.engineApp.start();
  }

  private createInstancedModel(assetId: string, placements: LayoutPlacement[]): Group {
    const gltf = this.models.get(assetId);
    if (!gltf) throw new Error(`Runtime asset missing: ${assetId}`);
    const { group, meshes } = createInstancedModelGroup({
      assetId,
      gltf,
      items: entityInstanceItems(instanceEntitiesForAsset(assetId, placements)),
      castShadow: this.staticObjectsCastShadow(),
      receiveShadow: this.staticObjectsReceiveShadow(),
    });
    this.instanceGroups.set(assetId, group);
    this.instanceMeshes.set(assetId, meshes);
    return group;
  }

  private addCharacter(gltf: GLTF | undefined, placement: LayoutCharacter): void {
    if (!gltf) return;
    const index = this.characterObjects.length;
    const character = createCharacterSceneObject(gltf, entityCharacterItem(characterEntity(index, placement)));
    character.userData.characterIndex = index;
    this.scene.add(character);
    this.characterObjects.push(character);
    const clip = placement.animation
      ? gltf.animations.find((candidate) => candidate.name === placement.animation)
      : null;
    if (clip) {
      const mixer = new AnimationMixer(character);
      mixer.clipAction(clip).play();
      this.animationSubsystem.add(mixer);
    }
  }

  private addLight(actor: LayoutLightActor): void {
    const index = this.lightObjects.length;
    const record = createThreeLightObject(
      entityLightItem(lightEntity(index, actor)),
      DEFAULT_LIGHT_COLOR,
    );
    record.root.userData.lightIndex = index;
    record.root.traverse((child) => {
      child.userData.lightIndex = index;
    });
    this.scene.add(record.root);
    if (record.target) this.scene.add(record.target);
    this.lightObjects.push(record);
    if (actor.type === "directional" && (!this.sun || actor.id === DEFAULT_SUN_ID)) {
      this.sun = record.light as DirectionalLight;
    }
  }

  private ensureDefaultLights(): void {
    if (!this.layout) return;
    if (this.layout.lights && this.layout.lights.length > 0) return;
    this.layout.lights = [
      {
        id: DEFAULT_SUN_ID,
        type: "directional",
        name: "Sun",
        position: [3, 9, 4],
        rotation: [-55, 35, 0],
        color: DEFAULT_LIGHT_COLOR,
        intensity: 2,
        castShadow: true,
      },
    ];
  }

  private fitSunShadowToScene(): void {
    if (!this.sun) return;
    const room = this.getRoomBounds();
    if (!room || room.isEmpty()) return;
    const size = room.getSize(new Vector3());
    const half = Math.max(size.x, size.z) * 0.6 + 1;
    const cam = this.sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.far = size.y + 30;
    cam.updateProjectionMatrix();
  }

  private getRoomBounds(): Box3 | null {
    if (!this.layout) return null;
    const box = new Box3();
    let found = false;
    for (const instance of this.layout.instances) {
      const bounds = this.localBounds.get(instance.assetId);
      if (!bounds) continue;
      for (const placement of instance.placements) {
        box.union(bounds.clone().applyMatrix4(composePlacementMatrix(placement)));
        found = true;
      }
    }
    return found ? box : null;
  }

  private applyBackgroundAndAmbient(): void {
    this.scene.background = new Color(this.backgroundColor());
    const intensity = this.ambientIntensity();
    if (intensity <= 0) {
      if (this.ambientLight) {
        this.ambientLight.removeFromParent();
        this.ambientLight = null;
      }
      return;
    }
    if (!this.ambientLight) {
      this.ambientLight = new AmbientLight(new Color(this.ambientColor()), intensity);
      this.scene.add(this.ambientLight);
    } else {
      this.ambientLight.color.set(this.ambientColor());
      this.ambientLight.intensity = intensity;
    }
  }

  private staticObjectsCastShadow(): boolean {
    return this.layout?.worldSettings?.staticObjectsCastShadow ?? DEFAULT_STATIC_OBJECTS_CAST_SHADOWS;
  }

  private staticObjectsReceiveShadow(): boolean {
    return (
      this.layout?.worldSettings?.staticObjectsReceiveShadow ??
      DEFAULT_STATIC_OBJECTS_RECEIVE_SHADOWS
    );
  }

  private backgroundColor(): string {
    return this.layout?.worldSettings?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
  }

  private ambientColor(): string {
    return this.layout?.worldSettings?.ambientColor ?? DEFAULT_AMBIENT_COLOR;
  }

  private ambientIntensity(): number {
    return this.layout?.worldSettings?.ambientIntensity ?? DEFAULT_AMBIENT_INTENSITY;
  }

  private handleResize = (): void => {
    const resetView = applyResponsiveCameraViewport(this.camera, {
      width: window.innerWidth,
      height: window.innerHeight,
      target: CAMERA_TARGET,
      viewTouched: this.cameraViewTouched,
    });
    if (resetView) this.cameraViewTouched = false;
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
}

function parseCharacterEntityIndex(entityId: string): number | null {
  if (!entityId.startsWith("character:")) return null;
  const index = Number(entityId.slice("character:".length));
  return Number.isInteger(index) ? index : null;
}
