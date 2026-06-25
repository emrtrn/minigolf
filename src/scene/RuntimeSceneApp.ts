import { Box3, DirectionalLight, Group, Light as ThreeLight, Matrix4, MeshStandardMaterial, Object3D, TextureLoader, Vector3 } from "three";
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
import { ActionMap } from "@engine/input/actionMap";
import { DEFAULT_INPUT_BINDINGS } from "@/game/defaultInputBindings";
import { InputSubsystem } from "@engine/input/inputSubsystem";
import {
  BehaviorSubsystem,
  type ScriptMessageDebugSnapshot,
} from "@engine/behavior/behaviorSubsystem";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { AudioSubsystem } from "@engine/audio/audioSubsystem";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { PointerLookSource } from "@/input/pointerLookSource";
import { PointerButtonSource } from "@/input/pointerButtonSource";
import { consumePlayCameraPose } from "@/play/cameraHandoff";
import { createBehaviorRegistry } from "@/game/behaviors";
import { CharacterMovementSubsystem } from "@/game/characterMovementSystem";
import type { LocomotionInput } from "@/game/locomotionAnimation";
import { resolveGameMode } from "@/game/gameModes/registry";
import { isGameModeClassRef } from "@/game/gameModes/catalog";
import { createProjectGameMode } from "@/game/gameModes/projectGameMode";
import {
  computePlayerStartSpawn,
  createDefaultPlayerCharacter,
  findPlayerStartTransform,
} from "@/game/gameModes/playerSpawn";
import type {
  GameModeContext,
  GameModeDefinition,
  GameModeSession,
  InputMode,
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
  computeComplexCollisionMeshes,
  type AssetComplexCollisionMesh,
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
  createPostProcessAntialiasPass,
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
import {
  createReflectiveSurfaceObject,
  disposeReflectiveSurfaceObject,
  resolveReflectiveSurface,
  type ReflectiveSurfaceObject,
  type ReflectiveSurfaceRenderItem,
} from "@engine/render-three/reflectiveSurface";
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
  LayoutActorInstance,
  LayoutCharacter,
  LayoutLightActor,
  LayoutPlacement,
  LayoutReflectionPlane,
  LayoutReflectiveSurface,
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
import {
  normalizeActorScriptDef,
  readGameModeDefaultPawnClassRef,
  type ActorScriptDef,
} from "@engine/scene/actorScript";
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
import {
  defaultAssetSkeleton,
  loadAssetSkeleton,
  type AssetSkeletonDef,
} from "@/scene/assetSkeletonLoader";
import { assetPath, assetType, isModelAssetType, type AssetManifest } from "@engine/assets/manifest";
import { normalizeUiWidgetDef, type UiWidgetDef } from "@engine/ui/uiWidget";
import { normalizeUiThemeDef, type UiThemeDef } from "@engine/ui/uiTheme";
import { UiViewModelStore, type UiFieldValue } from "@engine/ui/uiViewModel";
import { LocaleRegistry, normalizeUiLocaleTable } from "@engine/ui/uiLocale";
import { RuntimeUiSubsystem } from "@/ui/RuntimeUiSubsystem";
import type { AssetCollisionDef } from "@engine/scene/collision";
import {
  assetCollisionDefHasCollider,
  complexAsSimpleAssetIds,
} from "@engine/scene/collision";
import {
  readAudioComponent,
  readCharacterMovementComponent,
  readLightComponent,
  readMeshRendererComponent,
  readParticleEmitterComponent,
  readScriptActorComponent,
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

/**
 * Live gameplay readout for the `?debug` overlay: the active Game Mode, the pawn
 * it possessed, and that pawn's movement state (mode + grounded + velocity). Fields
 * are null when nothing is possessed (e.g. the default camera mode) or the pawn
 * carries no CharacterMovement / has not reported locomotion yet.
 */
export interface GameModeDebugSnapshot {
  /** Active Game Mode display name (or "—" before one resolves). */
  gameMode: string;
  /** Possessed pawn entity id, or null when nothing is possessed. */
  possessed: string | null;
  /** Possessed pawn's authored CharacterMovement mode, or null. */
  movementMode: string | null;
  /** Whether the possessed pawn rests on the floor, or null when unknown. */
  grounded: boolean | null;
  /** Possessed pawn's vertical velocity (units/s, up positive), or null. */
  velocityY: number | null;
  /** Possessed pawn's planar speed this tick (units/s), or null. */
  planarSpeed: number | null;
  /** Controller yaw in degrees, when the active mode owns control rotation. */
  controlYawDeg: number | null;
  /** Controller pitch in degrees, when the active mode owns control rotation. */
  controlPitchDeg: number | null;
  /** Current camera source, e.g. an authored SpringArm or fallback follow config. */
  cameraSource: string | null;
  /** Current runtime input mode. */
  inputMode: InputMode;
}

/**
 * Live UI-host readout for the `?debug` overlay: the mounted HUD, the active
 * screen stack (bottom → top) and the ViewModel store's current fields. Lets an
 * author confirm which widget is up and watch bound values change in place.
 */
export interface UiDebugSnapshot {
  /** Mounted HUD widget name, or null when none. */
  hud: string | null;
  /** Active screen widget names, bottom → top. */
  screens: string[];
  /** ViewModel store fields as path-sorted `[path, value]` pairs. */
  fields: Array<[string, UiFieldValue]>;
  /** Active UI locale, or null when the scene authors no localization tables. */
  locale: string | null;
  /** Accessibility audit findings across the mounted HUD + screens. */
  audit: string[];
}

export interface RuntimeStatsApp {
  onFrame: ((deltaMs: number) => void) | null;
  getRenderStats(): { drawCalls: number; triangles: number };
  getScriptMessageDebugSnapshot(): ScriptMessageDebugSnapshot;
  /** Optional: present on the runtime app, absent on the editor SceneApp. */
  getGameModeDebugSnapshot?(): GameModeDebugSnapshot;
  /** Optional: present on the runtime app, absent on the editor SceneApp. */
  getUiDebugSnapshot?(): UiDebugSnapshot;
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
  private readonly characterMovementSubsystem: CharacterMovementSubsystem;
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
  private readonly pointerButtons: PointerButtonSource;
  private readonly behaviorSubsystem: BehaviorSubsystem;
  private frameHandle = 0;
  private lastTime = 0;
  private activeProject: ActiveProject | null = null;
  private assetLoader: AssetLoader | null = null;
  private layout: RoomLayout | null = null;
  private collisionDefs = new Map<string, AssetCollisionDef>();
  /** Render-mesh triangle data for `complexAsSimple` assets (static trimesh collider). */
  private complexCollisionMeshes = new Map<string, AssetComplexCollisionMesh>();
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
  /** Textured reflective-surface meshes built from `layout.reflectiveSurfaces`. */
  private reflectiveSurfaceObjects: ReflectiveSurfaceObject[] = [];
  private characterObjects: Object3D[] = [];
  private characterRefs: RuntimeCharacterRef[] = [];
  private lightObjects: LightObjectRecord[] = [];
  /** Entities flattened from placed Actor Script instances (`layout.actors`). */
  private actorEntities: Entity[] = [];
  /** Rendered object per actor instance index (absent for mesh-less logic actors). */
  private readonly actorObjects = new Map<number, Object3D>();
  /**
   * Authored MeshRenderer local scale per actor index, multiplied into the
   * placement scale on every transform sync so a class's visual scale survives
   * the per-frame override (the sync writes the placement scale, which omits it).
   */
  private readonly actorMeshScales = new Map<number, Vec3>();
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
  /**
   * The Game Mode resolved for this Play boot (built-in registry mode, or a
   * project `gameMode` Actor Script). Resolved once (it may load a class file),
   * then reused by the spawn and session-start steps.
   */
  private activeGameMode: GameModeDefinition | null = null;
  private gravityY = DEFAULT_SCENE_GRAVITY[1];
  private inputMode: InputMode = "ui";
  /** UMG Lite runtime UI host; null when the layout authors no HUD/pause widget. */
  private uiSubsystem: RuntimeUiSubsystem | null = null;
  /** ViewModel-lite store backing UI `{ "bind": "path" }` props (e.g. `player.speed`). */
  private readonly uiStore = new UiViewModelStore();
  /** Pause-menu widget pushed on the `menu` action; null when none is configured. */
  private pauseMenuDef: UiWidgetDef | null = null;
  /** All loaded `.ui.json` widget defs keyed by asset id (used by Include resolution). */
  private readonly uiDefs = new Map<string, UiWidgetDef>();
  /** Loaded UI theme defs keyed by their `theme` reference (asset id or path). */
  private readonly uiThemes = new Map<string, UiThemeDef>();
  /** Loaded UI localization tables + active locale; null when the scene authors none. */
  private localeRegistry: LocaleRegistry | null = null;

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
      // Re-apply the class's MeshRenderer scale: the synced transform carries only
      // the placement scale, so without this the per-frame override would reset a
      // shrunk/grown character to full size.
      const meshScale = this.actorMeshScales.get(actorIndex) ?? [1, 1, 1];
      actorObject.scale.set(
        transform.scale[0] * meshScale[0],
        transform.scale[1] * meshScale[1],
        transform.scale[2] * meshScale[2],
      );
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
    this.pointerLook = new PointerLookSource(canvas, {
      onInputModeChange: (mode) => {
        const wasGame = this.inputMode === "game";
        this.inputMode = mode;
        // Losing pointer lock during play (Escape / alt-tab) opens the pause menu.
        // This covers browsers that swallow the Escape keydown under pointer lock,
        // where the `menu` action edge would otherwise never fire.
        if (mode === "ui" && wasGame) this.openPauseMenu();
      },
    });
    this.pointerButtons = new PointerButtonSource(this.inputActions, canvas);
    this.interactionPromptElement = this.createInteractionPromptElement();
    this.characterMovementSubsystem = new CharacterMovementSubsystem(
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
      {
        getGravityY: () => this.gravityY,
        getControlYaw: (entityId) => this.gameModeSession?.controlYawForEntity?.(entityId),
        reportLocomotion: (entityId, report) => {
          this.locomotionReports.set(entityId, report);
        },
        isPlayerControlled: (entityId) =>
          this.inputMode !== "ui" &&
          this.gameModeSession?.playerState.pawnEntityId === entityId &&
          !this.gameModeSession.playerState.pawnControlSuspended,
      },
    );

    this.engineApp.registerSubsystem(this.animationSubsystem);
    this.engineApp.registerSubsystem(this.inputSubsystem);
    this.engineApp.registerSubsystem(this.physicsSubsystem);
    this.engineApp.registerSubsystem(this.characterMovementSubsystem);
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
          this.inputMode !== "ui" &&
          this.gameModeSession?.playerState.pawnEntityId === entityId &&
          !this.gameModeSession.playerState.pawnControlSuspended,
      }),
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
      this.audioSubsystem,
      {
        messageTraceLimit: options.scriptMessageTraceLimit ?? 0,
        onMessageWarnings: (warnings) => {
          for (const warning of warnings) {
            // Animation notifies are fire-and-forget; no subscriber is normal, so
            // don't spam the console when nothing reacts to one.
            if (warning.code === "missing-handler" && warning.envelope?.type === "anim-notify") {
              continue;
            }
            console.warn("[script-message]", warning.message, warning.envelope ?? "");
          }
        },
      },
    );
    this.engineApp.registerSubsystem(this.behaviorSubsystem);
    this.engineApp.registerSubsystem(this.audioSubsystem);
    this.keyboardInput.attach();
    this.pointerLook.attach();
    this.pointerButtons.attach();
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
      this.gameModeSession?.beforeEngineUpdate?.(deltaMs / 1000);
      this.engineApp.update(deltaMs / 1000);
      // Consume the `menu` edge after input advances, before the Game Mode reads
      // input, so opening a screen suppresses this frame's camera/movement.
      this.updateUiInput();
      this.gameModeSession?.update(deltaMs / 1000);
      this.updateUiStore();
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
    this.uiSubsystem?.dispose();
    this.uiSubsystem = null;
    this.keyboardInput.detach();
    this.pointerLook.detach();
    this.pointerButtons.detach();
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
    for (const surface of this.reflectiveSurfaceObjects) {
      this.scene.remove(surface);
      disposeReflectiveSurfaceObject(surface);
    }
    this.reflectiveSurfaceObjects = [];
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

  /**
   * Snapshots the active Game Mode + possessed pawn's movement state for the
   * `?debug` overlay. The possessed pawn's grounded/velocity come from the latest
   * locomotion report (written by the CharacterMovement subsystem or the
   * input-move behavior); the movement mode is the pawn's authored
   * CharacterMovement mode when it is an Actor Script character.
   */
  getGameModeDebugSnapshot(): GameModeDebugSnapshot {
    const possessed = this.gameModeSession?.playerState.pawnEntityId ?? null;
    const report = possessed ? this.locomotionReports.get(possessed) : undefined;
    const cameraDebug = this.gameModeSession?.getCameraDebug?.();
    return {
      gameMode: this.activeGameMode?.displayName ?? "—",
      possessed,
      movementMode: this.possessedMovementMode(possessed),
      grounded: report ? report.grounded : null,
      velocityY: report ? report.velocityY : null,
      planarSpeed: report ? report.planarSpeed : null,
      controlYawDeg: cameraDebug?.controlYawDeg ?? null,
      controlPitchDeg: cameraDebug?.controlPitchDeg ?? null,
      cameraSource: cameraDebug?.cameraSource ?? null,
      inputMode: this.inputMode,
    };
  }

  /**
   * Snapshots the runtime UI host for the `?debug` overlay: the mounted HUD, the
   * active screen stack and the ViewModel store fields the widgets bind to.
   * Returns empty layers before the UI subsystem boots.
   */
  getUiDebugSnapshot(): UiDebugSnapshot {
    const host = this.uiSubsystem?.getDebugSnapshot() ?? { hud: null, screens: [], audit: [] };
    return {
      hud: host.hud,
      screens: host.screens,
      fields: this.uiStore.snapshot(),
      locale: this.localeRegistry?.activeLocale ?? null,
      audit: host.audit,
    };
  }

  /** Authored CharacterMovement mode of a possessed Actor Script pawn, else null. */
  private possessedMovementMode(entityId: string | null): string | null {
    if (entityId === null) return null;
    const actorIndex = parseActorInstanceEntityIndex(entityId);
    if (actorIndex === null) return null;
    const entity = this.actorEntities[actorIndex];
    if (!entity) return null;
    return readCharacterMovementComponent(entity)?.movementMode ?? null;
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
    this.ensureDefaultLights();
    // Resolve placed Actor Script classes -> entities before models load, so their
    // mesh assets join the load list (loadActorMeshModels reads these entities).
    await this.resolveActorClasses();
    await this.applyPlayerStartSpawn();
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
    // Planar reflections come last so they don't leak into the probe cubemaps.
    this.buildRuntimeReflectionPlanes();
    this.buildRuntimeReflectiveSurfaces();

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
      complexCollisionMeshes: this.complexCollisionMeshes,
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
      characterMovement: this.characterMovementSubsystem,
      behavior: this.behaviorSubsystem,
      engineApp: this.engineApp,
    });
    this.playAutoPlayAudio(sceneDocument);
    void this.playAutoPlayParticles(sceneDocument);

    // Character skeletal metadata (blend spaces / anim-set) drives the Game Mode's
    // locomotion animator, so attach it to the refs before the session possesses.
    await this.loadCharacterSkeletons();
    await this.startGameMode();
    await this.setupRuntimeUi();
  }

  /**
   * Mounts the UMG Lite runtime UI host when the layout authors a HUD and/or a
   * pause-menu widget (`worldSettings.hudWidget` / `pauseMenuWidget`). No-op when
   * neither is set, so a scene with no UI pays nothing. Widget `message` actions
   * are emitted as `ui-action` script messages (UI → gameplay); the screen stack
   * routes input through {@link handleUiScreenStackChange}.
   */
  private async setupRuntimeUi(): Promise<void> {
    if (!this.layout) return;
    const host = document.getElementById("ui-overlay");
    if (!host) return;
    const hudId = this.layout.worldSettings?.hudWidget;
    const pauseId = this.layout.worldSettings?.pauseMenuWidget;
    if (!hudId && !pauseId) return;

    // Load ALL .ui.json assets so Include refs in any widget can be resolved.
    const allDefs = await this.loadAllUiWidgetDefs();
    for (const [id, def] of allDefs) this.uiDefs.set(id, def);
    await this.loadUiThemeDefs(this.uiDefs.values());
    this.localeRegistry = await this.loadUiLocaleRegistry();
    this.uiSubsystem = new RuntimeUiSubsystem(host, {
      store: this.uiStore,
      ...(this.localeRegistry ? { locale: this.localeRegistry } : {}),
      resolveTheme: (ref) => this.uiThemes.get(ref) ?? null,
      resolveWidget: (src) => this.uiDefs.get(src) ?? null,
      onMessageAction: (action) => {
        this.behaviorSubsystem.emitScriptMessage("ui-action", "ui", { message: action.message });
      },
      onScreenStackChange: (depth) => this.handleUiScreenStackChange(depth),
    });

    // Seed bound fields so the initial render shows values (not blanks/zeroes).
    this.uiStore.setField("player.speed", 0);
    this.uiStore.setField("player.speedLabel", "Speed 0.0 m/s");

    if (hudId) {
      const hud = this.uiDefs.get(hudId);
      if (hud) this.uiSubsystem.setHud(hud);
    }
    if (pauseId) this.pauseMenuDef = this.uiDefs.get(pauseId) ?? null;
  }

  /**
   * Loads all `.ui.json` widget assets from the manifest (excludes `.theme.json`).
   * Used by {@link setupRuntimeUi} to populate the Include resolver registry.
   */
  private async loadAllUiWidgetDefs(): Promise<Map<string, UiWidgetDef>> {
    const out = new Map<string, UiWidgetDef>();
    if (!this.assetLoader) return out;
    const manifest = await this.assetLoader.loadManifest();
    const uiAssets = manifest.assets.filter(
      (entry) => assetType(entry) === "ui" && assetPath(entry).endsWith(".ui.json"),
    );
    await Promise.all(
      uiAssets.map(async (asset) => {
        try {
          const response = await fetch(projectFileUrl(assetPath(asset)), { cache: "no-cache" });
          if (!response.ok) return;
          out.set(asset.id, normalizeUiWidgetDef(await response.json(), asset.name));
        } catch {
          // Missing/malformed UI asset: skip it (the scene still plays).
        }
      }),
    );
    return out;
  }

  /**
   * Loads the `.loc.json` localization tables from the manifest into a
   * {@link LocaleRegistry}, then selects the active locale from
   * `worldSettings.locale` (falling back to the first registered table). Returns
   * null when the project authors no locale tables, so non-localized scenes pay
   * nothing. Tables are registered in manifest order for a deterministic default.
   */
  private async loadUiLocaleRegistry(): Promise<LocaleRegistry | null> {
    if (!this.assetLoader) return null;
    const manifest = await this.assetLoader.loadManifest();
    const locAssets = manifest.assets.filter(
      (entry) => assetType(entry) === "ui" && assetPath(entry).endsWith(".loc.json"),
    );
    if (locAssets.length === 0) return null;
    const tables = await Promise.all(
      locAssets.map(async (asset) => {
        try {
          const response = await fetch(projectFileUrl(assetPath(asset)), { cache: "no-cache" });
          if (!response.ok) return null;
          return normalizeUiLocaleTable(await response.json());
        } catch {
          // Missing/malformed locale table: skip it (keys fall back to themselves).
          return null;
        }
      }),
    );
    const registry = new LocaleRegistry();
    for (const table of tables) if (table) registry.register(table);
    if (registry.availableLocales().length === 0) return null;
    const desired = this.layout?.worldSettings?.locale;
    if (desired) registry.setActiveLocale(desired);
    return registry;
  }

  /**
   * Loads the theme defs referenced by the given widgets (`def.theme`) into
   * {@link uiThemes}, keyed by the reference. A reference resolves as a manifest
   * `ui` asset id first, else as a direct public-relative path (matching the
   * plan's `assets/ui/default.theme.json` form). Missing/malformed themes are
   * skipped — a themeless widget falls back to the built-in CSS variables.
   */
  private async loadUiThemeDefs(widgets: Iterable<UiWidgetDef>): Promise<void> {
    const refs = new Set<string>();
    for (const widget of widgets) if (widget.theme) refs.add(widget.theme);
    if (refs.size === 0) return;
    const manifest = this.assetLoader ? await this.assetLoader.loadManifest() : null;
    await Promise.all(
      [...refs].map(async (ref) => {
        const asset = manifest?.assets.find((entry) => entry.id === ref);
        const path = asset ? assetPath(asset) : ref;
        try {
          const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
          if (!response.ok) return;
          this.uiThemes.set(ref, normalizeUiThemeDef(await response.json(), ref));
        } catch {
          // Missing/malformed theme: skip it (widget uses default CSS variables).
        }
      }),
    );
  }

  /**
   * Routes input as the UI screen stack opens/closes. A screen forces `ui` input
   * (suppressing gameplay) and frees the cursor; closing the last screen re-grabs
   * pointer lock when the active camera uses it (a no-op for right-drag).
   */
  private handleUiScreenStackChange(depth: number): void {
    if (depth > 0) {
      this.inputMode = "ui";
      this.pointerLook.release();
      this.pointerLook.setMouseCursorVisible(true);
    } else {
      this.pointerLook.reengage();
    }
  }

  /** Toggles the pause menu on the `menu` action edge (Escape). */
  private updateUiInput(): void {
    if (!this.uiSubsystem) return;
    if (!this.inputActions.pressed("menu")) return;
    if (this.uiSubsystem.screenDepth > 0) this.uiSubsystem.back();
    else this.openPauseMenu();
  }

  /** Pushes the configured pause menu when one exists and no screen is open. */
  private openPauseMenu(): void {
    if (!this.uiSubsystem || !this.pauseMenuDef) return;
    if (this.uiSubsystem.screenDepth > 0) return;
    this.uiSubsystem.pushScreen(this.pauseMenuDef);
  }

  /**
   * Feeds the ViewModel store the possessed pawn's live state, then flushes so
   * only widgets bound to a changed field re-render. v1 surfaces the player's
   * planar speed (`player.speed` / `player.speedLabel`); the HUD binds to these.
   */
  private updateUiStore(): void {
    if (!this.uiSubsystem) return;
    const possessed = this.gameModeSession?.playerState.pawnEntityId ?? null;
    const speed = (possessed ? this.locomotionReports.get(possessed)?.planarSpeed : 0) ?? 0;
    this.uiStore.setField("player.speed", speed);
    this.uiStore.setField("player.speedLabel", `Speed ${speed.toFixed(1)} m/s`);
    this.uiStore.flush();
  }

  /**
   * Loads each character's `*.skeleton.json` sidecar (deduped per asset) and
   * attaches the result to every {@link RuntimeCharacterRef}. The Game Mode reads
   * `ref.skeleton` to drive blend-space locomotion; assets without a sidecar get
   * the safe empty default. Runs after the refs are built, before possession.
   */
  private async loadCharacterSkeletons(): Promise<void> {
    if (!this.assetLoader || this.characterRefs.length === 0) return;
    const manifest = await this.assetLoader.loadManifest();
    const byAsset = new Map<string, Promise<AssetSkeletonDef>>();
    const skeletonFor = (assetId: string): Promise<AssetSkeletonDef> => {
      let pending = byAsset.get(assetId);
      if (!pending) {
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        pending = asset ? loadAssetSkeleton(assetPath(asset)) : Promise.resolve(defaultAssetSkeleton());
        byAsset.set(assetId, pending);
      }
      return pending;
    };
    await Promise.all(
      this.characterRefs.map(async (ref) => {
        ref.skeleton = await skeletonFor(ref.placement.assetId);
      }),
    );
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
   * Resolves the Game Mode for this Play boot, caching the result. A project Game
   * Mode (`worldSettings.gameMode` is a `*.actor.json` class ref) is loaded and
   * built from its Actor Script class; built-in ids resolve through the registry.
   * A class ref that is not actually a `gameMode` class falls back to the default
   * camera mode, so a stale/mis-typed reference can't break Play.
   */
  private async resolveActiveGameMode(): Promise<GameModeDefinition> {
    if (this.activeGameMode) return this.activeGameMode;
    const id = this.layout?.worldSettings?.gameMode;
    let mode: GameModeDefinition;
    if (isGameModeClassRef(id)) {
      const def = await this.loadActorClass(id as string);
      mode =
        def.parentClass === "gameMode"
          ? createProjectGameMode({
              classRef: id as string,
              displayName: def.name,
              defaultPawnClassRef: readGameModeDefaultPawnClassRef(def),
            })
          : resolveGameMode(undefined);
    } else {
      mode = resolveGameMode(id);
    }
    this.activeGameMode = mode;
    return mode;
  }

  /**
   * Anchors / spawns the player a character-possessing Game Mode will possess,
   * before the scene is built so render, physics and behavior all begin at the
   * spawn point. Preference order:
   *  1. An authored player character (legacy `layout.characters`) is moved to the
   *     first Player Start marker (or the origin when none exists).
   *  2. An authored player Actor (a `character` class with CharacterMovement) is
   *     left where it was placed.
   *  3. Otherwise the mode's default pawn is spawned at the Player Start — a
   *     project Game Mode spawns its `pawnClassRef` Actor Script, the built-in TPS
   *     mode spawns its `characterAssetId` legacy character.
   * Synthetic pawns are appended to the in-memory layout only — never persisted.
   * No-op for non-character modes (the default camera mode possesses nothing).
   */
  private async applyPlayerStartSpawn(): Promise<void> {
    if (!this.layout) return;
    const mode = await this.resolveActiveGameMode();
    if (mode.defaultPawn.kind !== "character") return;

    const spawn = computePlayerStartSpawn(this.layout);
    if (spawn) {
      const character = this.layout.characters[spawn.characterIndex];
      if (!character) return;
      character.position = [...spawn.position];
      if (spawn.yawDeg !== null) character.rotation = [0, spawn.yawDeg, 0];
      return;
    }
    // An authored player Actor (character class with movement) already is a pawn.
    if (this.actorEntities.some((entity) => readCharacterMovementComponent(entity))) return;
    // No authored player: spawn the mode's default pawn at the Player Start.
    if (mode.defaultPawn.pawnClassRef) {
      await this.spawnDefaultPawnActor(mode.defaultPawn.pawnClassRef);
    } else {
      this.spawnDefaultPlayerPawn(mode.defaultPawn);
    }
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
   * Appends a project Game Mode's default pawn Actor Script to the in-memory
   * layout at the Player Start, and resolves its entity so the later model-load,
   * object-build and possession steps treat it like an authored player Actor (it
   * brings its own mesh + capsule + CharacterMovement from the class template).
   * No-op without a Player Start marker. Runtime-only; never persisted.
   */
  private async spawnDefaultPawnActor(classRef: string): Promise<void> {
    if (!this.layout) return;
    const start = findPlayerStartTransform(this.layout);
    if (!start) return;
    const instance: LayoutActorInstance = {
      classRef,
      name: "Player",
      position: [start.position[0], start.position[1], start.position[2]],
      rotation: [0, start.yawDeg ?? 0, 0],
    };
    if (!this.layout.actors) this.layout.actors = [];
    const index = this.layout.actors.length;
    this.layout.actors.push(instance);
    const def = await this.loadActorClass(classRef);
    this.actorEntities.push(actorInstanceToEntity(def, instance, index));
  }

  /**
   * Resolves the layout's selected Game Mode (Unreal's GameMode analogue),
   * spawns + possesses its default pawn, then attaches ambient single-clip
   * animation to every character the mode did not possess. Unknown/absent
   * `worldSettings.gameMode` falls back to the default camera mode.
   */
  private async startGameMode(): Promise<void> {
    this.applyPlayCameraHandoff();
    const mode = await this.resolveActiveGameMode();
    const session = mode.createSession(this.createGameModeContext());
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
      staticBlockerAabbs: () => this.physicsSubsystem.staticBlockerAabbs(),
      addMixer: (mixer) => this.animationSubsystem.add(mixer),
      emitAnimNotify: (entityId, name) =>
        this.behaviorSubsystem.emitScriptMessage("anim-notify", entityId, { name }, entityId),
      spawnRagdoll: (desc, options) => this.physicsSubsystem.spawnRagdoll(desc, options),
      sampleRagdoll: (id) => this.physicsSubsystem.sampleRagdoll(id),
      despawnRagdoll: (id) => this.physicsSubsystem.despawnRagdoll(id),
      onScriptMessage: (type, handler, options) =>
        this.behaviorSubsystem.subscribeScriptMessage(
          type,
          handler,
          options?.target !== undefined ? { target: options.target } : {},
        ),
      markCameraControlled: () => {
        this.cameraViewTouched = true;
      },
      consumeLookDelta: () =>
        this.inputMode === "ui" ? { dx: 0, dy: 0 } : this.pointerLook.consume(),
      getInputMode: () => this.inputMode,
      setInputMode: (mode) => {
        this.inputMode = mode;
      },
      setMouseCursorVisible: (visible) => this.pointerLook.setMouseCursorVisible(visible),
      setPointerLookMode: (mode) => this.pointerLook.setMode(mode),
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
      if (def && assetCollisionDefHasCollider(def)) defs.set(assetId, def);
    }
    await Promise.all(
      [...assetIds].map(async (assetId) => {
        if (defs.has(assetId)) return;
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        if (!asset) return;
        const def = await loadAssetCollision(assetPath(asset));
        if (assetCollisionDefHasCollider(def)) defs.set(assetId, def);
      }),
    );
    this.collisionDefs = defs;
    this.complexCollisionMeshes = computeComplexCollisionMeshes(
      this.models,
      complexAsSimpleAssetIds(defs),
    );
  }

  private async loadMissingSceneModels(): Promise<void> {
    if (!this.assetLoader) return;
    const needed = sceneModelAssetIds(this.layout).filter((assetId) => !this.models.has(assetId));
    if (needed.length === 0) return;
    // Only load ids the manifest still knows as meshes. A layout can outlive an
    // asset (e.g. a model imported then deleted leaves a dangling placement); such
    // ids are skipped with a warning instead of throwing and blanking the scene.
    const manifest = await this.assetLoader.loadManifest();
    const loadable = new Set(
      manifest.assets.filter((asset) => isModelAssetType(assetType(asset))).map((asset) => asset.id),
    );
    const absent = needed.filter((assetId) => !loadable.has(assetId));
    if (absent.length > 0) {
      console.warn("[runtime] layout references assets absent from the manifest; skipping:", absent);
    }
    const missing = needed.filter((assetId) => loadable.has(assetId));
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
      const meshScale = readMeshRendererComponent(entity)?.scale;
      if (meshScale) this.actorMeshScales.set(index, meshScale);
      this.addActorCharacterRef(entity, object);
    });
  }

  private addActorCharacterRef(entity: Entity, object: Object3D): void {
    const actor = readScriptActorComponent(entity);
    if (!actor) return;
    const def = this.actorClassCache.get(actor.classRef);
    if (def?.parentClass !== "character") return;
    const renderer = readMeshRendererComponent(entity);
    const gltf = renderer ? this.models.get(renderer.assetId) : undefined;
    const transform = readTransformComponent(entity);
    if (!gltf) return;
    this.characterRefs.push({
      index: this.characterRefs.length,
      entityId: entity.id,
      object,
      gltf,
      placement: {
        assetId: renderer?.assetId ?? "actor-character",
        ...(entity.name ? { name: entity.name } : {}),
        position: transform ? [...transform.position] : [0, 0, 0],
        rotation: transform ? [...transform.rotation] : [0, 0, 0],
        scale: transform ? [...transform.scale] : [1, 1, 1],
      },
      classRef: actor.classRef,
      parentClass: "character",
      hasCharacterMovement: readCharacterMovementComponent(entity) !== undefined,
      entity,
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
    // A dangling layout placement (asset removed from the manifest) renders
    // nothing rather than aborting the whole scene build.
    if (!gltf) {
      console.warn(`[runtime] skipping placement for unloaded asset: ${assetId}`);
      return new Group();
    }
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

  /** Resolved settings + world transform for a reflective-surface layout actor. */
  private reflectiveSurfaceItem(actor: LayoutReflectiveSurface): ReflectiveSurfaceRenderItem {
    return {
      ...resolveReflectiveSurface(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      scale: readScale(actor),
    };
  }

  /** A fresh clone of a cached material (surfaces patch their material, so never share). */
  private reflectiveSurfaceMaterial(materialId: string | null): MeshStandardMaterial | null {
    if (!materialId) return null;
    const cached = this.materialCache.get(materialId);
    return cached instanceof MeshStandardMaterial ? (cached.clone() as MeshStandardMaterial) : null;
  }

  /**
   * Builds the Reflective Surface meshes (`layout.reflectiveSurfaces`) for Play —
   * editor parity with {@link SceneApp.buildReflectiveSurfaces}. Materials are
   * preloaded in {@link loadSceneMaterials}, so each surface clones its cached
   * material here. Built after the capture bake so the surfaces don't leak into the
   * probe cubemaps (mirrors the Planar Reflection ordering).
   */
  private buildRuntimeReflectiveSurfaces(): void {
    const surfaces = this.layout?.reflectiveSurfaces ?? [];
    surfaces.forEach((actor) => {
      const item = this.reflectiveSurfaceItem(actor);
      const surface = createReflectiveSurfaceObject(item, this.reflectiveSurfaceMaterial(item.material));
      this.reflectiveSurfaceObjects.push(surface);
      this.scene.add(surface);
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
    for (const surface of this.layout.reflectiveSurfaces ?? []) {
      if (surface.material) materialIds.add(surface.material);
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
    const load = loadForgeMaterial(manifest, materialId, this.textureLoader, {
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    })
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
        scene: this.scene,
        camera: this.camera,
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
    this.postProcessPipeline.setAntialiasPass(
      createPostProcessAntialiasPass(resolved, {
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
