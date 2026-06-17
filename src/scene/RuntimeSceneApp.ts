import { Box3, DirectionalLight, Group, Matrix4, Object3D } from "three";
import type { AmbientLight, InstancedMesh, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AssetLoader } from "./assetLoader";
import { loadRoomLayout } from "./roomLayout";
import { EngineApp } from "@engine/core/EngineApp";
import { AnimationSubsystem } from "@engine/render-three/animationSubsystem";
import { ActionMap, type ActionBindings } from "@engine/input/actionMap";
import { InputSubsystem } from "@engine/input/inputSubsystem";
import { BehaviorSubsystem } from "@engine/behavior/behaviorSubsystem";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { AudioSubsystem } from "@engine/audio/audioSubsystem";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { createBehaviorRegistry } from "@/game/behaviors";
import type { LocomotionInput } from "@/game/locomotionAnimation";
import { resolveGameMode } from "@/game/gameModes/registry";
import type {
  GameModeContext,
  GameModeSession,
  RuntimeCharacterRef,
} from "@/game/gameModes/types";
import { loadActiveProject, type ActiveProject } from "@/project/ProjectSystem";
import {
  applySceneBackgroundAndAmbient,
  buildSceneCharacterObject,
  buildSceneEntities,
  buildSceneInstancedModel,
  buildSceneLightObject,
  computeModelLocalBounds,
  computeSceneRoomBounds,
  createSceneCharacterMixer,
  createSceneRuntimeCore,
  DEFAULT_SCENE_BACKGROUND_COLOR,
  DEFAULT_SCENE_GRAVITY,
  ensureDefaultSceneLights,
  fitDirectionalShadowToBounds,
  isSceneSunLight,
  readSceneRuntimeStats,
  registerSceneShapeModels,
  resolveSceneWorldSettings,
  resizeSceneRuntimeViewport,
  sceneModelAssetIds,
  startSceneRuntime,
  tagSceneLightRecordIndex,
} from "./SceneRuntimeCore";
import type { LightObjectRecord } from "@engine/render-three/lights";
import { collectMaterialStats, convertUnlitModelMaterialsToLit } from "@engine/render-three/materials";
import {
  applyEulerDegrees,
  colliderBoxFromBounds,
  composeTransformMatrix,
} from "@engine/render-three/transforms";
import type { LayoutCharacter, LayoutLightActor, LayoutPlacement, RoomLayout } from "@engine/scene/layout";
import {
  characterEntityId,
  roomLayoutToSceneDocument,
  type ColliderTransformSource,
} from "@engine/scene/legacyRoomLayoutAdapter";
import { loadAssetCollision } from "@/scene/assetCollisionLoader";
import type { AssetCollisionDef } from "@engine/scene/collision";
import type { TransformComponent } from "@engine/scene/components";

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
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
};

export interface RuntimeStatsApp {
  onFrame: ((deltaMs: number) => void) | null;
  getRenderStats(): { drawCalls: number; triangles: number };
}

export class RuntimeSceneApp implements RuntimeStatsApp {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly engineApp = new EngineApp();
  private readonly animationSubsystem = new AnimationSubsystem();
  private readonly inputActions = new ActionMap(DEFAULT_INPUT_BINDINGS);
  private readonly inputSubsystem = new InputSubsystem(this.inputActions);
  private readonly physicsSubsystem = new PhysicsSubsystem({ backend: "rapier" });
  private readonly audioSubsystem = new AudioSubsystem({ backend: "web-audio" });
  private readonly keyboardInput = new KeyboardInputSource(this.inputActions);
  private readonly behaviorSubsystem: BehaviorSubsystem;
  private frameHandle = 0;
  private lastTime = 0;
  private activeProject: ActiveProject | null = null;
  private assetLoader: AssetLoader | null = null;
  private layout: RoomLayout | null = null;
  private collisionDefs = new Map<string, AssetCollisionDef>();
  private models = new Map<string, GLTF>();
  private instanceGroups = new Map<string, Group>();
  private instanceMeshes = new Map<string, InstancedMesh[]>();
  private characterObjects: Object3D[] = [];
  private characterRefs: RuntimeCharacterRef[] = [];
  private lightObjects: LightObjectRecord[] = [];
  private localBounds = new Map<string, Box3>();
  private sun: DirectionalLight | null = null;
  private ambientLight: AmbientLight | null = null;
  private cameraViewTouched = false;
  /** Latest per-entity locomotion snapshot a behavior reported (read by the Game Mode). */
  private readonly locomotionReports = new Map<string, LocomotionInput>();
  /** The active Game Mode session driving camera/possession this Play boot. */
  private gameModeSession: GameModeSession | null = null;
  private gravityY = DEFAULT_SCENE_GRAVITY[1];

