import { Box3, DirectionalLight, Group, Light as ThreeLight, Matrix4, Object3D, TextureLoader, Vector3 } from "three";
import type {
  AmbientLight,
  InstancedMesh,
  Material,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AssetLoader } from "./assetLoader";
import { loadRoomLayout } from "./roomLayout";
import { EngineApp } from "@engine/core/EngineApp";
import { AnimationSubsystem } from "@engine/render-three/animationSubsystem";
import { ActionMap, type ActionBindings } from "@engine/input/actionMap";
import { InputSubsystem } from "@engine/input/inputSubsystem";
import {
  BehaviorSubsystem,
  type ScriptMessageDebugSnapshot,
} from "@engine/behavior/behaviorSubsystem";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { AudioSubsystem } from "@engine/audio/audioSubsystem";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { PointerLookSource } from "@/input/pointerLookSource";
import { consumePlayCameraPose } from "@/play/cameraHandoff";
import { createBehaviorRegistry } from "@/game/behaviors";
import type { LocomotionInput } from "@/game/locomotionAnimation";
import { resolveGameMode } from "@/game/gameModes/registry";
import { TPS_GAME_MODE_ID } from "@/game/gameModes/catalog";
import {
  computePlayerStartSpawn,
  createDefaultPlayerCharacter,
  findPlayerStartTransform,
} from "@/game/gameModes/playerSpawn";
import type {
  GameModeContext,
  GameModeSession,
  PawnDefinition,
  RuntimeCharacterRef,
} from "@/game/gameModes/types";
import { loadActiveProject, projectFileUrl, type ActiveProject } from "@/project/ProjectSystem";
import {
  applySceneBackgroundAndAmbient,
  applyEditorMatchedPlayLook,
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
  DEFAULT_SCENE_SUN_ID,
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
import { attachActorLight } from "@engine/render-three/lights";
import {
  applySkySunDirection,
  applySkyToneMapping,
  applySkyUniforms,
  createSkyObject,
  followCameraWithSky,
  resolveSkyAtmosphere,
  setSkyLocalToneMappingExposure,
  skyAtmosphereToneMappingExposure,
  sunDirectionFromLightRotation,
} from "@engine/render-three/skyAtmosphere";
import { applySceneFog, resolveHeightFog } from "@engine/render-three/heightFog";
import {
  advanceCloudTime,
  applyCloudUniforms,
  createCloudObject,
  followCameraWithClouds,
  resolveCloudLayer,
  type CloudDome,
} from "@engine/render-three/cloudLayer";
import {
  applyPostProcessToneMapping,
  createPostProcessEffectPasses,
  hasPostProcessEffectPasses,
  PostProcessPipeline,
  postProcessToneMappingExposure,
  resolvePostProcess,
  type ResolvedPostProcess,
} from "@engine/render-three/postProcess";
import {
  applyReflectionEnvironment,
  captureSkyEnvironment,
  resolveReflection,
} from "@engine/render-three/reflection";
import {
  applyProbeEnvMapToObject,
  assignProbeEnvMapMaterial,
  bakeSphereReflectionCapture,
  disposeSphereReflectionCaptureBake,
  resolveSphereReflectionCapture,
  selectNearestReflectionCapture,
  type SphereReflectionCaptureBake,
  type SphereReflectionCaptureRenderItem,
} from "@engine/render-three/reflectionCapture";
import {
  createReflectionPlaneObject,
  disposeReflectionPlaneObject,
  resolveReflectionPlane,
  type ReflectionPlaneObject,
  type ReflectionPlaneRenderItem,
} from "@engine/render-three/reflectionPlane";
import { readRotation, readScale } from "@engine/scene/transform";
import type { Sky } from "three/examples/jsm/objects/Sky.js";
import {
  collectMaterialStats,
  convertUnlitModelMaterialsToLit,
  isRenderableMesh,
} from "@engine/render-three/materials";
import {
  applyEulerDegrees,
  colliderBoxFromBounds,
  composePlacementMatrix,
  composeTransformMatrix,
} from "@engine/render-three/transforms";
import type {
  LayoutCharacter,
  LayoutLightActor,
  LayoutPlacement,
  LayoutReflectionPlane,
  LayoutSphereReflectionCapture,
  RoomLayout,
  Vec3,
} from "@engine/scene/layout";
import {
  characterEntityId,
  roomLayoutToSceneDocument,
  type ColliderTransformSource,
} from "@engine/scene/legacyRoomLayoutAdapter";
import {
  actorInstanceToEntity,
  parseActorInstanceEntityIndex,
} from "@engine/scene/actorInstance";
import { normalizeActorScriptDef, type ActorScriptDef } from "@engine/scene/actorScript";
import { createCharacterSceneObject, entityCharacterItem } from "@engine/render-three/models";
import { isPlayerStartAssetId, shapeAssetCollisionDef } from "@engine/scene/shapes";
import { loadAssetCollision } from "@/scene/assetCollisionLoader";
import {
  applyAssetUvwMapping,
  loadAssetUvw,
} from "@/scene/assetUvwLoader";
import { loadForgeMaterial } from "@/scene/materialAssets";
import {
  loadAssetMaterialSlots,
  type AssetMaterialSlotsDef,
} from "@/scene/assetMaterialSlotsLoader";
import { assetPath, assetType, isModelAssetType, type AssetManifest } from "@engine/assets/manifest";
import type { AssetCollisionDef } from "@engine/scene/collision";
import {
  readAudioComponent,
  readLightComponent,
  readMeshRendererComponent,
  readParticleEmitterComponent,
  readTransformComponent,
} from "@engine/scene/components";
import type { TransformComponent } from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import type { SceneDocument } from "@engine/scene/sceneDocument";
import {
  ParticleEffect,
  parseEffectDefinition,
  type EffectDefinition,
} from "@engine/render-three/particleEffect";

const DEFAULT_INPUT_BINDINGS: ActionBindings = {
  KeyW: "move-forward",
  ArrowUp: "move-forward",
  KeyS: "move-back",
  ArrowDown: "move-back",
  KeyA: "move-left",
  ArrowLeft: "move-left",
  KeyD: "move-right",
  ArrowRight: "move-right",
  KeyE: "interact",
  Space: "jump",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
};

export interface RuntimeStatsApp {
  onFrame: ((deltaMs: number) => void) | null;
  getRenderStats(): { drawCalls: number; triangles: number };
  getScriptMessageDebugSnapshot(): ScriptMessageDebugSnapshot;
}

export interface RuntimeSceneAppOptions {
  readonly scriptMessageTraceLimit?: number;
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
  /** Manifest sound asset id -> fetchable file URL, filled after the manifest loads. */
  private readonly soundUrlById = new Map<string, string>();
  /** Manifest effect (`.effect.json`) asset id -> fetchable file URL. */
  private readonly effectUrlById = new Map<string, string>();
  /** Parsed effect definitions, cached by effect id. */
  private readonly effectDefs = new Map<string, EffectDefinition | null>();
  /** Live particle effects updated each frame; finished one-shots are removed. */
  private particleEffects: ParticleEffect[] = [];
  private readonly audioSubsystem = new AudioSubsystem({
    backend: "web-audio",
    resolveClipUrl: (clipId) => this.soundUrlById.get(clipId) ?? null,
  });
  private readonly keyboardInput = new KeyboardInputSource(this.inputActions);
  private readonly pointerLook: PointerLookSource;
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
  /** Asset manifest (with `.assets`), cached once the scene begins loading. */
  private assetManifest: AssetManifest | null = null;
  private readonly textureLoader = new TextureLoader();
  /** Loaded material override assets, cached by material id. */
  private readonly materialCache = new Map<string, Material>();
  /** In-flight material loads, deduped by material id. */
  private readonly materialLoads = new Map<string, Promise<Material | undefined>>();
  /** Per-asset default material slots (`*.materials.json` sidecars). */
  private readonly assetMaterialSlots = new Map<string, AssetMaterialSlotsDef>();
  /** Cloned override mesh per overridden placement, keyed by `assetId:placementIndex`. */
  private readonly instanceOverrideObjects = new Map<string, Object3D>();
  /** Baked PMREM cache per Sphere Reflection Capture, by index (null = hidden / unbaked). */
  private reflectionCaptureBakes: (SphereReflectionCaptureBake | null)[] = [];
  /** Per-asset materials cloned to carry a probe envMap; disposed on rebuild. */
  private readonly instanceProbeMaterials = new Map<string, Material[]>();
  /** Planar Reflection (mirror) reflectors built from `layout.reflectionPlanes`. */
  private reflectionPlaneObjects: ReflectionPlaneObject[] = [];
  private characterObjects: Object3D[] = [];
  private characterRefs: RuntimeCharacterRef[] = [];
  private lightObjects: LightObjectRecord[] = [];
  /** Entities flattened from placed Actor Script instances (`layout.actors`). */
  private actorEntities: Entity[] = [];
  /** Rendered object per actor instance index (absent for mesh-less logic actors). */
  private readonly actorObjects = new Map<number, Object3D>();
  /** Resolved `*.actor.json` classes, cached by classRef across instances. */
  private readonly actorClassCache = new Map<string, ActorScriptDef>();
  private localBounds = new Map<string, Box3>();
  private sun: DirectionalLight | null = null;
  private ambientLight: AmbientLight | null = null;
  /** Sky Atmosphere dome (singleton); null when no sky actor is in the layout. */
  private skyObject: Sky | null = null;
  private cloudObject: CloudDome | null = null;
  /** Captured Sky Light environment (PMREM) backing `scene.environment`; null when none. */
  private reflectionTarget: WebGLRenderTarget | null = null;
  private postProcessPipeline: PostProcessPipeline | null = null;
  private cameraViewTouched = false;
  /** Latest per-entity locomotion snapshot a behavior reported (read by the Game Mode). */
  private readonly locomotionReports = new Map<string, LocomotionInput>();
  private readonly interactionPromptElement: HTMLDivElement;
  private activeInteractionPromptEntityId: string | null = null;
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

    const actorIndex = parseActorInstanceEntityIndex(entityId);
    if (actorIndex !== null) {
      const actorObject = this.actorObjects.get(actorIndex);
      if (!actorObject) return;
      actorObject.position.set(transform.position[0], transform.position[1], transform.position[2]);
      applyEulerDegrees(actorObject, transform.rotation);
      actorObject.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
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

  constructor(canvas: HTMLCanvasElement, options: RuntimeSceneAppOptions = {}) {
    const runtimeCore = createSceneRuntimeCore(canvas, {
      backgroundColor: DEFAULT_SCENE_BACKGROUND_COLOR,
    });
    this.renderer = runtimeCore.renderer;
    applyEditorMatchedPlayLook(this.renderer);
    this.scene = runtimeCore.scene;
    this.camera = runtimeCore.camera;
    this.pointerLook = new PointerLookSource(canvas);
    this.interactionPromptElement = this.createInteractionPromptElement();

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
        onInteraction: (entityId, action) => {
          console.info("[runtime] interaction", action, entityId);
        },
        onInteractionOverlap: (entityId, action, prompt, overlapping) => {
          this.setInteractionPrompt(entityId, action, prompt, overlapping);
        },
        onActorLightToggle: (entityId, enabled) => {
          this.setActorLightEnabled(entityId, enabled);
        },
        onActorParticleEffect: (entityId) => {
          void this.playActorParticleEffect(entityId);
        },
        // The active Game Mode owns possession: only the pawn it possessed
        // (none, under the default camera mode) is driven by player input.
        isPlayerControlled: (entityId) =>
          this.gameModeSession?.playerState.pawnEntityId === entityId,
      }),
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
      this.audioSubsystem,
      {
        messageTraceLimit: options.scriptMessageTraceLimit ?? 0,
        onMessageWarnings: (warnings) => {
          for (const warning of warnings) {
            console.warn("[script-message]", warning.message, warning.envelope ?? "");
          }
        },
      },
    );
    this.engineApp.registerSubsystem(this.behaviorSubsystem);
    this.engineApp.registerSubsystem(this.audioSubsystem);
    this.keyboardInput.attach();
    this.pointerLook.attach();
    this.resumeAudioOnFirstGesture();

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
      this.updateParticleEffects(deltaMs / 1000);
      if (this.skyObject) followCameraWithSky(this.skyObject, this.camera);
      if (this.cloudObject) {
        followCameraWithClouds(this.cloudObject, this.camera);
        advanceCloudTime(this.cloudObject, deltaMs / 1000);
      }
      if (this.postProcessPipeline) this.postProcessPipeline.render(deltaMs / 1000);
      else this.renderer.render(this.scene, this.camera);
      this.onFrame?.(deltaMs);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    this.keyboardInput.detach();
    this.pointerLook.detach();
    for (const effect of this.particleEffects) {
      this.scene.remove(effect.object3D);
      effect.dispose();
    }
    this.particleEffects = [];
    this.gameModeSession?.dispose();
    this.postProcessPipeline?.dispose();
    this.postProcessPipeline = null;
    this.disposeReflectionTarget();
    for (const bake of this.reflectionCaptureBakes) {
      if (bake) disposeSphereReflectionCaptureBake(bake);
    }
    this.reflectionCaptureBakes = [];
    for (const reflector of this.reflectionPlaneObjects) {
      this.scene.remove(reflector);
      disposeReflectionPlaneObject(reflector);
    }
    this.reflectionPlaneObjects = [];
    this.disposeInstanceProbeMaterials();
    this.interactionPromptElement.remove();
    void this.engineApp.dispose();
    this.renderer.dispose();
  }

  /** Advances live particle effects and removes finished one-shot effects. */
  private updateParticleEffects(dt: number): void {
    for (let i = this.particleEffects.length - 1; i >= 0; i -= 1) {
      const effect = this.particleEffects[i]!;
      effect.update(dt);
      if (effect.isFinished()) {
        this.scene.remove(effect.object3D);
        effect.dispose();
        this.particleEffects.splice(i, 1);
      }
    }
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return readSceneRuntimeStats(this.renderer);
  }

  getScriptMessageDebugSnapshot(): ScriptMessageDebugSnapshot {
    return this.behaviorSubsystem.getScriptMessageDebugSnapshot();
  }

  private createInteractionPromptElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.textContent = "Press E Key";
    element.hidden = true;
    element.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:16%",
      "transform:translateX(-50%)",
      "z-index:20",
      "padding:8px 12px",
      "border-radius:6px",
      "background:rgba(12,16,22,0.82)",
      "color:#ffffff",
      "font:600 15px system-ui,sans-serif",
      "letter-spacing:0",
      "pointer-events:none",
      "box-shadow:0 6px 18px rgba(0,0,0,0.24)",
    ].join(";");
    document.body.append(element);
    return element;
  }

  private setInteractionPrompt(
    entityId: string,
    _action: string,
    prompt: string | undefined,
    overlapping: boolean,
  ): void {
    if (overlapping) {
      this.activeInteractionPromptEntityId = entityId;
      this.interactionPromptElement.textContent = prompt?.trim() || "Press E Key";
      this.interactionPromptElement.hidden = false;
      return;
    }
    if (this.activeInteractionPromptEntityId !== entityId) return;
    this.activeInteractionPromptEntityId = null;
    this.interactionPromptElement.hidden = true;
  }

  private async loadActiveProjectScene(): Promise<void> {
    this.activeProject = await loadActiveProject();
    this.assetLoader = new AssetLoader(this.activeProject.manifest);
    this.layout = await loadRoomLayout(this.activeProject.manifest.editor.defaultScene);
    this.gravityY = resolveSceneWorldSettings(this.layout).gravity[1];
    this.physicsSubsystem.setGravity(resolveSceneWorldSettings(this.layout).gravity);
    this.applyPlayerStartSpawn();
    this.ensureDefaultLights();
    // Resolve placed Actor Script classes -> entities before models load, so their
    // mesh assets join the load list (loadActorMeshModels reads these entities).
    await this.resolveActorClasses();
    this.models = await this.assetLoader.loadGroups(this.layout.loadGroups);
    await this.loadMissingSceneModels();
    await this.loadActorMeshModels();
    const convertedUnlitMaterials = convertUnlitModelMaterialsToLit(this.models);
    this.localBounds = computeModelLocalBounds(this.models);
    // Shape actors persist as `shape:<type>` instances whose synthetic models are
    // not in any loadGroup; register them before the scene is built, or the
    // instanced-model builder throws and aborts scene construction (the editor
    // does the same via registerShapeModelsFromLayout).
    registerSceneShapeModels(this.layout, this.models, this.localBounds);
    await this.applyAssetUvwMappings();
    // Resolve material overrides + default slots into the cache before instances
    // build, so createInstancedModel can render the assigned materials (mirrors
    // the editor's material-override path; otherwise Play shows the base mesh).
    await this.loadSceneMaterials();

    buildSceneEntities(this.layout, {
      addInstance: (assetId, placements) => {
        // Player Start markers are editor-only authoring gizmos; the runtime reads
        // their transform (TPS spawn) but never renders them.
        if (isPlayerStartAssetId(assetId)) return;
        this.scene.add(this.createInstancedModel(assetId, placements));
      },
      addCharacter: (assetId, character) => this.addCharacter(this.models.get(assetId), character),
      addLight: (light) => this.addLight(light),
    });
    this.addActorObjects();

    this.fitSunShadowToScene();
    this.applyBackgroundAndAmbient();
    this.applyRuntimeSky();
    this.applyRuntimeReflection(true);
    this.applyRuntimePostProcess();
    this.applyRuntimeFog();
    this.applyRuntimeClouds();
    // Bake placed Sphere Reflection Captures from the finished scene + environment,
    // then assign nearest-probe envMaps (Play parity with the editor).
    this.buildRuntimeReflectionCaptures();
    // Planar Reflection mirrors come last so they don't leak into the probe cubemaps.
    this.buildRuntimeReflectionPlanes();

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
    await this.populateAssetUrls();
    const baseDocument = roomLayoutToSceneDocument(this.layout, {
      colliderBox: (assetId, source) => this.colliderBoxFor(assetId, source),
      collisionDefs: this.collisionDefs,
    });
    // Append flattened actor-instance entities so physics + behavior derive them
    // alongside the legacy instances/characters/lights.
    const sceneDocument: SceneDocument = {
      ...baseDocument,
      entities: [...baseDocument.entities, ...this.actorEntities],
    };
    await startSceneRuntime({
      sceneDocument,
      physics: this.physicsSubsystem,
      behavior: this.behaviorSubsystem,
      engineApp: this.engineApp,
    });
    this.playAutoPlayAudio(sceneDocument);
    void this.playAutoPlayParticles(sceneDocument);

    this.startGameMode();
  }

  /** Maps manifest `sound` + effect (`.effect.json`) asset ids to fetchable file URLs. */
  private async populateAssetUrls(): Promise<void> {
    if (!this.assetLoader) return;
    const manifest = await this.assetLoader.loadManifest();
    for (const asset of manifest.assets) {
      const path = assetPath(asset);
      if (assetType(asset) === "sound") this.soundUrlById.set(asset.id, projectFileUrl(path));
      if (path.endsWith(".effect.json")) this.effectUrlById.set(asset.id, projectFileUrl(path));
    }
  }

  /** Plays every Audio component flagged `autoPlay` once the scene is built (ambient). */
  private playAutoPlayAudio(document: SceneDocument): void {
    for (const entity of document.entities) {
      const audio = readAudioComponent(entity);
      if (!audio?.autoPlay) continue;
      this.audioSubsystem.playOneShot(audio.clipId, {
        volume: audio.volume,
        loop: audio.loop,
        spatial: audio.spatial,
      });
    }
  }

  /**
   * Spawns a live particle effect for every ParticleEmitter flagged `autoPlay`,
   * at the entity's authored position. Resolves the component's `effectId` to a
   * manifest `.effect.json`, loads + caches it, then adds the effect to the scene
   * for the frame loop to advance.
   */
  private async playAutoPlayParticles(document: SceneDocument): Promise<void> {
    for (const entity of document.entities) {
      const particle = readParticleEmitterComponent(entity);
      if (!particle?.autoPlay) continue;
      const transform = readTransformComponent(entity);
      if (!transform) continue;
      const url = this.effectUrlById.get(particle.effectId);
      if (!url) continue;
      const definition = await this.loadEffect(particle.effectId, url);
      if (!definition) continue;
      const effect = new ParticleEffect(definition);
      effect.setOrigin(transform.position[0], transform.position[1], transform.position[2]);
      this.scene.add(effect.object3D);
      this.particleEffects.push(effect);
    }
  }

  /** Fetches + parses an effect definition, caching the result (including misses). */
  private async loadEffect(effectId: string, url: string): Promise<EffectDefinition | null> {
    const cached = this.effectDefs.get(effectId);
    if (cached !== undefined) return cached;
    let definition: EffectDefinition | null = null;
    try {
      const response = await fetch(url);
      definition = parseEffectDefinition((await response.json()) as unknown);
    } catch {
      definition = null;
    }
    this.effectDefs.set(effectId, definition);
    return definition;
  }

  /**
   * Browser autoplay policies suspend the audio context until a user gesture, so
   * resume it on the first pointer/key input — then ambient cues auto-played at
   * scene load begin sounding. One-shot: removes itself after the first gesture.
   */
  private resumeAudioOnFirstGesture(): void {
    const resume = (): void => {
      this.audioSubsystem.resumeContext();
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
  }

  /**
   * In the TPS Game Mode, anchors the possessed player at the first Player Start
   * marker (or the origin when none exists) before the scene is built, so render,
   * physics and behavior all begin at the spawn point. When the scene has no
   * authored player character, spawns the mode's default character pawn at the
   * Player Start so Play always has someone to possess. The synthetic pawn is
   * appended to the in-memory layout only — never written back to the saved file.
   * No-op for other modes (the default camera mode possesses no character).
   */
  private applyPlayerStartSpawn(): void {
    if (!this.layout) return;
    const mode = resolveGameMode(this.layout.worldSettings?.gameMode);
    if (mode.id !== TPS_GAME_MODE_ID) return;

    const spawn = computePlayerStartSpawn(this.layout);
    if (spawn) {
      const character = this.layout.characters[spawn.characterIndex];
      if (!character) return;
      character.position = [...spawn.position];
      if (spawn.yawDeg !== null) character.rotation = [0, spawn.yawDeg, 0];
      return;
    }
    // No authored player character: spawn the mode's default character pawn at
    // the Player Start (only when one exists — the player enters at that marker).
    this.spawnDefaultPlayerPawn(mode.defaultPawn);
  }

  /**
   * Appends the TPS default player pawn to the in-memory layout at the Player
   * Start, so the scene builder, physics and the TPS possession path treat it
   * like an authored player. No-op without a character pawn asset or a Player
   * Start marker. Runtime-only; never persisted.
   */
  private spawnDefaultPlayerPawn(pawn: PawnDefinition): void {
    if (!this.layout) return;
    if (pawn.kind !== "character" || !pawn.characterAssetId) return;
    const start = findPlayerStartTransform(this.layout);
    if (!start) return;
    this.layout.characters.push(
      createDefaultPlayerCharacter(
        { assetId: pawn.characterAssetId, scale: pawn.characterScale, speed: pawn.movement?.speed },
        start.position,
        start.yawDeg,
      ),
    );
  }

  /**
   * Resolves the layout's selected Game Mode (Unreal's GameMode analogue),
   * spawns + possesses its default pawn, then attaches ambient single-clip
   * animation to every character the mode did not possess. Unknown/absent
   * `worldSettings.gameMode` falls back to the default camera mode.
   */
  private startGameMode(): void {
    this.applyPlayCameraHandoff();
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

  /**
   * If the editor's Play button handed off a viewport camera pose, place the
   * runtime camera there before the Game Mode possesses it (the default camera
   * mode then seeds its look angles from this pose). One-shot: opening `/`
   * directly has no handoff and keeps the scene's default framing. The TPS mode
   * overrides the camera each tick, so the handoff only matters for default mode.
   */
  private applyPlayCameraHandoff(): void {
    const pose = consumePlayCameraPose();
    if (!pose) return;
    this.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.camera.quaternion.set(
      pose.quaternion[0],
      pose.quaternion[1],
      pose.quaternion[2],
      pose.quaternion[3],
    );
    this.camera.updateMatrixWorld();
    this.cameraViewTouched = true;
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
      consumeLookDelta: () => this.pointerLook.consume(),
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
    for (const assetId of assetIds) {
      const def = shapeAssetCollisionDef(assetId);
      if (def && def.primitives.length > 0) defs.set(assetId, def);
    }
    await Promise.all(
      [...assetIds].map(async (assetId) => {
        if (defs.has(assetId)) return;
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        if (!asset) return;
        const def = await loadAssetCollision(assetPath(asset));
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

  /**
   * Resolves every placed Actor Script class (`layout.actors[].classRef`) and
   * flattens each instance into an entity. Classes are cached by classRef, so the
   * same blueprint placed N times is fetched once. Missing/malformed files
   * normalize to an empty `actor` class (loadActorClass never throws), so one bad
   * reference cannot abort scene construction.
   */
  private async resolveActorClasses(): Promise<void> {
    const actors = this.layout?.actors ?? [];
    this.actorEntities = await Promise.all(
      actors.map(async (instance, index) => {
        const def = await this.loadActorClass(instance.classRef);
        return actorInstanceToEntity(def, instance, index);
      }),
    );
  }

  /** Fetches + normalizes an `*.actor.json` class, caching by classRef (never throws). */
  private async loadActorClass(classRef: string): Promise<ActorScriptDef> {
    const cached = this.actorClassCache.get(classRef);
    if (cached) return cached;
    let def: ActorScriptDef;
    try {
      const response = await fetch(projectFileUrl(classRef), { cache: "no-cache" });
      def = normalizeActorScriptDef(response.ok ? await response.json() : {}, classRef);
    } catch {
      def = normalizeActorScriptDef({}, classRef);
    }
    this.actorClassCache.set(classRef, def);
    return def;
  }

  /**
   * Loads the mesh assets referenced by actor classes' MeshRenderer components.
   * Guards against ids that are absent from the manifest or are not loadable
   * meshes (a malformed class reference is logged + skipped, not thrown, so it
   * can't abort the scene). Procedural `shape:<type>` meshes in actors are not
   * supported in this version (manifest assets only).
   */
  private async loadActorMeshModels(): Promise<void> {
    if (!this.assetLoader) return;
    const needed = new Set<string>();
    for (const entity of this.actorEntities) {
      const renderer = readMeshRendererComponent(entity);
      if (renderer && !this.models.has(renderer.assetId)) needed.add(renderer.assetId);
    }
    if (needed.size === 0) return;
    const manifest = await this.assetLoader.loadManifest();
    const loadable: string[] = [];
    for (const id of needed) {
      const record = manifest.assets.find((asset) => asset.id === id);
      if (record && isModelAssetType(assetType(record))) loadable.push(id);
      else console.warn("[runtime] actor mesh asset missing or not a mesh:", id);
    }
    if (loadable.length === 0) return;
    const models = await this.assetLoader.loadModels(loadable);
    for (const [id, model] of models) this.models.set(id, model);
  }

  /**
   * Adds a renderable object for each actor entity that carries a MeshRenderer or
   * a Light, reusing the single-object (character) render path for meshes and an
   * empty host group for light-only actors. Mesh-less, light-less logic/trigger
   * actors get no object but still run as entities (behavior + collider). The
   * object is tracked by instance index so behavior/physics transform syncs find
   * it (see applyEntityTransformToRender); an attached actor light is a child, so
   * it tracks the host as it moves.
   */
  private addActorObjects(): void {
    this.actorEntities.forEach((entity, index) => {
      const object = this.buildActorHostObject(entity);
      if (!object) return;
      object.userData.actorIndex = index;
      this.scene.add(object);
      this.actorObjects.set(index, object);
    });
  }

  /**
   * The host object for an actor instance: its mesh (when a MeshRenderer resolves
   * to a loaded model), else an empty group positioned at the instance transform
   * when the actor carries a Light. Returns null for logic-only actors. Any Light
   * component is attached as a child so it illuminates and tracks the host.
   */
  private buildActorHostObject(entity: Entity): Object3D | null {
    const renderer = readMeshRendererComponent(entity);
    const gltf = renderer ? this.models.get(renderer.assetId) : undefined;
    const hasLight = readLightComponent(entity) !== undefined;
    let object: Object3D | null = null;
    if (gltf) {
      object = createCharacterSceneObject(gltf, entityCharacterItem(entity));
    } else if (hasLight) {
      const item = entityCharacterItem(entity);
      const group = new Group();
      group.name = item.name;
      group.position.set(item.position[0], item.position[1], item.position[2]);
      applyEulerDegrees(group, item.rotation);
      group.scale.set(item.scale[0], item.scale[1], item.scale[2]);
      group.visible = !item.hidden;
      object = group;
    }
    if (object) attachActorLight(object, entity);
    return object;
  }

  private setActorLightEnabled(entityId: string, enabled: boolean): void {
    const actorIndex = parseActorInstanceEntityIndex(entityId);
    if (actorIndex === null) return;
    const object = this.actorObjects.get(actorIndex);
    if (!object) return;
    const lights: ThreeLight[] = [];
    object.traverse((child) => {
      if (child instanceof ThreeLight) lights.push(child);
    });
    if (lights.length === 0) return;

    for (const light of lights) {
      if (typeof light.userData.forgeToggleBaseIntensity !== "number") {
        light.userData.forgeToggleBaseIntensity = light.intensity > 0 ? light.intensity : 1;
      }
      light.visible = enabled;
      light.intensity = enabled ? light.userData.forgeToggleBaseIntensity : 0;
    }
  }

  private async playActorParticleEffect(entityId: string): Promise<void> {
    const actorIndex = parseActorInstanceEntityIndex(entityId);
    if (actorIndex === null) return;
    const entity = this.actorEntities[actorIndex];
    if (!entity) return;
    const particle = readParticleEmitterComponent(entity);
    if (!particle) return;
    const url = this.effectUrlById.get(particle.effectId);
    if (!url) return;
    const definition = await this.loadEffect(particle.effectId, url);
    if (!definition) return;
    const transform = readTransformComponent(entity);
    if (!transform) return;
    const offset = readComponentVec3(entity.components.ParticleEmitter?.position) ?? [0, 0, 0];
    const effect = new ParticleEffect(definition);
    effect.setOrigin(
      transform.position[0] + offset[0],
      transform.position[1] + offset[1],
      transform.position[2] + offset[2],
    );
    this.scene.add(effect.object3D);
    this.particleEffects.push(effect);
  }

  private async applyAssetUvwMappings(): Promise<void> {
    if (!this.assetLoader || !this.layout) return;
    const manifest = await this.assetLoader.loadManifest();
    const assetIds = sceneModelAssetIds(this.layout);
    await Promise.all(
      assetIds.map(async (assetId) => {
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        const gltf = this.models.get(assetId);
        if (!asset || !gltf) return;
        applyAssetUvwMapping(gltf.scene, await loadAssetUvw(assetPath(asset)));
      }),
    );
  }

  private createInstancedModel(assetId: string, placements: LayoutPlacement[]): Group {
    const gltf = this.models.get(assetId);
    if (!gltf) throw new Error(`Runtime asset missing: ${assetId}`);
    const clonedMaterials: Material[] = [];
    // Placements with a material override and/or a reflection-capture probe envMap
    // are hidden in the instanced mesh and rendered as a separate clone (clone-
    // fallback), matching the editor so Play renders identically.
    const decisions = placements.map((placement) => {
      const materialSlot = this.resolvePlacementMaterialSlot(assetId, placement);
      const overrideMaterial =
        materialSlot && this.materialCache.has(materialSlot)
          ? this.materialCache.get(materialSlot)
          : undefined;
      const bake = placement.hidden
        ? null
        : this.probeBakeForPoint(this.placementWorldCenter(assetId, placement));
      return { placement, overrideMaterial, bake, asClone: Boolean(overrideMaterial) || Boolean(bake) };
    });
    const instancedPlacements = decisions.map((decision) =>
      decision.asClone ? { ...decision.placement, hidden: true } : decision.placement,
    );
    const { group, meshes } = buildSceneInstancedModel({
      assetId,
      gltf,
      placements: instancedPlacements,
      castShadow: this.staticObjectsCastShadow(),
      receiveShadow: this.staticObjectsReceiveShadow(),
    });
    decisions.forEach((decision, placementIndex) => {
      if (!decision.asClone || decision.placement.hidden) return;
      const object = this.createInstancedCloneObject(
        assetId,
        placementIndex,
        decision.placement,
        gltf,
        decision.overrideMaterial,
        decision.bake,
        clonedMaterials,
      );
      group.add(object);
      this.instanceOverrideObjects.set(overrideObjectKey(assetId, placementIndex), object);
    });
    this.instanceGroups.set(assetId, group);
    this.instanceMeshes.set(assetId, meshes);
    this.instanceProbeMaterials.set(assetId, clonedMaterials);
    return group;
  }

  private resolvePlacementMaterialSlot(assetId: string, placement: LayoutPlacement): string | undefined {
    return placement.materialSlot ?? this.assetMaterialSlots.get(assetId)?.slots[0];
  }

  /**
   * A clone of the asset mesh used for placements excluded from the shared
   * InstancedMesh: those with a material override and/or a reflection-capture probe
   * envMap. The base material is the override (when set) else the GLTF's own; a
   * `bake` clones that base per-mesh and assigns the probe's PMREM envMap. Matches
   * the editor's authoring-time clone so Play renders identically.
   */
  private createInstancedCloneObject(
    assetId: string,
    placementIndex: number,
    placement: LayoutPlacement,
    gltf: GLTF,
    overrideMaterial: Material | undefined,
    bake: SphereReflectionCaptureBake | null,
    clonedMaterials: Material[],
  ): Object3D {
    const object = gltf.scene.clone(true);
    object.name = `${assetId}-clone-${placementIndex}`;
    object.matrix.copy(composePlacementMatrix(placement));
    object.matrixAutoUpdate = false;
    object.visible = !(placement.hidden ?? false);
    object.userData.assetId = assetId;
    object.userData.placementIndex = placementIndex;
    object.traverse((child) => {
      if (!isRenderableMesh(child)) return;
      const resolveMaterial = (source: Material): Material => {
        const base = overrideMaterial ?? source;
        return bake
          ? assignProbeEnvMapMaterial(
              base,
              bake,
              clonedMaterials,
              this.scene.environment,
              this.scene.environmentIntensity,
            )
          : base;
      };
      child.material = Array.isArray(child.material)
        ? child.material.map(resolveMaterial)
        : resolveMaterial(child.material);
      child.castShadow = this.staticObjectsCastShadow();
      child.receiveShadow = this.staticObjectsReceiveShadow();
    });
    return object;
  }

  /** Resolved settings + world transform for a reflection-capture layout actor. */
  private reflectionCaptureItem(
    actor: LayoutSphereReflectionCapture,
  ): SphereReflectionCaptureRenderItem {
    return {
      ...resolveSphereReflectionCapture(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
    };
  }

  /** The baked, visible probes in layout order (the eligible nearest-probe pool). */
  private eligibleProbeBakes(): SphereReflectionCaptureBake[] {
    return this.reflectionCaptureBakes.filter(
      (bake): bake is SphereReflectionCaptureBake => bake !== null,
    );
  }

  /** The baked probe whose influence best covers `point`, or null for global fallback. */
  private probeBakeForPoint(point: Vec3): SphereReflectionCaptureBake | null {
    const bakes = this.eligibleProbeBakes();
    if (bakes.length === 0) return null;
    const index = selectNearestReflectionCapture(
      point,
      bakes.map((bake) => ({ position: bake.position, radius: bake.radius, priority: bake.priority })),
    );
    return index === null ? null : bakes[index]!;
  }

  /** World-space center of a static placement (bounds center if known, else its origin). */
  private placementWorldCenter(assetId: string, placement: LayoutPlacement): Vec3 {
    const matrix = composePlacementMatrix(placement);
    const bounds = this.localBounds.get(assetId);
    const center = bounds ? bounds.getCenter(new Vector3()) : new Vector3();
    center.applyMatrix4(matrix);
    return [center.x, center.y, center.z];
  }

  /** World-space center of an existing scene object (its current bounding box). */
  private objectWorldCenter(object: Object3D): Vec3 {
    const center = new Box3().setFromObject(object).getCenter(new Vector3());
    return [center.x, center.y, center.z];
  }

  private disposeInstanceProbeMaterials(): void {
    for (const materials of this.instanceProbeMaterials.values()) {
      for (const material of materials) material.dispose();
    }
    this.instanceProbeMaterials.clear();
  }

  /**
   * Bakes every visible Sphere Reflection Capture from the fully-built scene, then
   * assigns nearest-probe envMaps for Play (parity with the editor): instance groups
   * are rebuilt so probe-covered placements route to envMap clones (clone-fallback),
   * and characters/actors get an in-place material clone + envMap. Static, one-shot
   * at load — no recapture in Play. There are no editor aids in the runtime scene, so
   * the cubemap render needs no visibility juggling.
   */
  private buildRuntimeReflectionCaptures(): void {
    const captures = this.layout?.reflectionCaptures ?? [];
    this.reflectionCaptureBakes = captures.map(() => null);
    captures.forEach((actor, index) => {
      const item = this.reflectionCaptureItem(actor);
      if (item.hidden) return;
      this.reflectionCaptureBakes[index] = bakeSphereReflectionCapture(
        this.renderer,
        this.scene,
        item,
      );
    });
    if (this.eligibleProbeBakes().length === 0) return;
    this.applyRuntimeReflectionCaptureEnvMaps();
  }

  /** Re-routes instanced statics to probe envMap clones and assigns char/actor envMaps. */
  private applyRuntimeReflectionCaptureEnvMaps(): void {
    if (!this.layout) return;
    this.disposeInstanceProbeMaterials();
    this.instanceOverrideObjects.clear();
    for (const instance of this.layout.instances) {
      if (isPlayerStartAssetId(instance.assetId)) continue;
      const previous = this.instanceGroups.get(instance.assetId);
      if (previous) this.scene.remove(previous);
      this.scene.add(this.createInstancedModel(instance.assetId, instance.placements));
    }
    const globalEnv = this.scene.environment;
    const globalEnvIntensity = this.scene.environmentIntensity;
    this.characterObjects.forEach((object, index) => {
      const character = this.layout?.characters[index];
      if (!object || !character) return;
      const bake = character.hidden ? null : this.probeBakeForPoint(this.objectWorldCenter(object));
      applyProbeEnvMapToObject(object, bake, globalEnv, globalEnvIntensity);
    });
    for (const [index, object] of this.actorObjects) {
      const actor = this.layout?.actors?.[index];
      if (!actor) continue;
      const bake = actor.hidden ? null : this.probeBakeForPoint(this.objectWorldCenter(object));
      applyProbeEnvMapToObject(object, bake, globalEnv, globalEnvIntensity);
    }
  }

  /** Resolved settings + world transform for a reflection-plane layout actor. */
  private reflectionPlaneItem(actor: LayoutReflectionPlane): ReflectionPlaneRenderItem {
    return {
      ...resolveReflectionPlane(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      scale: readScale(actor),
    };
  }

  /**
   * Builds the Planar Reflection mirrors (`layout.reflectionPlanes`) for Play —
   * editor parity with {@link SceneApp.buildReflectionPlanes}. Each `Reflector`
   * self-updates via its own `onBeforeRender`, so the render loop never drives it.
   * Called after the Sphere Reflection Capture bake so the flat mirrors never leak
   * into the probe cubemaps (the editor hides them during its bake instead).
   */
  private buildRuntimeReflectionPlanes(): void {
    const planes = this.layout?.reflectionPlanes ?? [];
    planes.forEach((actor) => {
      const reflector = createReflectionPlaneObject(this.reflectionPlaneItem(actor));
      this.reflectionPlaneObjects.push(reflector);
      this.scene.add(reflector);
    });
  }

  /**
   * Loads per-asset default material slots (`*.materials.json`) and every material
   * a placement references, caching them before instances build. Individual load
   * failures are swallowed so one bad material can't abort scene construction.
   */
  private async loadSceneMaterials(): Promise<void> {
    if (!this.assetLoader || !this.layout) return;
    const manifest = await this.assetLoader.loadManifest();
    this.assetManifest = manifest;
    const assetIds = sceneModelAssetIds(this.layout);
    await Promise.all(
      assetIds.map(async (assetId) => {
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        if (!asset) return;
        const slots = await loadAssetMaterialSlots(assetPath(asset));
        if (slots.slots.length > 0) this.assetMaterialSlots.set(assetId, slots);
      }),
    );
    const materialIds = new Set<string>();
    for (const instance of this.layout.instances) {
      for (const placement of instance.placements) {
        const id = this.resolvePlacementMaterialSlot(instance.assetId, placement);
        if (id) materialIds.add(id);
      }
    }
    await Promise.all(
      [...materialIds].map((id) => this.ensureMaterialLoaded(id).catch(() => undefined)),
    );
  }

  /** Loads + caches a material override asset by id (deduped; never rejects callers via the cache). */
  private ensureMaterialLoaded(materialId: string): Promise<Material | undefined> {
    const cached = this.materialCache.get(materialId);
    if (cached) return Promise.resolve(cached);
    const pending = this.materialLoads.get(materialId);
    if (pending) return pending;
    const manifest = this.assetManifest;
    if (!manifest) return Promise.resolve(undefined);
    const load = loadForgeMaterial(manifest, materialId, this.textureLoader)
      .then((material) => {
        this.materialCache.set(materialId, material);
        this.materialLoads.delete(materialId);
        return material;
      })
      .catch((error) => {
        this.materialLoads.delete(materialId);
        console.warn(
          "[runtime] material load failed:",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      });
    this.materialLoads.set(materialId, load);
    return load;
  }

  private syncInstanceTransform(
    assetId: string,
    placementIndex: number,
    transform: TransformComponent,
  ): void {
    const transformMatrix = composeTransformMatrix(
      transform.position,
      transform.rotation,
      transform.scale,
    );
    // Overridden placements render as a separate clone, not the instanced slot
    // (which stays hidden). Move that clone instead, or the base mesh would
    // reappear and the override would stay frozen at its authored pose.
    const overrideObject = this.instanceOverrideObjects.get(
      overrideObjectKey(assetId, placementIndex),
    );
    if (overrideObject) {
      overrideObject.matrix.copy(transformMatrix);
      overrideObject.matrixWorldNeedsUpdate = true;
      return;
    }
    const meshes = this.instanceMeshes.get(assetId);
    if (!meshes) return;
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

  /**
   * Renders the Sky Atmosphere dome at runtime. Like the editor, the directional
   * Sun light is the source of truth for the sun: its (persisted) rotation places
   * the sun disc. The runtime only builds the backdrop + tone mapping.
   */
  private applyRuntimeSky(): void {
    const actor = this.layout?.skyAtmosphere ?? null;
    if (!actor) {
      applySkyToneMapping(this.renderer, null);
      return;
    }
    const resolved = resolveSkyAtmosphere(actor);
    if (!this.skyObject) {
      this.skyObject = createSkyObject();
      this.scene.add(this.skyObject);
    }
    applySkyUniforms(this.skyObject, resolved);
    const sun = this.sunLightActor();
    if (sun) applySkySunDirection(this.skyObject, sunDirectionFromLightRotation(readRotation(sun)));
    followCameraWithSky(this.skyObject, this.camera);
    applySkyToneMapping(this.renderer, resolved);
  }

  /**
   * Applies the Exponential Height Fog to `scene.fog` at runtime (distance-based,
   * Faz 1). Mirrors the editor's applyHeightFog so Play looks identical.
   */
  private applyRuntimeFog(): void {
    const actor = this.layout?.heightFog ?? null;
    applySceneFog(this.scene, actor ? resolveHeightFog(actor) : null);
  }

  /**
   * Builds the static Cloud Layer dome at runtime (mirrors the editor's
   * applyCloudLayer) so Play shows the same procedural clouds. Absent/hidden
   * clouds leave the scene without the dome.
   */
  private applyRuntimeClouds(): void {
    const actor = this.layout?.cloudLayer ?? null;
    if (!actor) return;
    const resolved = resolveCloudLayer(actor);
    if (!this.cloudObject) {
      this.cloudObject = createCloudObject();
      this.scene.add(this.cloudObject);
    }
    applyCloudUniforms(this.cloudObject, resolved);
    followCameraWithClouds(this.cloudObject, this.camera);
  }

  /**
   * Mirrors the editor's Sky Atmosphere-owned Sky Light Capture in Play: capture
   * the authored sky once and use it as the global PBR environment/ambient bounce
   * wherever no local Sphere Reflection Capture applies.
   */
  private applyRuntimeReflection(recapture = false): void {
    const skyActor = this.layout?.skyAtmosphere ?? null;
    const sky = skyActor ? resolveSkyAtmosphere(skyActor) : null;
    if (!sky || sky.hidden) {
      this.disposeReflectionTarget();
      applyReflectionEnvironment(this.scene, null, null);
      return;
    }

    if (recapture || !this.reflectionTarget) {
      this.disposeReflectionTarget();
      const sun = this.sunLightActor();
      const sunDirection = sun
        ? sunDirectionFromLightRotation(readRotation(sun))
        : new Vector3(0, 1, 0);
      this.reflectionTarget = captureSkyEnvironment(this.renderer, sky, sunDirection);
    }

    applyReflectionEnvironment(this.scene, this.reflectionTarget, resolveReflection(sky.skyLightCapture));
  }

  private disposeReflectionTarget(): void {
    if (!this.reflectionTarget) return;
    this.reflectionTarget.dispose();
    this.reflectionTarget = null;
  }

  /** Applies global Post Process renderer properties after Sky tone mapping. */
  private applyRuntimePostProcess(): void {
    const actor = this.layout?.postProcess ?? null;
    const resolved = actor ? resolvePostProcess(actor) : null;
    applyPostProcessToneMapping(this.renderer, resolved);
    this.applyRuntimeSkyPostProcessExposure(resolved);
    if (!hasPostProcessEffectPasses(resolved)) {
      this.postProcessPipeline?.dispose();
      this.postProcessPipeline = null;
      return;
    }
    this.postProcessPipeline ??= new PostProcessPipeline({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    this.postProcessPipeline.setEffectPasses(
      createPostProcessEffectPasses(resolved, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }

  private applyRuntimeSkyPostProcessExposure(post: ResolvedPostProcess | null): void {
    if (!this.skyObject) return;
    const sky = this.layout?.skyAtmosphere ? resolveSkyAtmosphere(this.layout.skyAtmosphere) : null;
    if (!sky || sky.hidden || !post || post.hidden) {
      setSkyLocalToneMappingExposure(this.skyObject, null);
      return;
    }
    setSkyLocalToneMappingExposure(
      this.skyObject,
      postProcessToneMappingExposure(post.exposure) * skyAtmosphereToneMappingExposure(sky.exposure),
    );
  }

  /** The scene's Sun light actor (preferred id, else the first directional light). */
  private sunLightActor(): LayoutLightActor | null {
    const lights = this.layout?.lights;
    if (!lights) return null;
    return (
      lights.find((light) => light.type === "directional" && light.id === DEFAULT_SCENE_SUN_ID) ??
      lights.find((light) => light.type === "directional") ??
      null
    );
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
    this.postProcessPipeline?.setSize(window.innerWidth, window.innerHeight);
  };
}

function overrideObjectKey(assetId: string, placementIndex: number): string {
  return `${assetId}:${placementIndex}`;
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

function readComponentVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  return [x, y, z];
}