  onFrame: ((deltaMs: number) => void) | null = null;

  private readonly applyEntityTransformToRender = (
    entityId: string,
    transform: TransformComponent,
  ): void => {
    const instance = parseInstanceEntityId(entityId);
    if (instance) {
      this.syncInstanceTransform(instance.assetId, instance.placementIndex, transform);
      return;
    }

    const index = parseCharacterEntityIndex(entityId);
    if (index === null) return;
    const object = this.characterObjects[index];
    if (!object) return;
    object.position.set(transform.position[0], transform.position[1], transform.position[2]);
    applyEulerDegrees(object, transform.rotation);
    object.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
  };

  private readonly syncEntityTransform = (entityId: string, transform: TransformComponent): void => {
    this.applyEntityTransformToRender(entityId, transform);
    this.physicsSubsystem.setEntityTransform(entityId, transform);
  };

  constructor(canvas: HTMLCanvasElement) {
    const runtimeCore = createSceneRuntimeCore(canvas, {
      backgroundColor: DEFAULT_SCENE_BACKGROUND_COLOR,
    });
    this.renderer = runtimeCore.renderer;
    this.scene = runtimeCore.scene;
    this.camera = runtimeCore.camera;

    this.engineApp.registerSubsystem(this.animationSubsystem);
    this.engineApp.registerSubsystem(this.inputSubsystem);
    this.engineApp.registerSubsystem(this.physicsSubsystem);
    this.physicsSubsystem.setTransformSink(this.applyEntityTransformToRender);
    this.behaviorSubsystem = new BehaviorSubsystem(
      createBehaviorRegistry({
        getGravityY: () => this.gravityY,
        reportLocomotion: (entityId, report) => {
          this.locomotionReports.set(entityId, report);
        },
        onGoalReached: (entityId) => {
          console.info("[runtime] goal reached", entityId);
        },
      }),
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
      this.audioSubsystem,
    );
    this.engineApp.registerSubsystem(this.behaviorSubsystem);
    this.engineApp.registerSubsystem(this.audioSubsystem);
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
      this.gameModeSession?.update(deltaMs / 1000);
      this.renderer.render(this.scene, this.camera);
      this.onFrame?.(deltaMs);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    this.keyboardInput.detach();
    this.gameModeSession?.dispose();
    void this.engineApp.dispose();
    this.renderer.dispose();
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return readSceneRuntimeStats(this.renderer);
  }

  private async loadActiveProjectScene(): Promise<void> {
    this.activeProject = await loadActiveProject();
    this.assetLoader = new AssetLoader(this.activeProject.manifest);
    this.layout = await loadRoomLayout(this.activeProject.manifest.editor.defaultScene);
    this.gravityY = resolveSceneWorldSettings(this.layout).gravity[1];
    this.physicsSubsystem.setGravity(resolveSceneWorldSettings(this.layout).gravity);
    this.ensureDefaultLights();
    this.models = await this.assetLoader.loadGroups(this.layout.loadGroups);
    await this.loadMissingSceneModels();
    const convertedUnlitMaterials = convertUnlitModelMaterialsToLit(this.models);
    this.localBounds = computeModelLocalBounds(this.models);
    // Shape actors persist as `shape:<type>` instances whose synthetic models are
    // not in any loadGroup; register them before the scene is built, or the
    // instanced-model builder throws and aborts scene construction (the editor
    // does the same via registerShapeModelsFromLayout).
    registerSceneShapeModels(this.layout, this.models, this.localBounds);

    buildSceneEntities(this.layout, {
      addInstance: (assetId, placements) =>
        this.scene.add(this.createInstancedModel(assetId, placements)),
      addCharacter: (assetId, character) => this.addCharacter(this.models.get(assetId), character),
      addLight: (light) => this.addLight(light),
    });

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

    await this.loadCollisionDefs();
    await startSceneRuntime({
      sceneDocument: roomLayoutToSceneDocument(this.layout, {
        colliderBox: (assetId, source) => this.colliderBoxFor(assetId, source),
        collisionDefs: this.collisionDefs,
      }),
      physics: this.physicsSubsystem,
      behavior: this.behaviorSubsystem,
      engineApp: this.engineApp,
    });

    this.startGameMode();
  }

  /**
   * Resolves the layout's selected Game Mode (Unreal's GameMode analogue),
   * spawns + possesses its default pawn, then attaches ambient single-clip
   * animation to every character the mode did not possess. Unknown/absent
   * `worldSettings.gameMode` falls back to the default camera mode.
   */
  private startGameMode(): void {
    const session = resolveGameMode(this.layout?.worldSettings?.gameMode).createSession(
      this.createGameModeContext(),
    );
    session.spawnDefaultPawn();
    session.possess();
    this.gameModeSession = session;

    // Characters the Game Mode did not possess keep their single authored clip.
    const possessedEntityId = session.playerState.pawnEntityId;
    for (const ref of this.characterRefs) {
      if (ref.entityId === possessedEntityId) continue;
      const mixer = createSceneCharacterMixer(ref.object, ref.gltf, ref.placement.animation);
      if (mixer) this.animationSubsystem.add(mixer);
    }
  }

  private createGameModeContext(): GameModeContext {
    return {
      camera: this.camera,
      actions: this.inputActions,
      characters: this.characterRefs,
      getLocomotion: (entityId) => this.locomotionReports.get(entityId),
      addMixer: (mixer) => this.animationSubsystem.add(mixer),
      markCameraControlled: () => {
        this.cameraViewTouched = true;
      },
    };
  }

  /**
   * World-aligned collider footprint for a placed asset, from its loaded model
   * bounds, so derived colliders match the rendered mesh instead of a unit cube.
   * Returns undefined when bounds are unavailable (adapter falls back to a
   * scaled unit box).
   */
  private colliderBoxFor(assetId: string, source: ColliderTransformSource) {
    const bounds = this.localBounds.get(assetId);
    return bounds ? colliderBoxFromBounds(bounds, source) : undefined;
  }

  /**
   * Loads authored collision sidecars for the layout's assets so the runtime
   * physics collider uses the compound shapes (not the auto bounding box). Only
   * definitions with primitives are kept; missing sidecars fall back silently.
   */
  private async loadCollisionDefs(): Promise<void> {
    if (!this.assetLoader || !this.layout) return;
    const manifest = await this.assetLoader.loadManifest();
    const assetIds = new Set<string>();
    for (const instance of this.layout.instances) assetIds.add(instance.assetId);
    for (const character of this.layout.characters) assetIds.add(character.assetId);
    const defs = new Map<string, AssetCollisionDef>();
    await Promise.all(
      [...assetIds].map(async (assetId) => {
        const file = manifest.assets.find((entry) => entry.id === assetId)?.file;
        if (!file) return;
        const def = await loadAssetCollision(file);
        if (def.primitives.length > 0) defs.set(assetId, def);
      }),
    );
    this.collisionDefs = defs;
  }

  private async loadMissingSceneModels(): Promise<void> {
    if (!this.assetLoader) return;
    const missing = sceneModelAssetIds(this.layout).filter((assetId) => !this.models.has(assetId));
    if (missing.length === 0) return;
    const models = await this.assetLoader.loadModels(missing);
    for (const [assetId, model] of models) this.models.set(assetId, model);
  }

  private createInstancedModel(assetId: string, placements: LayoutPlacement[]): Group {
    const gltf = this.models.get(assetId);
    if (!gltf) throw new Error(`Runtime asset missing: ${assetId}`);
    const { group, meshes } = buildSceneInstancedModel({
      assetId,
      gltf,
      placements,
      castShadow: this.staticObjectsCastShadow(),
      receiveShadow: this.staticObjectsReceiveShadow(),
    });
    this.instanceGroups.set(assetId, group);
    this.instanceMeshes.set(assetId, meshes);
    return group;
  }

  private syncInstanceTransform(
    assetId: string,
    placementIndex: number,
    transform: TransformComponent,
  ): void {
    const meshes = this.instanceMeshes.get(assetId);
    if (!meshes) return;
    const transformMatrix = composeTransformMatrix(
      transform.position,
      transform.rotation,
      transform.scale,
    );
    for (const mesh of meshes) {
      const sourceMatrix =
        mesh.userData.sourceMatrix instanceof Matrix4
          ? mesh.userData.sourceMatrix
          : new Matrix4();
      mesh.setMatrixAt(placementIndex, transformMatrix.clone().multiply(sourceMatrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  private addCharacter(gltf: GLTF | undefined, placement: LayoutCharacter): void {
    if (!gltf) return;
    const index = this.characterObjects.length;
    const character = buildSceneCharacterObject(gltf, placement, index);
    character.userData.characterIndex = index;
    this.scene.add(character);
    this.characterObjects.push(character);
    // Offer the character to the active Game Mode; possession + animation are the
    // mode's responsibility (the default camera mode possesses nothing). The
    // single authored clip is attached for unpossessed characters in startGameMode.
    this.characterRefs.push({
      index,
      entityId: characterEntityId(index),
      object: character,
      gltf,
      placement,
    });
  }

  private addLight(actor: LayoutLightActor): void {
    const index = this.lightObjects.length;
    const record = buildSceneLightObject(actor, index);
    tagSceneLightRecordIndex(record, index);
    this.scene.add(record.root);
    if (record.target) this.scene.add(record.target);
    this.lightObjects.push(record);
    if (isSceneSunLight(actor, this.sun)) {
      this.sun = record.light as DirectionalLight;
    }
  }

  private ensureDefaultLights(): void {
    ensureDefaultSceneLights(this.layout);
  }

  private fitSunShadowToScene(): void {
    fitDirectionalShadowToBounds(this.sun, this.getRoomBounds());
  }

  private getRoomBounds(): Box3 | null {
    return computeSceneRoomBounds(this.layout, this.localBounds);
  }

  private applyBackgroundAndAmbient(): void {
    this.ambientLight = applySceneBackgroundAndAmbient({
      scene: this.scene,
      ambientLight: this.ambientLight,
      settings: resolveSceneWorldSettings(this.layout),
    });
  }

  private staticObjectsCastShadow(): boolean {
    return resolveSceneWorldSettings(this.layout).staticObjectsCastShadow;
  }

  private staticObjectsReceiveShadow(): boolean {
    return resolveSceneWorldSettings(this.layout).staticObjectsReceiveShadow;
  }

  private handleResize = (): void => {
    const resetView = resizeSceneRuntimeViewport({
      camera: this.camera,
      renderer: this.renderer,
      width: window.innerWidth,
      height: window.innerHeight,
      viewTouched: this.cameraViewTouched,
    });
    if (resetView) this.cameraViewTouched = false;
  };
}

function parseCharacterEntityIndex(entityId: string): number | null {
  if (!entityId.startsWith("character:")) return null;
  const index = Number(entityId.slice("character:".length));
  return Number.isInteger(index) ? index : null;
}

function parseInstanceEntityId(entityId: string): { assetId: string; placementIndex: number } | null {
  if (!entityId.startsWith("instance:")) return null;
  const separator = entityId.lastIndexOf(":");
  if (separator <= "instance:".length) return null;
  const index = Number(entityId.slice(separator + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return {
    assetId: decodeURIComponent(entityId.slice("instance:".length, separator)),
    placementIndex: index,
  };
}
