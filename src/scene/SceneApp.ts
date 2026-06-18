/**
 * SceneApp - the single render-layer orchestrator (L11 boundary).
 *
 * three.js is imported ONLY under src/scene/. Game rules live in pure-TS
 * modules (M1-M9, src/core/...) and talk to this layer via the event bus.
 * This class owns: renderer, scene graph, camera rig, lights, frame loop.
 */
import {
  Box3,
  BufferGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Plane,
  Raycaster,
  SphereGeometry,
  Vector3,
} from "three";
import type { AmbientLight, InstancedMesh, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AssetLoader } from "./assetLoader";
import { EngineApp } from "@engine/core/EngineApp";
import type { Subsystem } from "@engine/core/Subsystem";
import { AnimationSubsystem } from "@engine/render-three/animationSubsystem";
import { ActionMap, type ActionBindings } from "@engine/input/actionMap";
import { InputSubsystem } from "@engine/input/inputSubsystem";
import { BehaviorSubsystem } from "@engine/behavior/behaviorSubsystem";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { AudioSubsystem } from "@engine/audio/audioSubsystem";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { createBehaviorRegistry } from "@/game/behaviors";
import { DEFAULT_GAME_MODE_ID, normalizeGameModeId } from "@/game/gameModes/catalog";
import type { PlayCameraPose } from "@/play/cameraHandoff";
import { assetPath, type AssetManifest, type EditableAsset } from "@engine/assets/manifest";
import {
  dirnameProjectPath,
  loadActiveProject,
  type ActiveProject,
} from "@/project/ProjectSystem";
import { loadRoomLayout } from "./roomLayout";
import {
  applyEulerDegrees,
  colliderBoxFromBounds,
  composePlacementMatrix,
} from "@engine/render-three/transforms";
import { collisionWireboxes } from "@engine/render-three/collisionView";
import {
  collectMaterialStats,
  convertUnlitModelMaterialsToLit,
  isRenderableMesh,
} from "@engine/render-three/materials";
import {
  entityLightItem,
  disposeLightGizmo,
  syncLightObject,
  type LightObjectRecord,
} from "@engine/render-three/lights";
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
  DEFAULT_SCENE_AMBIENT_COLOR,
  DEFAULT_SCENE_AMBIENT_INTENSITY,
  DEFAULT_SCENE_BACKGROUND_COLOR,
  DEFAULT_SCENE_LIGHT_COLOR,
  DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS,
  DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS,
  DEFAULT_SCENE_SUN_ID,
  ensureDefaultSceneLights,
  fitDirectionalShadowToBounds,
  isSceneSunLight,
  readSceneRuntimeStats,
  registerSceneShapeModels,
  resolveSceneWorldSettings,
  resizeSceneRuntimeViewport,
  sceneModelAssetIds,
  SCENE_CAMERA_TARGET,
  startSceneRuntime,
  tagSceneLightRecordIndex,
} from "./SceneRuntimeCore";
import {
  defaultLightIntensity,
  formatLightType,
  uniqueActorName,
} from "@engine/scene/lights";
import {
  formatShapeType,
  isPlayerStartAssetId,
  parseShapeAssetId,
  PLAYER_START_ASSET_ID,
  shapeAssetCollisionDef,
  shapeAssetId,
  type ShapePrimitiveType,
} from "@engine/scene/shapes";
import { createProceduralAssetGltf } from "./shapePrimitives";
import {
  readPivot,
  readRotation,
  readScale,
} from "@engine/scene/transform";
import type {
  LayoutCharacter,
  LayoutInteraction,
  LayoutLightActor,
  LayoutPlacement,
  LayoutPhysics,
  LayoutWorldSettings,
  MetadataValue,
  RoomLayout,
  Vec3,
} from "@engine/scene/layout";
import type { AssetCollisionDef, CollisionPresetId } from "@engine/scene/collision";
import { loadAssetCollision } from "@/scene/assetCollisionLoader";
import {
  lightEntity,
  roomLayoutToSceneDocument,
  type ColliderTransformSource,
} from "@engine/scene/legacyRoomLayoutAdapter";
import type { SceneDocument } from "@engine/scene/sceneDocument";
import type { TransformComponent } from "@engine/scene/components";
import type { MetadataSchema } from "@engine/scene/metadataSchema";
import {
  cloneCharacter,
  cloneLightActor,
  clonePlacement,
  lightActorsEqual,
  transformsEqual,
} from "@editor/core/layoutSnapshots";
import {
  writeRotation,
  writeScale,
} from "@editor/core/layoutTransforms";
import {
  clamp,
  clampIndex,
  round,
  snapStatus,
  snapValue,
} from "@editor/core/numeric";
import { buildEditableSelection, buildSceneObjects } from "@editor/core/sceneObjects";
import type { EditorTool, TransformSpace } from "@editor/core/tools";
import {
  worldSettingsEqual,
  type EditableSceneObject,
  type EditableSelection,
  type EditableTransform,
  type EditorProjectInfo,
  type EditorSnapSettings,
  type EditorWorldSettings,
} from "@editor/core/editableScene";
import type {
  EditorCommand,
  EditorHistoryState,
} from "@editor/core/history";
import {
  descendantSelections,
  groupedSelections,
} from "@editor/core/hierarchy";
import { uniqueEditorId } from "@editor/core/ids";
import {
  cloneSelection,
  parseSelectionId,
  selectionId,
  selectionsEqual,
  type InstanceSelection,
  type LightSelection,
  type Selection,
} from "@editor/core/selection";
import { isPlaneAxis } from "@editor/gizmos/axes";
import { type GizmoHandle } from "@editor/gizmos/handles";
import { buildGizmoHandles, clearGizmoGroup } from "@editor/gizmos/builder";
import {
  axisYMoveDragPosition,
  freeMoveDragPosition,
  localAxisMoveDragPosition,
  planeMoveDragPosition,
  rotateDragRotation,
  scaleDragScale,
  worldAxisMoveDragPosition,
} from "@editor/gizmos/transformDrag";
import {
  calculateGizmoScreenScale,
  createGizmoMovePlane,
  createGizmoPointerDrag,
  gizmoDragBaseWorld,
  GizmoInteractionStore,
  screenSpaceMoveBasis,
  type GizmoPointerDrag,
  type LinkedMoveStart,
} from "@editor/gizmos/interaction";
import { bindEditorInputEvents } from "@editor/input/bindings";
import { EditorCameraController } from "@editor/input/editorCameraController";
import { ScenePicker } from "@editor/render-three/scenePicker";
import { EditorSceneController } from "@editor/scene/EditorSceneController";
import { floorSnapPosition } from "@editor/render-three/floorSnap";
import { computeWallSnap } from "@editor/render-three/wallSnap";
import {
  matrixToTransform,
  pivotCorrectedPosition,
  transformToMatrix,
} from "@editor/render-three/transformMatrices";
import { EditorSelectionOutline } from "./editorSelectionOutline";

export type {
  EditableSceneObject,
  EditableSelection,
  EditableTransform,
  EditorProjectInfo,
  EditorSnapSettings,
  EditorWorldSettings,
} from "@editor/core/editableScene";
export type {
  EditorHistoryState,
} from "@editor/core/history";

export interface EditableTransformSnapshot {
  selection: Selection;
  transform: EditableTransform;
}

/**
 * Default raw-code -> action bindings for the runtime input map. Game-specific
 * config lives in runtime code, not the engine. Observer-only: these share keys
 * with editor camera navigation (WASD) without consuming the events.
 */
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

interface EditorOptions {
  enabled: boolean;
}

export interface LayoutSavePayload {
  layout: RoomLayout;
  editor: {
    gridSize: number;
    gridEnabled: boolean;
    snapRotationDeg: number;
    snapRotationEnabled: boolean;
    snapScale: number;
    snapScaleEnabled: boolean;
  };
}

export interface LayoutSaveResult {
  path?: string;
}

export type LayoutSaver = (payload: LayoutSavePayload) => Promise<LayoutSaveResult>;

export class SceneApp {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  private sun: DirectionalLight | null = null;
  private ambientLight: AmbientLight | null = null;
  private autoSaveTimer = 0;
  private frameHandle = 0;
  private lastTime = 0;
  /**
   * Engine-core spine. Owns the subsystem registry and per-tick fan-out. The
   * SceneApp rAF loop drives `engineApp.update()` each frame (see `start()`);
   * subsystems registered via `registerSubsystem()` attach to the same tick.
   */
  private readonly engineApp = new EngineApp();
  private assetLoader: AssetLoader | null = null;
  private activeProject: ActiveProject | null = null;
  private readonly projectReady: Promise<void>;
  /** Drives Three.js AnimationMixers through the engine-core tick. */
  private readonly animationSubsystem = new AnimationSubsystem();
  /** Raw-code -> named-action map; advanced each tick by the InputSubsystem. */
  private readonly inputActions = new ActionMap(DEFAULT_INPUT_BINDINGS);
  private readonly inputSubsystem = new InputSubsystem(this.inputActions);
  private readonly physicsSubsystem = new PhysicsSubsystem({ backend: "rapier" });
  private readonly audioSubsystem = new AudioSubsystem({ backend: "web-audio" });
  /** Browser keyboard -> action map bridge (observer only, both modes). */
  private readonly keyboardInput = new KeyboardInputSource(this.inputActions);
  /** Ticks scene behaviors against the derived entity set (assigned in ctor). */
  private readonly behaviorSubsystem: BehaviorSubsystem;
  /**
   * BehaviorSubsystem transform sink: writes a behavior-mutated entity transform
   * back onto its rendered object. This slice targets characters (each is its
   * own Object3D); instanced static meshes and lights are not synced yet. Bound
   * arrow so it can be passed as a callback.
   */
  private readonly syncEntityTransform = (entityId: string, transform: TransformComponent): void => {
    const selection = parseSelectionId(entityId);
    if (!selection || selection.kind !== "character") return;
    const object = this.characterObjects[selection.index];
    if (!object) return;
    object.position.set(transform.position[0], transform.position[1], transform.position[2]);
    applyEulerDegrees(object, transform.rotation);
    object.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
    this.physicsSubsystem.setEntityTransform(entityId, transform);
  };
  private readonly canvas: HTMLCanvasElement;
  private readonly editorEnabled: boolean;
  /** Scratch raycaster + floor plane for the selection-aware orbit target. */
  private readonly raycaster = new Raycaster();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  /** Editor viewport camera (fly / orbit / pan / dolly). Editor-only. */
  private readonly cameraController: EditorCameraController;
  /** Editor viewport raycasting (selection / gizmo / surface picks). */
  private readonly picker: ScenePicker;

  private manifest: AssetManifest | null = null;
  private metadataSchema: MetadataSchema | null = null;
  private layout: RoomLayout | null = null;
  private models = new Map<string, GLTF>();
  private instanceGroups = new Map<string, Group>();
  private instanceMeshes = new Map<string, InstancedMesh[]>();
  private characterObjects: Object3D[] = [];
  private lightObjects: LightObjectRecord[] = [];
  private localBounds = new Map<string, Box3>();
  /** Authored asset collision definitions (sidecars) for assets that have primitives. */
  private collisionDefs = new Map<string, AssetCollisionDef>();
  private assetPlacements = new Map<string, EditableAsset["placement"]>();
  /** Active selection, delegating to the store so ownership lives there. */
  private get selection(): Selection | null {
    return this.editorSceneController.selection;
  }
  private set selection(value: Selection | null) {
    this.editorSceneController.selection = value;
  }
  private selectionOutline: EditorSelectionOutline | null = null;
  private readonly lightOutlineGeometry = new SphereGeometry(0.35, 16, 8);
  /** "Show > Collision" overlay: wireframe boxes of every collider, off by default. */
  private readonly collisionBoxes: LineSegments[] = [];
  private showCollision = false;
  private readonly gizmoGroup = new Group();
  private readonly gizmoPickables: Object3D[] = [];
  /** Owns active/hovered gizmo handle state (editor-only interaction state). */
  private readonly gizmoInteraction = new GizmoInteractionStore();
  /** When on, the move gizmo drags the selection's pivot instead of the object. */
  private pivotEditMode = false;
  private activeTool: EditorTool = "move";
  private transformSpace: TransformSpace = "world";
  private snapSettings = {
    move: 1,
    rotate: 15,
    scale: 0.1,
    moveEnabled: true,
    rotateEnabled: true,
    scaleEnabled: true,
  };
  /** Live drag-and-drop placement ghost (a translucent clone of the dragged
   *  asset shown in the viewport before the drop commits). */
  private dragPreview: {
    kind: "asset" | "light";
    key: string;
    group: Object3D;
    dispose: () => void;
  } | null = null;
  /** Asset/light key currently being dragged from the UI. */
  private dragPreviewAssetId: string | null = null;
  /** Last viewport client coords seen during a drag (so a lazily-loaded ghost
   *  can snap to the cursor as soon as its model finishes loading). */
  private dragPreviewClient: { x: number; y: number } | null = null;
  private pointerDrag: GizmoPointerDrag | null = null;
  private readonly editorSceneController: EditorSceneController;
  private unbindEditorInput: (() => void) | null = null;
  private layoutSaver: LayoutSaver | null = null;

  /** Called every frame with the smoothed delta; used by the debug overlay. */
  onFrame: ((deltaMs: number) => void) | null = null;
  onSelectionChanged: ((selection: EditableSelection | null) => void) | null = null;
  onSceneObjectsChanged: ((objects: EditableSceneObject[]) => void) | null = null;
  onHistoryChanged: ((state: EditorHistoryState) => void) | null = null;
  onWorldSettingsChanged: ((settings: EditorWorldSettings) => void) | null = null;
  onPivotEditModeChanged: ((enabled: boolean) => void) | null = null;
  onStatus: ((message: string, tone?: "info" | "success" | "warning" | "error") => void) | null =
    null;

  constructor(canvas: HTMLCanvasElement, options: EditorOptions = { enabled: false }) {
    this.canvas = canvas;
    this.editorEnabled = options.enabled;

    const runtimeCore = createSceneRuntimeCore(canvas, {
      backgroundColor: DEFAULT_SCENE_BACKGROUND_COLOR,
    });
    this.renderer = runtimeCore.renderer;
    this.scene = runtimeCore.scene;
    this.camera = runtimeCore.camera;
    this.editorSceneController = new EditorSceneController({
      applyCastShadow: (selection) => this.applyCastShadow(selection),
      applyGroupId: (selection, groupId, options) =>
        this.applyGroupId(selection, groupId, options),
      applyVisibility: (selection) => this.applyVisibility(selection),
      descendantsOf: (selection) => this.descendantsOf(selection),
      emitHistoryChanged: () => this.emitHistoryChanged(),
      emitSelectionChanged: () => this.emitSelectionChanged(),
      getAllSelections: (options) => this.getAllSelections(options),
      getGroupedSelections: (selection) => this.getGroupedSelections(selection),
      getMutableLayout: () => this.layout,
      getMutableTransform: (selection) => this.getMutableTransform(selection),
      getSelectionLabel: (selection) => this.getSelectionLabel(selection),
      hasSelection: (selection) => this.hasSelection(selection),
      createLightId: (type) => this.createLightId(type),
      insertCharacterPlacement: (index, placement) => this.insertCharacterPlacement(index, placement),
      insertInstancePlacement: (assetId, placementIndex, placement) =>
        this.insertInstancePlacement(assetId, placementIndex, placement),
      insertLightActor: (index, actor) => this.insertLightActor(index, actor),
      onStatus: (message, tone) => this.onStatus?.(message, tone),
      removeCharacterPlacement: (index) => this.removeCharacterPlacement(index),
      removeInstancePlacement: (assetId, placementIndex) =>
        this.removeInstancePlacement(assetId, placementIndex),
      removeLightActor: (index) => this.removeLightActor(index),
      updateGizmo: () => this.updateGizmo(),
      updateSelectionBox: () => this.updateSelectionBox(),
    });
    this.cameraController = new EditorCameraController({
      camera: this.camera,
      canvas: this.canvas,
      getOrbitTarget: () => this.getCameraOrbitTarget(),
      onInteractionStart: () => {
        this.pointerDrag = null;
        this.endAssetDragPreview();
      },
      onStatus: (message, tone) => this.onStatus?.(message, tone),
    });
    this.picker = new ScenePicker({
      camera: this.camera,
      canvas: this.canvas,
      pickables: () => {
        const objects: Object3D[] = [];
        for (const meshes of this.instanceMeshes.values()) objects.push(...meshes);
        objects.push(...this.characterObjects);
        for (const record of this.lightObjects) objects.push(record.root);
        return objects;
      },
      surfacePickables: () => {
        const objects: Object3D[] = [];
        for (const meshes of this.instanceMeshes.values()) objects.push(...meshes);
        objects.push(...this.characterObjects);
        return objects;
      },
      gizmo: () => ({ visible: this.gizmoGroup.visible, pickables: this.gizmoPickables }),
    });

    if (this.editorEnabled) {
      this.selectionOutline = new EditorSelectionOutline({
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    this.gizmoGroup.name = "editor-transform-gizmo";
    this.gizmoGroup.visible = false;
    this.scene.add(this.gizmoGroup);

    // Register subsystems before scene load adds work to them (e.g. character
    // animations push mixers during loadActiveProjectScene) and before the
    // engine init()/start() that load triggers. Input advances before any later
    // behavior subsystem so behaviors read current-tick action state.
    this.engineApp.registerSubsystem(this.animationSubsystem);
    this.engineApp.registerSubsystem(this.inputSubsystem);
    this.engineApp.registerSubsystem(this.physicsSubsystem);
    // Registered after input so behaviors read current-tick action state.
    this.behaviorSubsystem = new BehaviorSubsystem(
      createBehaviorRegistry(),
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
      this.audioSubsystem,
    );
    this.engineApp.registerSubsystem(this.behaviorSubsystem);
    this.engineApp.registerSubsystem(this.audioSubsystem);

    // The editor viewport is an authoring surface, not Play mode: keep gameplay
    // behaviors and dynamic rigid bodies from mutating placed objects while editing.
    if (this.editorEnabled) {
      this.behaviorSubsystem.setEnabled(false);
      this.physicsSubsystem.setEnabled(false);
    }

    // Observer-only keyboard source: records raw codes into the action map in
    // both modes without consuming events, so editor shortcuts/camera nav are
    // untouched.
    this.keyboardInput.attach();

    this.projectReady = this.loadActiveProjectScene();

    if (this.editorEnabled) this.bindEditorInput();

    this.handleResize();
    window.addEventListener("resize", this.handleResize);
  }

  start(): void {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      const deltaMs = Math.min(now - this.lastTime, 100);
      this.lastTime = now;
      const deltaSeconds = deltaMs / 1000;

      // Engine-core tick: fans out to registered subsystems. The
      // AnimationSubsystem advances character mixers here — that work no longer
      // runs inline in this loop. Camera/gizmo work stays inline for now.
      this.engineApp.update(deltaSeconds);

      this.cameraController.update(deltaSeconds);
      this.updateGizmoScreenScale();

      if (this.selectionOutline) this.selectionOutline.render(deltaSeconds);
      else this.renderer.render(this.scene, this.camera);
      this.onFrame?.(deltaMs);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  /**
   * Registers a subsystem on the engine-core spine so it ticks with the rAF
   * loop. Thin pass-through to {@link EngineApp.registerSubsystem}; returns the
   * subsystem for convenient capture at the call site.
   */
  registerSubsystem(subsystem: Subsystem): Subsystem {
    return this.engineApp.registerSubsystem(subsystem);
  }

  setLayoutSaver(saver: LayoutSaver): void {
    this.layoutSaver = saver;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    this.unbindEditorInput?.();
    this.unbindEditorInput = null;
    this.keyboardInput.detach();
    this.selectionOutline?.dispose();
    this.selectionOutline = null;
    this.lightOutlineGeometry.dispose();
    // EngineApp.dispose() is async (subsystems may release async resources);
    // SceneApp.dispose() is sync, so fire-and-forget like the renderer teardown.
    void this.engineApp.dispose();
    this.renderer.dispose();
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return readSceneRuntimeStats(this.renderer);
  }

  async getManifest(): Promise<AssetManifest> {
    await this.projectReady;
    if (!this.assetLoader) throw new Error("Project is not loaded yet.");
    this.manifest ??= await this.assetLoader.loadManifest();
    return this.manifest;
  }

  async getEditableAssets(): Promise<EditableAsset[]> {
    await this.projectReady;
    if (!this.assetLoader) throw new Error("Project is not loaded yet.");
    return this.assetLoader.loadEditableAssets();
  }

  async getEditorProjectInfo(): Promise<EditorProjectInfo> {
    await this.projectReady;
    if (!this.activeProject) throw new Error("Project is not loaded yet.");
    return {
      manifest: this.activeProject.manifest,
      rootName: this.activeProject.rootName,
      assetRoot: dirnameProjectPath(this.activeProject.manifest.editor.assetManifest),
    };
  }

  getLayout(): RoomLayout {
    if (!this.layout) throw new Error("Layout is not loaded yet.");
    return structuredClone(this.layout);
  }

  /**
   * Derives the engine `SceneDocument` from the currently loaded layout via the
   * legacy adapter. Inspection-only: this does NOT drive rendering yet. The
   * runtime and editor still render from the existing `RoomLayout` path, so the
   * derived spine can be observed without changing visible behavior.
   */
  getSceneDocument(): SceneDocument {
    if (!this.layout) throw new Error("Layout is not loaded yet.");
    return roomLayoutToSceneDocument(this.layout, {
      colliderBox: (assetId, source) => this.colliderBoxFor(assetId, source),
      collisionDefs: this.collisionDefs,
    });
  }

  /**
   * World-aligned collider footprint for a placed asset, from its loaded model
   * bounds, so derived colliders match the rendered mesh instead of a unit cube.
   * Returns undefined when the model's bounds are not loaded (adapter falls back
   * to a scaled unit box).
   */
  private colliderBoxFor(assetId: string, source: ColliderTransformSource) {
    const bounds = this.localBounds.get(assetId);
    return bounds ? colliderBoxFromBounds(bounds, source) : undefined;
  }

  getSceneObjects(): EditableSceneObject[] {
    if (!this.layout) return [];
    return buildSceneObjects(this.layout, {
      assetCategory: (assetId) => this.assetCategory(assetId),
      isSelected: (selection) => this.isSelectionSelected(selection),
      staticObjectsCastShadow: this.staticObjectsCastShadow(),
    });
  }

  selectSceneObject(id: string, options: { additive?: boolean } = {}): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (options.additive) this.toggleSelection(selection);
    else this.select(selection);
  }

  clearSelection(): void {
    this.select(null);
  }

  selectAllObjects(): void {
    const selections = this.getAllSelections({ includeHidden: false });
    if (selections.length === 0) {
      this.onStatus?.("No visible objects to select.", "warning");
      return;
    }
    const active =
      this.selection && selections.some((selection) => selectionsEqual(selection, this.selection))
        ? cloneSelection(this.selection)
        : cloneSelection(selections[0]!);
    this.selectMany(selections, active);
    this.onStatus?.(`Selected ${selections.length} objects.`, "info");
  }

  renameSceneObject(id: string, name: string): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    this.renameSelection(selection, name);
  }

  setSceneObjectHidden(id: string, hidden: boolean): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (this.editorSceneController.selectedCount > 1 && this.isSelectionSelected(selection)) {
      this.setSelectedHidden(hidden);
      return;
    }
    this.editorSceneController.setSelectionFlag(selection, "hidden", hidden);
  }

  setSceneObjectLocked(id: string, locked: boolean): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (this.editorSceneController.selectedCount > 1 && this.isSelectionSelected(selection)) {
      this.setSelectedLocked(locked);
      return;
    }
    this.editorSceneController.setSelectionFlag(selection, "locked", locked);
  }

  getHistoryState(): EditorHistoryState {
    return this.editorSceneController.getHistoryState();
  }

  undo(): void {
    this.editorSceneController.undo();
  }

  redo(): void {
    this.editorSceneController.redo();
  }

  setEditorTool(tool: EditorTool): void {
    this.activeTool = tool;
    this.endAssetDragPreview();
    // Switching transform tool leaves pivot-edit mode so tools behave normally.
    if (this.pivotEditMode) this.setPivotEditMode(false);
    this.updateGizmo();
    this.onStatus?.(`Tool: ${tool}`);
  }

  getTransformSpace(): TransformSpace {
    return this.transformSpace;
  }

  toggleTransformSpace(): TransformSpace {
    this.transformSpace = this.transformSpace === "world" ? "local" : "world";
    this.updateGizmo();
    this.onStatus?.(`Transform space: ${this.transformSpace}`, "info");
    return this.transformSpace;
  }

  isCameraNavigating(): boolean {
    return this.cameraController.isInteracting;
  }

  setSnapSettings(values: Partial<typeof this.snapSettings>): void {
    this.snapSettings = { ...this.snapSettings, ...values };
    this.onStatus?.(
      `Snap move ${snapStatus(this.snapSettings.moveEnabled, this.snapSettings.move)}, rotate ${snapStatus(this.snapSettings.rotateEnabled, this.snapSettings.rotate)}, scale ${snapStatus(this.snapSettings.scaleEnabled, this.snapSettings.scale)}`,
    );
  }

  getSnapSettings(): EditorSnapSettings {
    return { ...this.snapSettings };
  }

  getWorldSettings(): EditorWorldSettings {
    return {
      lightingMode: "Dynamic",
      shadowFilter: "PCF Soft",
      staticObjectsCastShadow: this.staticObjectsCastShadow(),
      staticObjectsReceiveShadow: this.staticObjectsReceiveShadow(),
      backgroundColor: this.backgroundColor(),
      ambientColor: this.ambientColor(),
      ambientIntensity: this.ambientIntensity(),
      gameMode: this.gameMode(),
    };
  }

  setWorldSettings(
    values: Partial<
      Pick<
        EditorWorldSettings,
        | "staticObjectsCastShadow"
        | "staticObjectsReceiveShadow"
        | "backgroundColor"
        | "ambientColor"
        | "ambientIntensity"
        | "gameMode"
      >
    >,
  ): void {
    if (!this.layout) return;
    const previous = this.getWorldSettings();
    const next: EditorWorldSettings = { ...previous, ...values };
    if (worldSettingsEqual(previous, next)) return;

    this.executeCommand({
      label: "Update world settings",
      redo: () => this.applyWorldSettings(next),
      undo: () => this.applyWorldSettings(previous),
    });
  }

  setSelectedLightSettings(values: Partial<LayoutLightActor>): void {
    if (!this.layout || !this.selection || this.selection.kind !== "light") return;
    const light = this.layout.lights?.[this.selection.index];
    if (!light) return;
    const previous = cloneLightActor(light);
    const next = { ...previous, ...values };
    if (lightActorsEqual(previous, next)) return;
    const selection = cloneSelection(this.selection) as LightSelection;

    this.executeCommand({
      label: "Update light",
      redo: () => this.applyLightActor(selection, next),
      undo: () => this.applyLightActor(selection, previous),
    });
  }

  focusSelected(): void {
    const selected = this.getSelected();
    if (!selected || !this.selection) {
      this.onStatus?.("No selected object to focus.", "warning");
      return;
    }

    const box = this.getSelectionWorldBox(this.selection);
    const target = box && !box.isEmpty()
      ? box.getCenter(new Vector3())
      : new Vector3(selected.position[0], selected.position[1] + 0.65, selected.position[2]);

    const viewDirection = new Vector3();
    this.camera.getWorldDirection(viewDirection);
    if (viewDirection.lengthSq() === 0) {
      viewDirection.copy(SCENE_CAMERA_TARGET).sub(this.camera.position).normalize();
    }

    const radius = box && !box.isEmpty() ? box.getSize(new Vector3()).length() * 0.5 : 0.8;
    const distance = clamp(radius * 1.8, 1.25, 4.2);
    this.camera.position.copy(target).addScaledVector(viewDirection, -distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.cameraController.markViewChanged();
    this.cameraController.syncAnglesFromCurrentView();
    this.onStatus?.(`Focused ${selected.label}.`, "info");
  }

  /**
   * Current viewport camera pose, for the Play button to hand off to the runtime
   * so the default camera mode starts where the editor was looking. Editor-only
   * handoff — never written into the layout.
   */
  getPlayCameraPose(): PlayCameraPose {
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      quaternion: [
        this.camera.quaternion.x,
        this.camera.quaternion.y,
        this.camera.quaternion.z,
        this.camera.quaternion.w,
      ],
    };
  }

  setTechnicalView(view: "top" | "front" | "side"): void {
    const target = this.getCameraOrbitTarget();
    const distance = clamp(this.camera.position.distanceTo(target), 3, 10);
    this.cameraController.markViewChanged();

    if (view === "top") {
      this.camera.up.set(0, 0, -1);
      this.camera.position.copy(target).add(new Vector3(0, distance, 0));
    } else if (view === "front") {
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(target).add(new Vector3(0, 0, distance));
    } else {
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(target).add(new Vector3(distance, 0, 0));
    }

    this.camera.lookAt(target);
    this.cameraController.syncAnglesFromCurrentView();
    this.onStatus?.(`${view[0]!.toUpperCase()}${view.slice(1)} view`, "info");
  }

  surfaceSnapSelected(): void {
    if (!this.selection) {
      this.onStatus?.("No selected object to snap.", "warning");
      return;
    }
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    const before = this.captureTransform(this.selection);
    const box = this.getSelectionWorldBox(this.selection);
    if (!before || !box || box.isEmpty()) {
      this.onStatus?.("Cannot compute bounds for surface snap.", "warning");
      return;
    }

    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    // Start a hair above the bottom so a surface flush with it still registers.
    const origin = new Vector3(centerX, box.min.y + 0.02, centerZ);
    const surfaceY = this.picker.raycastSurfaceBelow(origin, this.selection);
    // Fall back to the floor plane (y = 0) when nothing solid is underneath.
    const restY = surfaceY ?? 0;
    const deltaY = restY - box.min.y;
    if (Math.abs(deltaY) < 1e-3) {
      this.onStatus?.("Already resting on a surface.", "info");
      return;
    }

    this.updateSelectedTransform({
      position: [
        before.position[0],
        round(before.position[1] + deltaY),
        before.position[2],
      ],
    });
    this.commitTransformChange(
      this.selection,
      before,
      surfaceY === null ? "Surface snap (floor)" : "Surface snap",
    );
  }

  snapSelectedToFloor(): void {
    if (!this.selection) {
      this.onStatus?.("No selected object to snap.", "warning");
      return;
    }
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    const before = this.captureTransform(this.selection);
    const box = this.getSelectionWorldBox(this.selection);
    if (!before || !box || box.isEmpty()) {
      this.onStatus?.("Cannot compute bounds for floor snap.", "warning");
      return;
    }

    const position = floorSnapPosition(box, before.position);
    if (!position) {
      this.onStatus?.("Already resting on the floor.", "info");
      return;
    }

    this.updateSelectedTransform({ position });
    this.commitTransformChange(this.selection, before, "Snap to floor");
  }

  /** End entry: drops the active selection onto the floor plane. */
  snapSelected(): void {
    this.snapSelectedToFloor();
  }

  isSelectionWallAsset(): boolean {
    return Boolean(
      this.selection &&
        this.selection.kind === "instance" &&
        this.isWallAsset(this.selection.assetId),
    );
  }

  /**
   * Details "Snap to Wall": forces a wall snap on the active instance regardless
   * of its catalog surface type. Characters and empty selections are no-ops.
   */
  snapSelectedToWall(): void {
    if (!this.selection || this.selection.kind !== "instance") {
      this.onStatus?.("Select a model to snap to a wall.", "warning");
      return;
    }
    this.performWallSnap(this.selection);
  }

  /** Slides and orients an instance flush against the nearest room wall. */
  private performWallSnap(selection: InstanceSelection): void {
    if (this.isSelectionLocked(selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    const before = this.captureTransform(selection);
    if (!before) return;
    const bounds = this.localBounds.get(selection.assetId);
    const room = this.getRoomBounds();
    if (!bounds || !room) {
      this.onStatus?.("No room walls found to snap to.", "warning");
      return;
    }
    const snap = computeWallSnap(bounds, room, before.position, before.rotation[1], before.scale);

    this.updateSelectedTransform({
      position: snap.position,
      rotation: [before.rotation[0], snap.rotationYDeg, before.rotation[2]],
    });
    this.commitTransformChange(selection, before, "Wall snap");
  }

  /** Fits the sun's shadow frustum to the room AABB so shadows stay crisp. */
  private fitSunShadowToScene(): void {
    fitDirectionalShadowToBounds(this.sun, this.getRoomBounds());
  }

  private getRoomBounds(): Box3 | null {
    return computeSceneRoomBounds(this.layout, this.localBounds, {
      includeAsset: (assetId) => this.isRoomAsset(assetId),
    });
  }

  private isWallAsset(assetId: string): boolean {
    const placement = this.assetPlacements.get(assetId);
    return Boolean(placement && (placement.surface === "wall" || placement.snapToWall));
  }

  private isRoomAsset(assetId: string): boolean {
    return this.assetPlacements.get(assetId)?.surface === "room";
  }

  /**
   * Begin a drag-and-drop placement: builds a translucent ghost of the dragged
   * asset so the viewport shows where it will land before the drop. The Content
   * Browser lists every manifest asset but only loadGroups are loaded up front,
   * so a ghost for an unloaded asset is built once its model lazy-loads.
   * Characters are skinned meshes and skip the ghost (they still drop fine).
   */
  beginAssetDragPreview(assetId: string): void {
    this.endAssetDragPreview();
    this.dragPreviewAssetId = assetId;
    this.dragPreviewClient = null;
    this.ensureShapeModel(assetId);

    const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
    if (asset?.category === "customer-character") return;

    if (this.models.has(assetId)) {
      this.createDragPreview(assetId);
      return;
    }
    void this.ensureAssetLoaded(assetId).then((ok) => {
      // Bail if the drag was cancelled or moved on while we were loading.
      if (!ok || this.dragPreviewAssetId !== assetId || this.dragPreview) return;
      this.createDragPreview(assetId);
      if (this.dragPreviewClient) {
        this.updateAssetDragPreview(this.dragPreviewClient.x, this.dragPreviewClient.y);
      }
    });
  }

  beginLightDragPreview(type: LayoutLightActor["type"]): void {
    this.endAssetDragPreview();
    const key = `light:${type}`;
    this.dragPreviewAssetId = key;
    this.dragPreviewClient = null;
    const actor = this.createDefaultLightActor(type);
    actor.position = [0, 0, 0];
    const record = buildSceneLightObject(actor, -1);
    record.light.visible = false;
    const wire = record.gizmo.getObjectByName("light-wire");
    if (wire) wire.visible = true;
    record.root.visible = false;
    this.dragPreview = {
      kind: "light",
      key,
      group: record.root,
      dispose: () => disposeLightGizmo(record.gizmo),
    };
    this.scene.add(record.root);
  }

  private createDragPreview(assetId: string): void {
    const gltf = this.models.get(assetId);
    if (!gltf) return;
    // clone(true) shares geometries with the source gltf (Mesh.clone keeps the
    // geometry/material by reference), so only the override material we add here
    // needs disposing on cleanup — never the shared geometries.
    const group = gltf.scene.clone(true);
    const material = new MeshStandardMaterial({
      color: 0xf59e2c,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      roughness: 0.6,
      metalness: 0,
    });
    group.traverse((object) => {
      if (object instanceof Mesh) {
        object.material = material;
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    group.visible = false;
    this.dragPreview = {
      kind: "asset",
      key: assetId,
      group,
      dispose: () => material.dispose(),
    };
    this.scene.add(group);
  }

  /** Position the drag ghost under the cursor (snapped/wall-mounted exactly as
   *  the drop will land). No-op for assets without a ghost (e.g. characters). */
  updateAssetDragPreview(clientX: number, clientY: number): void {
    this.dragPreviewClient = { x: clientX, y: clientY };
    const preview = this.dragPreview;
    if (!preview) return;
    if (preview.kind === "light") {
      const position = this.computeLightDropPosition(clientX, clientY);
      if (!position) {
        preview.group.visible = false;
        return;
      }
      preview.group.position.set(...position);
      preview.group.visible = true;
      return;
    }
    const transform = this.computeInstanceDropTransform(preview.key, clientX, clientY);
    if (!transform) {
      preview.group.visible = false;
      return;
    }
    preview.group.position.set(...transform.position);
    applyEulerDegrees(preview.group, [0, transform.rotationYDeg, 0]);
    preview.group.visible = true;
  }

  /** Hide the drag ghost while the cursor is off the viewport (kept alive so it
   *  reappears if the cursor returns before the drop). */
  hideAssetDragPreview(): void {
    if (this.dragPreview) this.dragPreview.group.visible = false;
  }

  /** Tear down the drag ghost (drop committed, drag cancelled, or interrupted). */
  endAssetDragPreview(): void {
    this.dragPreviewAssetId = null;
    this.dragPreviewClient = null;
    const preview = this.dragPreview;
    if (!preview) return;
    this.dragPreview = null;
    this.scene.remove(preview.group);
    preview.dispose();
  }

  /**
   * Ensure a single model is loaded and integrated (materials + local bounds)
   * exactly as the bulk loadGroups path does, so on-demand placement of assets
   * outside the layout's loadGroups behaves identically.
   */
  private async ensureAssetLoaded(assetId: string): Promise<boolean> {
    if (this.models.has(assetId)) return true;
    if (!this.assetLoader) return false;
    try {
      const gltf = await this.assetLoader.loadModel(assetId);
      this.models.set(assetId, gltf);
      const single = new Map<string, GLTF>([[assetId, gltf]]);
      convertUnlitModelMaterialsToLit(single);
      for (const [id, box] of computeModelLocalBounds(single)) {
        this.localBounds.set(id, box);
      }
      return true;
    } catch (error) {
      this.onStatus?.(
        `Asset failed to load: ${assetId} (${error instanceof Error ? error.message : String(error)})`,
        "warning",
      );
      return false;
    }
  }

  private async loadMissingSceneModels(): Promise<void> {
    if (!this.assetLoader) return;
    const missing = sceneModelAssetIds(this.layout).filter((assetId) => !this.models.has(assetId));
    if (missing.length === 0) return;
    const models = await this.assetLoader.loadModels(missing);
    for (const [assetId, model] of models) this.models.set(assetId, model);
  }

  getSelected(): EditableSelection | null {
    if (!this.layout || !this.selection) return null;
    return buildEditableSelection(this.layout, this.selection, {
      assetCategory: (assetId) => this.assetCategory(assetId),
      staticObjectsCastShadow: this.staticObjectsCastShadow(),
    });
  }

  /** Resolves an asset's manifest category for Details display. */
  private assetCategory(assetId: string): string {
    return this.manifest?.assets.find((entry) => entry.id === assetId)?.category ?? "";
  }

  captureSelectedTransform(): EditableTransform | null {
    if (!this.selection) return null;
    return this.captureTransform(this.selection);
  }

  captureSelectedTransforms(): EditableTransformSnapshot[] {
    return this.getSelectedSelections().flatMap((selection) => {
      const transform = this.captureTransform(selection);
      return transform ? [{ selection: cloneSelection(selection), transform }] : [];
    });
  }

  commitSelectedTransform(before: EditableTransform | null, label = "Transform"): void {
    if (!before || !this.selection) return;
    this.commitTransformChange(this.selection, before, label);
  }

  commitSelectedTransforms(before: EditableTransformSnapshot[], label = "Transform"): void {
    if (before.length === 0) return;
    const entries = before.map((entry) => ({
      selection: cloneSelection(entry.selection),
      before: entry.transform,
      after: this.captureTransform(entry.selection),
    }));

    const changes: Array<{
      selection: Selection;
      before: EditableTransform;
      after: EditableTransform;
    }> = [];
    for (const entry of entries) {
      if (!entry.after || transformsEqual(entry.before, entry.after)) continue;
      changes.push({
        selection: entry.selection,
        before: entry.before,
        after: entry.after,
      });
    }
    if (changes.length === 0) return;

    const selections = changes.map((entry) => cloneSelection(entry.selection));
    const active =
      this.selection && selections.some((selection) => selectionsEqual(selection, this.selection))
        ? cloneSelection(this.selection)
        : cloneSelection(selections[0]!);

    this.executeCommand({
      label: changes.length === 1 ? label : `${label} ${changes.length} objects`,
      redo: () => {
        this.selectMany(selections, active);
        for (const change of changes) this.applyTransform(change.selection, change.after);
      },
      undo: () => {
        this.selectMany(selections, active);
        for (const change of changes) this.applyTransform(change.selection, change.before);
      },
    });
  }

  updateSelectedTransform(values: {
    position?: Vec3;
    rotation?: Vec3;
    scale?: Vec3;
  }, options: { notifySelection?: boolean } = {}): void {
    if (!this.layout || !this.selection) return;
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }
    const transform = this.getMutableTransform(this.selection);
    if (!transform) return;

    if (values.position) transform.position = values.position;
    if (values.rotation) writeRotation(transform, values.rotation);
    if (values.scale) writeScale(transform, values.scale);

    this.refreshSelectionObject(this.selection);
    this.updateSelectionBox();
    this.updateGizmo();
    if (options.notifySelection !== false) this.emitSelectionChanged();
  }

  updateSelectedTransforms(values: {
    position?: Vec3;
    rotation?: Vec3;
    scale?: Vec3;
  }, options: { notifySelection?: boolean } = {}): void {
    if (!this.layout || !this.selection) return;

    const selections = this.getSelectedSelections();
    const editableSelections = selections.filter((selection) => !this.isSelectionLocked(selection));
    if (editableSelections.length === 0) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    for (const selection of editableSelections) {
      const transform = this.getMutableTransform(selection);
      if (!transform) continue;
      if (values.position) transform.position = [...values.position];
      if (values.rotation) writeRotation(transform, values.rotation);
      if (values.scale) writeScale(transform, values.scale);
      this.refreshSelectionObject(selection);
    }

    this.updateSelectionBox();
    this.updateGizmo();
    if (options.notifySelection !== false) this.emitSelectionChanged();
  }

  deleteSelected(): void {
    this.editorSceneController.deleteSelected();
  }

  duplicateSelected(): void {
    this.editorSceneController.duplicateSelected();
  }

  hideSelected(): void {
    this.editorSceneController.hideSelected();
  }

  setSelectedHidden(hidden: boolean): void {
    this.editorSceneController.setSelectedHidden(hidden);
  }

  setSelectedLocked(locked: boolean): void {
    this.editorSceneController.setSelectedLocked(locked);
  }

  groupSelected(): void {
    this.editorSceneController.groupSelected();
  }

  /** Clears the group id from every member of any group in the current selection. */
  ungroupSelected(): void {
    this.editorSceneController.ungroupSelected();
  }

  /** Parents the other selected objects to the active selection (the parent). */
  parentSelectionToActive(): void {
    this.editorSceneController.parentSelectionToActive();
  }

  /**
   * Parents one or more objects (by scene-object id) to a target object.
   * Used by outliner drag-and-drop: drag child rows onto a parent row.
   * Cycle-safe (a target that is a descendant of a dragged object is skipped).
   */
  parentObjectsTo(childIds: string[], parentId: string): void {
    this.editorSceneController.parentObjectsTo(childIds, parentId);
  }

  /** Clears the parent of every selected object. */
  unparentSelected(): void {
    this.editorSceneController.unparentSelected();
  }

  /**
   * Sets the active selection's local authoring pivot (the point rotation/scale
   * gizmos act around). Does not move the object — only where the gizmo sits.
   */
  setSelectionPivot(pivot: Vec3): void {
    if (!this.selection || this.selection.kind === "light") {
      this.onStatus?.("This selection has no pivot.", "warning");
      return;
    }
    const selection = cloneSelection(this.selection);
    const target = this.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!target) return;
    const before = readPivot(target);
    const next: Vec3 = [round(pivot[0]), round(pivot[1]), round(pivot[2])];
    this.commitPivotChange(selection, before, next);
  }

  /** Writes a pivot value live (no command); deletes the field when at origin. */
  private applyPivotValue(selection: Selection, value: Vec3): void {
    const mut = this.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!mut) return;
    if (value[0] === 0 && value[1] === 0 && value[2] === 0) delete mut.pivot;
    else mut.pivot = [...value];
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  /** Pushes an undoable pivot change from `before` to `after` (no-op when equal). */
  private commitPivotChange(selection: Selection, before: Vec3, after: Vec3): void {
    if (before[0] === after[0] && before[1] === after[1] && before[2] === after[2]) return;
    const sel = cloneSelection(selection);
    this.executeCommand({
      label: "Edit pivot",
      redo: () => {
        this.select(sel);
        this.applyPivotValue(sel, after);
      },
      undo: () => {
        this.select(sel);
        this.applyPivotValue(sel, before);
      },
    });
  }

  isPivotEditMode(): boolean {
    return this.pivotEditMode;
  }

  togglePivotEditMode(): void {
    this.setPivotEditMode(!this.pivotEditMode);
  }

  /** Enters/leaves pivot-edit mode: the move gizmo then drags the pivot point. */
  setPivotEditMode(enabled: boolean): void {
    if (this.pivotEditMode === enabled) return;
    this.pivotEditMode = enabled;
    this.updateGizmo();
    this.onPivotEditModeChanged?.(enabled);
    this.onStatus?.(
      enabled ? "Pivot edit: drag the move gizmo to set the pivot." : "Pivot edit off.",
      "info",
    );
  }

  /** Quick pivot presets derived from the model's local bounds. */
  applySelectionPivotPreset(preset: "reset" | "center" | "base"): void {
    if (!this.selection) return;
    if (preset === "reset") {
      this.setSelectionPivot([0, 0, 0]);
      return;
    }
    const bounds = this.getLocalBounds(this.selection);
    if (!bounds) {
      this.onStatus?.("No local bounds available for this pivot preset.", "warning");
      return;
    }
    const center = bounds.getCenter(new Vector3());
    if (preset === "center") {
      this.setSelectionPivot([center.x, center.y, center.z]);
    } else {
      // base: bottom-centre — natural hinge for objects resting on the floor.
      this.setSelectionPivot([center.x, bounds.min.y, center.z]);
    }
  }

  showHiddenObjects(): void {
    this.editorSceneController.showHiddenObjects();
  }

  addLightActor(type: LayoutLightActor["type"]): void {
    if (!this.layout) return;
    const index = this.layout.lights?.length ?? 0;
    const actor = this.createDefaultLightActor(type);
    const selection: Selection = { kind: "light", index };

    this.executeCommand({
      label: `Add ${formatLightType(type)}`,
      redo: () => {
        this.insertLightActor(index, actor);
        this.select(selection);
      },
      undo: () => {
        this.removeLightActor(index);
        this.select(null);
      },
    });
  }

  /**
   * Spawn a built-in primitive (cube/sphere/…) in front of the camera. Shapes
   * are model instances under a synthetic `shape:<type>` asset, so they reuse
   * the instance transform/selection/save pipeline; only the procedural model
   * needs registering on first use.
   */
  addShapeActor(type: ShapePrimitiveType): void {
    if (!this.layout) return;
    const assetId = shapeAssetId(type);
    this.ensureShapeModel(assetId);

    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    const placementIndex = instance?.placements.length ?? 0;
    const placement: LayoutPlacement = {
      name: this.uniqueInstanceName(formatShapeType(type)),
      position: this.defaultActorPosition(3),
      scale: 1,
    };
    const selection: Selection = { kind: "instance", assetId, placementIndex };

    this.executeCommand({
      label: `Add ${formatShapeType(type)}`,
      redo: () => {
        this.insertInstancePlacement(assetId, placementIndex, placement);
        this.select(selection);
      },
      undo: () => {
        this.removeInstancePlacement(assetId, placementIndex);
        this.select(null);
      },
    });
  }

  /**
   * Spawn a Player Start marker (Unreal's PlayerStart). It persists as an
   * ordinary instance under the synthetic `marker:playerStart` asset, so it
   * reuses the instance transform/selection/save pipeline; the runtime skips
   * rendering it and reads its transform as the TPS spawn point. Non-colliding.
   */
  addPlayerStartActor(): void {
    if (!this.layout) return;
    const assetId = PLAYER_START_ASSET_ID;
    this.ensureShapeModel(assetId);

    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    const placementIndex = instance?.placements.length ?? 0;
    const placement: LayoutPlacement = {
      name: this.uniqueInstanceName("Player Start"),
      position: this.defaultActorPosition(3),
      scale: 1,
      collision: false,
    };
    const selection: Selection = { kind: "instance", assetId, placementIndex };

    this.executeCommand({
      label: "Add Player Start",
      redo: () => {
        this.insertInstancePlacement(assetId, placementIndex, placement);
        this.select(selection);
      },
      undo: () => {
        this.removeInstancePlacement(assetId, placementIndex);
        this.select(null);
      },
    });
  }

  /**
   * Resolve the snapped world transform for dropping an instance asset under the
   * cursor. Shared by the live drag ghost and the committed drop so the preview
   * lands exactly where the asset will. Returns null when the cursor isn't over
   * a placeable surface.
   */
  private computeInstanceDropTransform(
    assetId: string,
    clientX: number,
    clientY: number,
  ): { position: [number, number, number]; rotationYDeg: number } | null {
    const hit = this.picker.clientToSurface(clientX, clientY);
    if (!hit) return null;
    const bounds = this.localBounds.get(assetId);
    // Rest the model's base on the surface; bounds.min.y is the offset from the
    // model origin down to its lowest point (y is unaffected by Y rotation).
    let position: [number, number, number] = [
      snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled),
      round(hit.y - (bounds ? bounds.min.y : 0)),
      snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled),
    ];
    let rotationYDeg = snapValue(0, this.snapSettings.rotate, this.snapSettings.rotateEnabled);

    // Wall assets dropped near a wall mount flush against it, facing the room.
    if (this.isWallAsset(assetId)) {
      const room = this.getRoomBounds();
      if (bounds && room) {
        const snap = computeWallSnap(bounds, room, position, rotationYDeg, 1);
        position = snap.position;
        rotationYDeg = snap.rotationYDeg;
      }
    }
    return { position, rotationYDeg };
  }

  private computeLightDropPosition(clientX: number, clientY: number): Vec3 | null {
    const hit = this.picker.clientToSurface(clientX, clientY);
    if (!hit) return null;
    return [
      snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled),
      round(hit.y + 1.5),
      snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled),
    ];
  }

  addAssetAt(assetId: string, clientX: number, clientY: number): void {
    if (!this.layout) return;
    this.ensureShapeModel(assetId);
    // Drag-and-drop can target an asset whose loadGroup wasn't loaded up front;
    // lazy-load it, then retry the placement at the original drop coordinates.
    if (!this.models.has(assetId)) {
      void this.ensureAssetLoaded(assetId).then((ok) => {
        if (ok) this.addAssetAt(assetId, clientX, clientY);
      });
      return;
    }
    const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
    if (asset?.category === "customer-character") {
      const hit = this.picker.clientToSurface(clientX, clientY);
      if (!hit) return;
      const characterScale = 0.42;
      const bounds = this.localBounds.get(assetId);
      // Rest the model's base on the surface; bounds.min.y * scale is the offset
      // from the model origin down to its lowest point.
      const baseY = round(hit.y - (bounds ? bounds.min.y * characterScale : 0));
      const character: LayoutCharacter = {
        assetId,
        name: assetId,
        position: [
          snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled),
          baseY,
          snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled),
        ],
        rotationYDeg: snapValue(0, this.snapSettings.rotate, this.snapSettings.rotateEnabled),
        scale: characterScale,
        animation: "idle",
      };
      const index = this.layout.characters.length;
      const selection: Selection = { kind: "character", index };
      this.executeCommand({
        label: `Place ${assetId}`,
        redo: () => {
          this.insertCharacterPlacement(index, character);
          this.select(selection);
        },
        undo: () => {
          this.removeCharacterPlacement(index);
          this.select(null);
        },
      });
      return;
    }

    const transform = this.computeInstanceDropTransform(assetId, clientX, clientY);
    if (!transform) return;
    const placement: LayoutPlacement = {
      position: transform.position,
      rotationYDeg: transform.rotationYDeg,
      scale: 1,
    };
    const shapeType = parseShapeAssetId(assetId);
    if (shapeType) placement.name = this.uniqueInstanceName(formatShapeType(shapeType));
    if (isPlayerStartAssetId(assetId)) {
      placement.name = this.uniqueInstanceName("Player Start");
      placement.collision = false;
    }

    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    const placementIndex = instance?.placements.length ?? 0;
    const selection: Selection = { kind: "instance", assetId, placementIndex };
    this.executeCommand({
      label: `Place ${assetId}`,
      redo: () => {
        this.insertInstancePlacement(assetId, placementIndex, placement);
        this.select(selection);
      },
      undo: () => {
        this.removeInstancePlacement(assetId, placementIndex);
        this.select(null);
      },
    });
  }

  addLightActorAt(type: LayoutLightActor["type"], clientX: number, clientY: number): void {
    if (!this.layout) return;
    const position = this.computeLightDropPosition(clientX, clientY);
    if (!position) return;
    const index = this.layout.lights?.length ?? 0;
    const actor = this.createDefaultLightActor(type);
    actor.position = position;
    const selection: Selection = { kind: "light", index };

    this.executeCommand({
      label: `Place ${formatLightType(type)}`,
      redo: () => {
        this.insertLightActor(index, actor);
        this.select(selection);
      },
      undo: () => {
        this.removeLightActor(index);
        this.select(null);
      },
    });
  }

  async saveLayout(): Promise<void> {
    if (!this.layout) throw new Error("Layout is not loaded yet.");
    if (!this.layoutSaver) {
      throw new Error("Layout saving is available only when the editor saver is installed.");
    }
    const result = await this.layoutSaver({
      layout: this.layout,
      editor: {
        gridSize: this.snapSettings.move,
        gridEnabled: this.snapSettings.moveEnabled,
        snapRotationDeg: this.snapSettings.rotate,
        snapRotationEnabled: this.snapSettings.rotateEnabled,
        snapScale: this.snapSettings.scale,
        snapScaleEnabled: this.snapSettings.scaleEnabled,
      },
    });
    this.onStatus?.(`Saved ${result.path ?? "layout"}.`, "success");
  }

  private async loadActiveProjectScene(): Promise<void> {
    this.activeProject = await loadActiveProject();
    this.assetLoader = new AssetLoader(this.activeProject.manifest);
    this.snapSettings.move = this.activeProject.manifest.editor.gridSize ?? this.snapSettings.move;
    this.snapSettings.moveEnabled =
      this.activeProject.manifest.editor.gridEnabled ?? this.snapSettings.moveEnabled;
    this.snapSettings.rotate =
      this.activeProject.manifest.editor.snapRotationDeg ?? this.snapSettings.rotate;
    this.snapSettings.rotateEnabled =
      this.activeProject.manifest.editor.snapRotationEnabled ?? this.snapSettings.rotateEnabled;
    this.snapSettings.scale =
      this.activeProject.manifest.editor.snapScale ?? this.snapSettings.scale;
    this.snapSettings.scaleEnabled =
      this.activeProject.manifest.editor.snapScaleEnabled ?? this.snapSettings.scaleEnabled;
    this.manifest = await this.assetLoader.loadManifest();
    this.metadataSchema = await this.assetLoader.loadMetadataSchema().catch((error) => {
      this.onStatus?.(
        `Metadata schema failed to load: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
      return null;
    });
    this.layout = await loadRoomLayout(this.activeProject.manifest.editor.defaultScene);
    this.ensureDefaultLights();
    this.physicsSubsystem.setGravity(resolveSceneWorldSettings(this.layout).gravity);
    this.models = await this.assetLoader.loadGroups(this.layout.loadGroups);
    await this.loadMissingSceneModels();
    const convertedUnlitMaterials = convertUnlitModelMaterialsToLit(this.models);
    this.localBounds = computeModelLocalBounds(this.models);

    // Shape actors persist as `shape:<type>` instances; their synthetic models
    // aren't part of any loadGroup, so register them before the scene is built.
    this.registerShapeModelsFromLayout();

    this.assetPlacements.clear();
    for (const asset of await this.assetLoader.loadEditableAssets()) {
      this.assetPlacements.set(asset.id, asset.placement);
    }

    buildSceneEntities(this.layout, {
      addInstance: (assetId, placements) =>
        this.scene.add(this.createInstancedModel(assetId, placements)),
      addCharacter: (assetId, character) => this.addCharacter(this.models.get(assetId), character),
      addLight: (light) => this.addLight(light),
    });

    this.fitSunShadowToScene();
    this.applyBackgroundAndAmbient();
    this.emitSceneObjectsChanged();
    this.emitWorldSettingsChanged();
    this.emitHistoryChanged();

    const bytes = await this.assetLoader.totalBytesForGroups(this.layout.loadGroups);
    const materialStats = collectMaterialStats(this.models);
    console.info(
      "[render-test] Kenney room loaded",
      JSON.stringify({
        project: this.activeProject.manifest.name,
        layout: this.layout.name,
        processedAssetBytes: bytes,
        materialStats,
        convertedUnlitMaterials,
        note:
          materialStats.basic > 0
            ? "Unlit runtime materials remain; scene lights do not affect those assets."
            : "Runtime model materials are lit and can receive dynamic lighting.",
      }),
    );

    // Derive the runtime entity set once and bring the engine-core spine online
    // now that the scene is fully built. SceneDocument starts acting as a runtime
    // source of truth here: behaviors mutate per-entity transform copies, synced
    // back to the rendered objects each tick via syncEntityTransform. The rAF
    // loop's engineApp.update() has been ticking the registry since start();
    // behaviors only have entities to act on from here.
    // Load authored collision sidecars first so the runtime collider (and the
    // "Show > Collision" overlay) use the compound shapes, not the auto box.
    await this.refreshCollisionDefs();
    await startSceneRuntime({
      sceneDocument: this.getSceneDocument(),
      physics: this.physicsSubsystem,
      behavior: this.behaviorSubsystem,
      engineApp: this.engineApp,
    });
  }

  /** Register synthetic models for any `shape:<type>` instances in the layout. */
  private registerShapeModelsFromLayout(): void {
    registerSceneShapeModels(this.layout, this.models, this.localBounds);
  }

  /** Lazily build + register the procedural model and bounds for a shape/marker asset. */
  private ensureShapeModel(assetId: string): void {
    if (this.models.has(assetId)) return;
    const gltf = createProceduralAssetGltf(assetId);
    if (!gltf) return;
    this.models.set(assetId, gltf);
    for (const [id, box] of computeModelLocalBounds(new Map([[assetId, gltf]]))) {
      this.localBounds.set(id, box);
    }
  }

  /** A name unique across every instance placement (shapes show it verbatim). */
  private uniqueInstanceName(baseName: string): string {
    const existing = new Set<string>();
    for (const instance of this.layout?.instances ?? []) {
      for (const placement of instance.placements) {
        if (placement.name) existing.add(placement.name);
      }
    }
    if (!existing.has(baseName)) return baseName;
    let index = 2;
    while (existing.has(`${baseName} ${index}`)) index += 1;
    return `${baseName} ${index}`;
  }

  private createInstancedModel(assetId: string, placements: LayoutPlacement[]): Group {
    const gltf = this.models.get(assetId);
    if (!gltf) throw new Error(`Render test asset missing: ${assetId}`);

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

  private rebuildInstanceGroup(assetId: string): void {
    if (!this.layout) return;
    const previous = this.instanceGroups.get(assetId);
    if (previous) this.scene.remove(previous);
    this.instanceGroups.delete(assetId);
    this.instanceMeshes.delete(assetId);

    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    if (!instance) return;
    this.scene.add(this.createInstancedModel(assetId, instance.placements));
  }

  private insertInstancePlacement(
    assetId: string,
    placementIndex: number,
    placement: LayoutPlacement,
  ): void {
    if (!this.layout) return;
    let instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    if (!instance) {
      instance = { assetId, placements: [] };
      this.layout.instances.push(instance);
    }
    const index = clampIndex(placementIndex, instance.placements.length);
    instance.placements.splice(index, 0, clonePlacement(placement));
    this.rebuildInstanceGroup(assetId);
  }

  private removeInstancePlacement(assetId: string, placementIndex: number): LayoutPlacement | null {
    if (!this.layout) return null;
    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    if (!instance) return null;
    const [removed] = instance.placements.splice(placementIndex, 1);
    this.rebuildInstanceGroup(assetId);
    return removed ? clonePlacement(removed) : null;
  }

  private refreshSelectionObject(selection: Selection): void {
    if (selection.kind === "instance") {
      this.rebuildInstanceGroup(selection.assetId);
      return;
    }

    if (selection.kind === "light") {
      this.refreshLightObject(selection.index);
      return;
    }

    const object = this.characterObjects[selection.index];
    const transform = this.getMutableTransform(selection);
    if (!object || !transform) return;
    object.position.set(...transform.position);
    applyEulerDegrees(object, readRotation(transform));
    object.scale.set(...readScale(transform as LayoutCharacter));
  }

  private addCharacter(gltf: GLTF | undefined, placement: LayoutCharacter): void {
    if (!gltf) return;

    const character = this.createCharacterObject(gltf, placement, this.characterObjects.length);
    character.userData.characterIndex = this.characterObjects.length;
    this.scene.add(character);
    this.characterObjects.push(character);
    this.playCharacterAnimation(character, gltf, placement.animation);
  }

  private insertCharacterPlacement(index: number, placement: LayoutCharacter): void {
    if (!this.layout) return;
    const gltf = this.models.get(placement.assetId);
    if (!gltf) return;

    const insertionIndex = clampIndex(index, this.layout.characters.length);
    const character = this.createCharacterObject(gltf, placement, insertionIndex);
    this.layout.characters.splice(insertionIndex, 0, cloneCharacter(placement));
    this.characterObjects.splice(insertionIndex, 0, character);
    this.scene.add(character);
    this.playCharacterAnimation(character, gltf, placement.animation);
    this.refreshCharacterIndices();
  }

  private removeCharacterPlacement(index: number): LayoutCharacter | null {
    if (!this.layout) return null;
    const [removedLayout] = this.layout.characters.splice(index, 1);
    const [removedObject] = this.characterObjects.splice(index, 1);
    removedObject?.removeFromParent();
    this.refreshCharacterIndices();
    return removedLayout ? cloneCharacter(removedLayout) : null;
  }

  private ensureDefaultLights(): void {
    ensureDefaultSceneLights(this.layout);
  }

  private createDefaultLightActor(type: LayoutLightActor["type"]): LayoutLightActor {
    const position = this.defaultActorPosition(type === "directional" ? 4 : 2);
    const id = this.createLightId(type);
    return {
      id,
      type,
      name: uniqueActorName(formatLightType(type), this.layout?.lights ?? []),
      position,
      rotation: type === "point" ? [0, 0, 0] : [-55, 35, 0],
      color: DEFAULT_SCENE_LIGHT_COLOR,
      intensity: defaultLightIntensity(type),
      castShadow: type !== "point",
      ...(type === "point" ? { distance: 8, decay: 2 } : {}),
      ...(type === "spot" ? { distance: 10, angle: 30, penumbra: 0.35, decay: 2 } : {}),
    };
  }

  private createLightId(type: LayoutLightActor["type"]): string {
    const existing = new Set(this.layout?.lights?.map((light) => light.id) ?? []);
    return uniqueEditorId(`${type}-light`, existing, 10_000);
  }

  private defaultActorPosition(distance: number): Vec3 {
    const direction = new Vector3();
    this.camera.getWorldDirection(direction);
    const position = this.camera.position.clone().addScaledVector(direction.normalize(), distance);
    position.y = Math.max(1, position.y);
    return [round(position.x), round(position.y), round(position.z)];
  }

  private addLight(actor: LayoutLightActor): void {
    const record = this.createLightObject(actor, this.lightObjects.length);
    tagSceneLightRecordIndex(record, this.lightObjects.length);
    this.scene.add(record.root);
    if (record.target) this.scene.add(record.target);
    this.lightObjects.push(record);
    if (isSceneSunLight(actor, this.sun)) {
      this.sun = record.light as DirectionalLight;
    }
    this.refreshLightObject(this.lightObjects.length - 1);
  }

  private createLightObject(actor: LayoutLightActor, index: number): LightObjectRecord {
    return buildSceneLightObject(actor, index);
  }

  private insertLightActor(index: number, actor: LayoutLightActor): void {
    if (!this.layout) return;
    const insertionIndex = clampIndex(index, this.layout.lights?.length ?? 0);
    this.layout.lights ??= [];
    const record = this.createLightObject(actor, insertionIndex);
    this.layout.lights.splice(insertionIndex, 0, cloneLightActor(actor));
    this.lightObjects.splice(insertionIndex, 0, record);
    this.scene.add(record.root);
    if (record.target) this.scene.add(record.target);
    if (actor.type === "directional" && (!this.sun || actor.id === DEFAULT_SCENE_SUN_ID)) {
      this.sun = record.light as DirectionalLight;
    }
    this.refreshLightIndices();
    this.refreshLightObject(insertionIndex);
  }

  private removeLightActor(index: number): LayoutLightActor | null {
    if (!this.layout?.lights) return null;
    const [removedLayout] = this.layout.lights.splice(index, 1);
    const [removedObject] = this.lightObjects.splice(index, 1);
    removedObject?.root.removeFromParent();
    removedObject?.target?.removeFromParent();
    this.refreshLightIndices();
    this.sun =
      (this.lightObjects.find((entry) => entry.light instanceof DirectionalLight)
        ?.light as DirectionalLight | undefined) ?? null;
    return removedLayout ? cloneLightActor(removedLayout) : null;
  }

  private refreshLightIndices(): void {
    this.lightObjects.forEach((record, index) => {
      record.root.userData.lightIndex = index;
      record.root.traverse((child) => {
        child.userData.lightIndex = index;
      });
    });
  }

  private refreshLightObject(index: number): void {
    const actor = this.layout?.lights?.[index];
    const record = this.lightObjects[index];
    if (!actor || !record) return;
    syncLightObject(record, entityLightItem(lightEntity(index, actor)), {
      defaultColor: DEFAULT_SCENE_LIGHT_COLOR,
      selected: this.isLightSelected(index),
    });
  }

  private duplicateSelectionForDrag(selection: Selection): Selection | null {
    return this.editorSceneController.duplicateSelectionForDrag(selection);
  }

  private renameSelection(selection: Selection, name: string): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    const previous = target.name ?? "";
    const next = name.trim();
    if (previous === next) return;

    this.executeCommand({
      label: "Rename",
      redo: () => {
        this.applyName(selection, next);
      },
      undo: () => {
        this.applyName(selection, previous);
      },
    });
  }

  private applyName(selection: Selection, name: string): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    if (name) target.name = name;
    else delete target.name;

    if (selection.kind === "character") {
      const object = this.characterObjects[selection.index];
      const character = this.layout?.characters[selection.index];
      if (object && character) object.name = target.name ?? character.assetId;
    }
    if (selection.kind === "light") this.refreshLightObject(selection.index);

    this.emitSelectionChanged();
  }

  private isSelectionLocked(selection: Selection): boolean {
    return Boolean(this.getMutableTransform(selection)?.locked);
  }

  /** Toggles proportional-scale lock on the current selection (Details panel). */
  setSelectionScaleLocked(value: boolean): void {
    this.editorSceneController.setSelectionScaleLocked(value);
  }

  /** Details "Cast Shadow" toggle for the active selection (default on). */
  setSelectionCastShadow(value: boolean): void {
    this.editorSceneController.setSelectionCastShadow(value);
  }

  /** Details "Collision" toggle for the active selection (default on). */
  setSelectionCollision(value: boolean): void {
    this.editorSceneController.setSelectionCollision(value);
  }

  /** Details "Simulate Physics" toggle for the active selection (default off). */
  setSelectionSimulatePhysics(value: boolean): void {
    this.editorSceneController.setSelectionSimulatePhysics(value);
  }

  /** Details "Collision" section preset override (undefined inherits asset default). */
  setSelectionCollisionPreset(value: CollisionPresetId | undefined): void {
    this.editorSceneController.setSelectionCollisionPreset(value);
  }

  /** Details Physics section settings for the active selection. */
  setSelectionPhysics(patch: Partial<LayoutPhysics>): void {
    this.editorSceneController.setSelectionPhysics(patch);
  }

  /** Sets (or clears, when `undefined`) the selection's Interaction component with undo/redo. */
  setSelectionInteraction(value: LayoutInteraction | undefined): void {
    this.editorSceneController.setSelectionInteraction(value);
  }

  /** Active project's gameplay metadata schema, or null when none is declared. */
  getMetadataSchema(): MetadataSchema | null {
    return this.metadataSchema;
  }

  /**
   * Sets a single schema-driven metadata field on the active selection with
   * undo/redo. Passing `undefined` (or an empty value, decided by the caller)
   * removes the key so saved layouts only carry meaningful deviations.
   */
  setSelectionMetadata(key: string, value: MetadataValue | undefined, label?: string): void {
    this.editorSceneController.setSelectionMetadata(key, value, label);
  }

  /**
   * Reflects a castShadow change on the live object. Only characters are
   * individual objects; instanced meshes are batched per asset, so their flag
   * stays authoring-only data the runtime can consume.
   */
  private applyCastShadow(selection: Selection): void {
    if (selection.kind !== "character") return;
    const object = this.characterObjects[selection.index];
    const character = this.layout?.characters[selection.index];
    if (!object || !character) return;
    const castShadow = character.castShadow ?? true;
    object.traverse((child) => {
      if (isRenderableMesh(child)) child.castShadow = castShadow;
    });
  }

  private applyWorldSettings(settings: EditorWorldSettings): void {
    if (!this.layout) return;
    const worldSettings: LayoutWorldSettings = { ...(this.layout.worldSettings ?? {}) };

    if (settings.staticObjectsCastShadow === DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS) {
      delete worldSettings.staticObjectsCastShadow;
    } else {
      worldSettings.staticObjectsCastShadow = settings.staticObjectsCastShadow;
    }

    if (settings.staticObjectsReceiveShadow === DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS) {
      delete worldSettings.staticObjectsReceiveShadow;
    } else {
      worldSettings.staticObjectsReceiveShadow = settings.staticObjectsReceiveShadow;
    }

    if (settings.backgroundColor.toLowerCase() === DEFAULT_SCENE_BACKGROUND_COLOR) {
      delete worldSettings.backgroundColor;
    } else {
      worldSettings.backgroundColor = settings.backgroundColor;
    }

    if (settings.ambientColor.toLowerCase() === DEFAULT_SCENE_AMBIENT_COLOR) {
      delete worldSettings.ambientColor;
    } else {
      worldSettings.ambientColor = settings.ambientColor;
    }

    if (settings.ambientIntensity === DEFAULT_SCENE_AMBIENT_INTENSITY) {
      delete worldSettings.ambientIntensity;
    } else {
      worldSettings.ambientIntensity = settings.ambientIntensity;
    }

    // The default camera mode is implicit: omit it so layouts stay clean and old
    // layouts (no gameMode) keep round-tripping unchanged.
    if (settings.gameMode === DEFAULT_GAME_MODE_ID) {
      delete worldSettings.gameMode;
    } else {
      worldSettings.gameMode = settings.gameMode;
    }

    if (Object.keys(worldSettings).length === 0) delete this.layout.worldSettings;
    else this.layout.worldSettings = worldSettings;

    this.applyStaticObjectShadowSettings();
    this.applyBackgroundAndAmbient();
    this.emitWorldSettingsChanged();
    this.emitSceneObjectsChanged();
    this.scheduleAutoSave();
  }

  /** Applies the resolved background color and ambient light to the live scene. */
  private applyBackgroundAndAmbient(): void {
    this.ambientLight = applySceneBackgroundAndAmbient({
      scene: this.scene,
      ambientLight: this.ambientLight,
      settings: resolveSceneWorldSettings(this.layout),
      ambientName: "editor-ambient-light",
    });
  }

  /**
   * World-settings edits persist immediately (debounced) so the user never has
   * to press Save for scene rendering tweaks.
   */
  private scheduleAutoSave(): void {
    window.clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = window.setTimeout(() => {
      void this.saveLayout().catch((error) => {
        this.onStatus?.(
          `Auto-save failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      });
    }, 500);
  }

  private applyLightActor(selection: LightSelection, actor: LayoutLightActor): void {
    if (!this.layout?.lights?.[selection.index]) return;
    this.layout.lights[selection.index] = cloneLightActor(actor);
    this.refreshLightObject(selection.index);
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private applyStaticObjectShadowSettings(): void {
    const castShadow = this.staticObjectsCastShadow();
    const receiveShadow = this.staticObjectsReceiveShadow();
    for (const meshes of this.instanceMeshes.values()) {
      for (const mesh of meshes) {
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
      }
    }
  }

  private applyGroupId(
    selection: Selection,
    groupId: string | undefined,
    options: { notify?: boolean } = {},
  ): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    if (groupId) target.groupId = groupId;
    else delete target.groupId;

    if (options.notify !== false) this.emitSelectionChanged();
  }

  private applyVisibility(selection: Selection): void {
    if (selection.kind === "instance") {
      this.rebuildInstanceGroup(selection.assetId);
      return;
    }
    if (selection.kind === "light") {
      this.refreshLightObject(selection.index);
      return;
    }
    const object = this.characterObjects[selection.index];
    const character = this.layout?.characters[selection.index];
    if (object && character) object.visible = !(character.hidden ?? false);
  }

  private createCharacterObject(gltf: GLTF, placement: LayoutCharacter, index: number): Object3D {
    return buildSceneCharacterObject(gltf, placement, index);
  }

  private playCharacterAnimation(
    character: Object3D,
    gltf: GLTF,
    animationName: string | undefined,
  ): void {
    const mixer = createSceneCharacterMixer(character, gltf, animationName);
    if (mixer) this.animationSubsystem.add(mixer);
  }

  private refreshCharacterIndices(): void {
    this.characterObjects.forEach((object, index) => {
      object.userData.characterIndex = index;
    });
  }

  private bindEditorInput(): void {
    this.unbindEditorInput = bindEditorInputEvents(this.canvas, {
      hasSelection: () => Boolean(this.selection),
      pickGizmoHandle: (clientX, clientY) => this.picker.pickGizmoHandle(clientX, clientY),
      startGizmoDrag: (handle, event) => this.startGizmoDrag(handle, event),
      beginAltCameraDrag: (event) => this.cameraController.beginAltDrag(event),
      beginCameraNavigation: (event) => this.cameraController.beginNavigation(event),
      pickSelection: (clientX, clientY) => this.picker.pickSelection(clientX, clientY),
      toggleSelection: (selection) => this.toggleSelection(selection),
      select: (selection) => this.select(selection),
      isCameraNavigationActive: () => this.cameraController.isNavigating,
      cameraNavigationPointerId: () => this.cameraController.navigationPointerId,
      updateCameraLook: (movementX, movementY) => this.cameraController.updateLook(movementX, movementY),
      endCameraNavigation: (event) => this.cameraController.endNavigation(event),
      cameraDragPointerId: () => this.cameraController.dragPointerId,
      updateCameraDrag: (event) => this.cameraController.updateDrag(event),
      endCameraDrag: (event) => this.cameraController.endDrag(event),
      pointerDrag: () => this.pointerDrag,
      clearPointerDrag: () => {
        const drag = this.pointerDrag;
        this.pointerDrag = null;
        return drag;
      },
      endGizmoDrag: () => this.gizmoInteraction.endDrag(),
      selected: () => this.getSelected(),
      updateGizmoHover: (clientX, clientY) => this.updateGizmoHover(clientX, clientY),
      clearGizmoHover: () => this.clearGizmoHover(),
      updateMoveDrag: (event, selected) => this.updateMoveDrag(event, selected),
      updateRotateDrag: (event) => this.updateRotateDrag(event),
      updateScaleDrag: (event) => this.updateScaleDrag(event),
      commitPointerDrag: (drag) => this.commitPointerDrag(drag),
      updateGizmo: () => this.updateGizmo(),
      onAssetDragOver: (clientX, clientY) => this.updateAssetDragPreview(clientX, clientY),
      onAssetDragLeave: () => this.hideAssetDragPreview(),
      onAssetDrop: (assetId, clientX, clientY) => {
        this.endAssetDragPreview();
        this.addAssetAt(assetId, clientX, clientY);
      },
      onLightDrop: (type, clientX, clientY) => {
        this.endAssetDragPreview();
        this.addLightActorAt(type, clientX, clientY);
      },
      onWheel: (event) => this.cameraController.handleWheel(event),
      addPressedKey: (code) => this.cameraController.addPressedKey(code),
      deletePressedKey: (code) => this.cameraController.deletePressedKey(code),
    });
  }

  private getCameraOrbitTarget(): Vector3 {
    if (this.selection) {
      const box = this.getSelectionWorldBox(this.selection);
      if (box && !box.isEmpty()) return box.getCenter(new Vector3());
    }

    const direction = new Vector3();
    this.camera.getWorldDirection(direction);
    const floorHit = this.raycaster.ray
      .set(this.camera.position, direction)
      .intersectPlane(this.floorPlane, new Vector3());
    return floorHit ?? this.camera.position.clone().addScaledVector(direction, 5);
  }

  private commitPointerDrag(drag: GizmoPointerDrag): void {
    if (drag.mode === "move" && drag.pivotEdit) {
      this.commitPivotChange(
        drag.selection,
        drag.startPivot ?? [0, 0, 0],
        this.getSelectionPivot(drag.selection),
      );
      return;
    }
    if (drag.linkedTransforms?.length) {
      const verb = drag.mode === "rotate" ? "Rotate" : drag.mode === "scale" ? "Scale" : "Move";
      this.commitLinkedMoveChange(drag, verb);
      return;
    }
    this.commitTransformChange(drag.selection, drag.startTransform);
  }

  private startGizmoDrag(handle: GizmoHandle, event: PointerEvent): void {
    if (!this.selection) return;
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }
    let linkedTransforms: LinkedMoveStart[] | undefined;
    if (event.altKey && handle.tool === "move") {
      const selection = this.duplicateSelectionForDrag(this.selection);
      if (selection) linkedTransforms = this.captureLinkedMoveStarts(selection);
    } else if (handle.tool === "move") {
      linkedTransforms = this.captureLinkedMoveStarts(this.selection);
    }
    const selected = this.getSelected();
    if (!selected) return;

    this.gizmoInteraction.beginDrag(handle);
    this.updateGizmo();

    const pivot = this.getSelectionPivot(this.selection);
    const pivotWorld = this.getSelectionPivotWorld(this.selection);
    const pivotEditing = handle.tool === "move" && this.pivotEditMode && this.selection.kind !== "light";
    const base = gizmoDragBaseWorld(selected, pivotWorld, pivotEditing);
    const movePlane = createGizmoMovePlane(handle, base, this.gizmoGroup.quaternion);
    const planeStartHit = movePlane
      ? this.picker.clientToPlane(event.clientX, event.clientY, movePlane) ?? base.clone()
      : undefined;
    this.pointerDrag = createGizmoPointerDrag({
      handle,
      selection: this.selection,
      selected,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      floorHit: handle.tool === "move" ? this.picker.clientToFloor(event.clientX, event.clientY) : null,
      freeMoveBasis: this.getScreenSpaceMoveBasis(),
      linkedTransforms,
      descendantTransforms:
        handle.tool === "rotate" || handle.tool === "scale"
          ? this.captureDescendantStarts(this.selection)
          : undefined,
      movePlane,
      planeStartHit,
      pivot,
      pivotWorld,
      pivotEditing,
    });

    this.canvas.setPointerCapture(event.pointerId);
  }

  private updateMoveDrag(event: PointerEvent, selected: EditableSelection): void {
    const drag = this.pointerDrag;
    if (!drag || drag.mode !== "move") return;

    // When editing the pivot the object stays put, so the unchanged components
    // come from the pivot's start point (startPosition), not the object origin.
    const base: Vec3 = drag.pivotEdit ? [...drag.startPosition] : [...selected.position];

    if (drag.axis === "xyz") {
      const position = freeMoveDragPosition(
        drag,
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
        this.snapSettings,
      );
      this.updateMoveDragPosition(position);
      return;
    }

    if (isPlaneAxis(drag.axis) && drag.movePlane && drag.planeStartHit) {
      const hit = this.picker.clientToPlane(event.clientX, event.clientY, drag.movePlane);
      if (!hit) return;
      this.updateMoveDragPosition(planeMoveDragPosition(drag, hit, this.snapSettings));
      return;
    }

    if (drag.axis === "y") {
      this.updateMoveDragPosition(
        axisYMoveDragPosition(base, drag, event.clientY - drag.startClientY, this.snapSettings),
      );
      return;
    }

    const hit = this.picker.clientToFloor(event.clientX, event.clientY);
    if (!hit) return;

    if (this.transformSpace === "local" && (drag.axis === "x" || drag.axis === "z")) {
      this.updateMoveDragPosition(localAxisMoveDragPosition(base, drag, hit, this.snapSettings));
      return;
    }

    this.updateMoveDragPosition(worldAxisMoveDragPosition(base, drag, hit, this.snapSettings));
  }

  private updateMoveDragPosition(position: Vec3): void {
    if (!this.pointerDrag || this.pointerDrag.mode !== "move") return;
    const drag = this.pointerDrag;
    const activeTransform = this.getMutableTransform(drag.selection);
    if (!activeTransform) return;

    // Pivot edit: `position` is the new pivot world point; map it back into the
    // object's (fixed) local space and store as the pivot — the object stays put.
    if (drag.pivotEdit && drag.pivotMatrixInverse) {
      const local = new Vector3(...position).applyMatrix4(drag.pivotMatrixInverse);
      this.applyPivotValue(drag.selection, [
        round(local.x),
        round(local.y),
        round(local.z),
      ]);
      return;
    }

    const delta: Vec3 = [
      position[0] - drag.startPosition[0],
      position[1] - drag.startPosition[1],
      position[2] - drag.startPosition[2],
    ];

    activeTransform.position = [...position];
    this.refreshSelectionObject(drag.selection);

    for (const linked of drag.linkedTransforms ?? []) {
      const transform = this.getMutableTransform(linked.selection);
      if (!transform) continue;
      transform.position = [
        round(linked.startTransform.position[0] + delta[0]),
        round(linked.startTransform.position[1] + delta[1]),
        round(linked.startTransform.position[2] + delta[2]),
      ];
      this.refreshSelectionObject(linked.selection);
    }

    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private updateRotateDrag(event: PointerEvent): void {
    const drag = this.pointerDrag;
    if (!drag || drag.mode !== "rotate") return;
    const rotation = rotateDragRotation(drag, event.clientX - drag.startClientX, this.snapSettings);
    const values: { rotation: Vec3; position?: Vec3 } = { rotation };
    if (drag.pivotWorld && drag.pivot) {
      // Pivot around the offset point: keep it fixed by shifting the origin.
      values.position = pivotCorrectedPosition(
        drag.pivotWorld,
        rotation,
        drag.startTransform.scale,
        drag.pivot,
      );
    }
    this.updateSelectedTransform(values, { notifySelection: false });
    this.cascadeActiveDragToLinks();
    this.emitSelectionChanged();
  }

  private updateScaleDrag(event: PointerEvent): void {
    const drag = this.pointerDrag;
    if (!drag || drag.mode !== "scale") return;
    const scale = scaleDragScale(
      drag,
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
      this.snapSettings,
    );
    const values: { scale: Vec3; position?: Vec3 } = { scale };
    if (drag.pivotWorld && drag.pivot) {
      values.position = pivotCorrectedPosition(
        drag.pivotWorld,
        drag.startTransform.rotation,
        scale,
        drag.pivot,
      );
    }
    this.updateSelectedTransform(values, { notifySelection: false });
    this.cascadeActiveDragToLinks();
    this.emitSelectionChanged();
  }

  /** Highlights the handle under the cursor (idle, not dragging) so it's clear what a click will grab. */
  private updateGizmoHover(clientX: number, clientY: number): void {
    if (this.cameraController.isInteracting) return;
    const handle = this.gizmoGroup.visible ? this.picker.pickGizmoHandle(clientX, clientY) : null;
    const changed = this.gizmoInteraction.setHover(handle);
    if (!changed) return;
    this.canvas.style.cursor = handle ? "pointer" : "";
    this.updateGizmo();
  }

  private clearGizmoHover(): void {
    if (!this.gizmoInteraction.clearHover()) return;
    if (this.canvas.style.cursor === "pointer") this.canvas.style.cursor = "";
    this.updateGizmo();
  }

  private getScreenSpaceMoveBasis(): { right: Vector3; up: Vector3 } {
    return screenSpaceMoveBasis(this.camera.quaternion);
  }

  private select(selection: Selection | null): void {
    this.editorSceneController.select(selection);
  }

  private selectMany(selections: Selection[], active: Selection | null): void {
    this.editorSceneController.selectMany(selections, active);
  }

  private toggleSelection(selection: Selection): void {
    this.editorSceneController.toggleSelection(selection);
  }

  private captureLinkedMoveStarts(active: Selection): LinkedMoveStart[] | undefined {
    // Everything that should move with the active object: the rest of the
    // selection (groups/multi-select) plus all parent→child descendants.
    const targets = new Map<string, Selection>();
    const add = (selection: Selection): void => {
      const id = selectionId(selection);
      if (!targets.has(id)) targets.set(id, cloneSelection(selection));
    };
    for (const selection of this.getSelectedSelections()) add(selection);
    for (const selection of [active, ...targets.values()]) {
      for (const descendant of this.descendantsOf(selection)) add(descendant);
    }

    const linked = [...targets.values()].flatMap((selection) => {
      if (selectionsEqual(selection, active)) return [];
      if (this.isSelectionLocked(selection)) return [];
      const startTransform = this.captureTransform(selection);
      return startTransform ? [{ selection: cloneSelection(selection), startTransform }] : [];
    });
    return linked.length > 0 ? linked : undefined;
  }

  /**
   * Captures start world transforms of the active object's descendants so a
   * parent rotate/scale can carry its children (cascade). Descendants only —
   * unlike captureLinkedMoveStarts, multi-selection siblings are not included.
   */
  private captureDescendantStarts(active: Selection): LinkedMoveStart[] | undefined {
    const links = this.descendantsOf(active).flatMap((selection) => {
      if (this.isSelectionLocked(selection)) return [];
      const startTransform = this.captureTransform(selection);
      return startTransform ? [{ selection: cloneSelection(selection), startTransform }] : [];
    });
    return links.length > 0 ? links : undefined;
  }

  /** During a rotate/scale drag, re-derives linked descendants from the parent. */
  private cascadeActiveDragToLinks(): void {
    const drag = this.pointerDrag;
    if (!drag || (drag.mode !== "rotate" && drag.mode !== "scale")) return;
    if (!drag.linkedTransforms || drag.linkedTransforms.length === 0) return;
    const parentNow = this.captureTransform(drag.selection);
    if (!parentNow) return;
    this.applyCascadeToLinks(drag.startTransform, parentNow, drag.linkedTransforms);
  }

  /**
   * Re-derives each linked descendant's world transform as the parent moves:
   * D1 = (P1 · P0⁻¹) · D0, so children keep their start offset/orientation
   * relative to the parent (UE-style hierarchy). Lights skip scale.
   */
  private applyCascadeToLinks(
    parentStart: EditableTransform,
    parentNow: EditableTransform,
    links: LinkedMoveStart[],
  ): void {
    const delta = new Matrix4().multiplyMatrices(
      transformToMatrix(parentNow),
      transformToMatrix(parentStart).invert(),
    );
    for (const link of links) {
      const transform = this.getMutableTransform(link.selection);
      if (!transform) continue;
      const next = matrixToTransform(
        new Matrix4().multiplyMatrices(delta, transformToMatrix(link.startTransform)),
      );
      transform.position = [
        round(next.position[0]),
        round(next.position[1]),
        round(next.position[2]),
      ];
      writeRotation(transform, next.rotation);
      if (link.selection.kind !== "light") writeScale(transform, next.scale);
      this.refreshSelectionObject(link.selection);
    }
    this.updateSelectionBox();
    this.updateGizmo();
  }

  private getGroupedSelections(selection: Selection): Selection[] {
    return groupedSelections(
      selection,
      this.getAllSelections({ includeHidden: true }),
      (entry) => this.getMutableTransform(entry),
    );
  }

  /** All descendants (depth-first), cycle-safe via a visited-nodeId set. */
  private descendantsOf(selection: Selection): Selection[] {
    return descendantSelections(
      selection,
      this.getAllSelections({ includeHidden: true }),
      (entry) => this.getMutableTransform(entry),
    );
  }

  private isSelectionSelected(selection: Selection): boolean {
    return this.editorSceneController.isSelectionSelected(selection);
  }

  private getSelectedSelections(): Selection[] {
    return this.editorSceneController.getSelectedSelections();
  }

  private getAllSelections(options: { includeHidden: boolean }): Selection[] {
    if (!this.layout) return [];
    const selections: Selection[] = [];
    for (const instance of this.layout.instances) {
      instance.placements.forEach((placement, placementIndex) => {
        if (!options.includeHidden && placement.hidden) return;
        selections.push({ kind: "instance", assetId: instance.assetId, placementIndex });
      });
    }
    this.layout.characters.forEach((character, index) => {
      if (!options.includeHidden && character.hidden) return;
      selections.push({ kind: "character", index });
    });
    this.layout.lights?.forEach((light, index) => {
      if (!options.includeHidden && light.hidden) return;
      selections.push({ kind: "light", index });
    });
    return selections;
  }

  private getSelectionLabel(selection: Selection): string {
    const transform = this.getMutableTransform(selection);
    if (selection.kind === "instance") {
      return transform?.name ?? selection.assetId;
    }
    if (selection.kind === "light") {
      const light = transform as LayoutLightActor | null;
      return light?.name ?? light?.id ?? "light";
    }
    const character = transform as LayoutCharacter | null;
    return character?.name ?? character?.assetId ?? "object";
  }

  /** The active selection's local authoring pivot (`[0,0,0]` when none / light). */
  private getSelectionPivot(selection: Selection): Vec3 {
    if (selection.kind === "light") return [0, 0, 0];
    const transform = this.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    return transform ? readPivot(transform) : [0, 0, 0];
  }

  /** World-space position of a selection's pivot point (gizmo anchor). */
  private getSelectionPivotWorld(selection: Selection): Vector3 | null {
    const editable = this.captureTransform(selection);
    if (!editable) return null;
    const pivot = this.getSelectionPivot(selection);
    return new Vector3(...pivot).applyMatrix4(transformToMatrix(editable));
  }

  /** Model-space AABB for pivot presets (instances only for now). */
  private getLocalBounds(selection: Selection): Box3 | null {
    if (selection.kind === "instance") return this.localBounds.get(selection.assetId) ?? null;
    return null;
  }

  private getSelectionWorldBox(selection: Selection): Box3 | null {
    if (selection.kind === "instance") {
      const bounds = this.localBounds.get(selection.assetId);
      const transform = this.getMutableTransform(selection);
      if (!bounds || !transform) return null;
      return bounds.clone().applyMatrix4(composePlacementMatrix(transform));
    }
    if (selection.kind === "light") {
      const record = this.lightObjects[selection.index];
      if (!record) return null;
      // Box the small icon, not the (large) wireframe reach.
      const icon = record.gizmo.getObjectByName("light-icon") ?? record.root;
      return new Box3().setFromObject(icon);
    }
    const object = this.characterObjects[selection.index];
    return object ? new Box3().setFromObject(object) : null;
  }

  private updateSelectionBox(): void {
    this.removeSelectionBox();
    this.updateLightGizmoVisibility();
    // Collision overlay refreshes with the same cadence as selection boxes, so it
    // tracks live transform edits (drag/cascade all route through here).
    this.updateCollisionBoxes();
    if (!this.layout || !this.selectionOutline) return;

    const outlineTargets: Object3D[] = [];
    for (const selection of this.getSelectedSelections()) {
      const target = this.createSelectionOutlineTarget(selection);
      if (target) outlineTargets.push(target);
    }
    this.selectionOutline.setTargets(outlineTargets);
  }

  private createSelectionOutlineTarget(selection: Selection): Object3D | null {
    if (!this.selectionOutline || !this.layout) return null;

    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      const placement = instance?.placements[selection.placementIndex];
      const gltf = this.models.get(selection.assetId);
      if (!placement || !gltf || placement.hidden) return null;
      return this.createInstanceOutlineTarget(selection.assetId, placement, gltf);
    }

    if (selection.kind === "light") {
      const record = this.lightObjects[selection.index];
      const actor = this.layout.lights?.[selection.index];
      if (!record || actor?.hidden) return null;
      const proxy = new Mesh(
        this.lightOutlineGeometry,
        this.selectionOutline.getInvisibleMaterial(),
      );
      proxy.name = "light-outline-proxy";
      proxy.matrix.copy(record.root.matrixWorld);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      proxy.raycast = () => {};
      return proxy;
    }

    const object = this.characterObjects[selection.index];
    const character = this.layout.characters[selection.index];
    if (!object || character?.hidden) return null;
    return this.selectionOutline.cloneRenderableMeshes(object);
  }

  private createInstanceOutlineTarget(
    assetId: string,
    placement: LayoutPlacement,
    gltf: GLTF,
  ): Object3D | null {
    const outline = this.selectionOutline;
    if (!outline) return null;
    const placementMatrix = composePlacementMatrix(placement);
    const group = new Group();
    group.name = `${assetId}-outline-proxy`;

    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if (!isRenderableMesh(object)) return;
      const proxy = new Mesh(object.geometry, outline.getInvisibleMaterial());
      proxy.name = `${object.name || "mesh"}-outline-proxy`;
      proxy.matrix.copy(placementMatrix).multiply(object.matrixWorld);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      proxy.raycast = () => {};
      group.add(proxy);
    });

    return group.children.length > 0 ? group : null;
  }

  /** Whether the "Show > Collision" overlay is on. */
  getShowCollision(): boolean {
    return this.showCollision;
  }

  /** Toggles the "Show > Collision" overlay and rebuilds it immediately. */
  setShowCollision(visible: boolean): void {
    if (this.showCollision === visible) return;
    this.showCollision = visible;
    this.updateCollisionBoxes();
    // Pick up sidecars authored/edited since the scene loaded, then rebuild.
    if (visible) void this.refreshCollisionDefs();
  }

  /**
   * Loads authored collision sidecars (`*.collision.json`) for the assets in the
   * current layout into `collisionDefs`, then rebuilds the overlay. Async and
   * race-safe: only definitions with primitives are kept (others fall back to the
   * auto bounding box). Shape actors aren't in the manifest, so they are skipped.
   */
  private async refreshCollisionDefs(): Promise<void> {
    if (!this.manifest || !this.layout) return;
    const assetIds = new Set<string>();
    for (const instance of this.layout.instances) assetIds.add(instance.assetId);
    for (const character of this.layout.characters) assetIds.add(character.assetId);
    const next = new Map<string, AssetCollisionDef>();
    for (const assetId of assetIds) {
      const def = shapeAssetCollisionDef(assetId);
      if (def && def.primitives.length > 0) next.set(assetId, def);
    }
    await Promise.all(
      [...assetIds].map(async (assetId) => {
        if (next.has(assetId)) return;
        const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
        if (!asset) return;
        const def = await loadAssetCollision(assetPath(asset));
        if (def.primitives.length > 0) next.set(assetId, def);
      }),
    );
    this.collisionDefs = next;
    this.updateCollisionBoxes();
  }

  /**
   * Rebuilds the collision overlay from the current layout + model bounds. Solid
   * colliders draw green, sensors amber; both match the collider physics derives
   * (see `collisionWireboxes`). A no-op (after clearing) while the overlay is off.
   */
  private updateCollisionBoxes(): void {
    this.removeCollisionBoxes();
    if (!this.showCollision || !this.layout) return;
    for (const { box, segments, sensor } of collisionWireboxes(
      this.layout,
      this.localBounds,
      this.collisionDefs,
    )) {
      if (box.isEmpty() || segments.length === 0) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(segments.flatMap((point) => point), 3),
      );
      const material = new LineBasicMaterial({ color: sensor ? 0xffb454 : 0x4cd07d });
      const helper = new LineSegments(geometry, material);
      helper.name = "editor-collision-box";
      this.collisionBoxes.push(helper);
      this.scene.add(helper);
    }
  }

  private removeCollisionBoxes(): void {
    for (const collisionBox of this.collisionBoxes) {
      this.scene.remove(collisionBox);
      collisionBox.geometry.dispose();
      const materials = Array.isArray(collisionBox.material)
        ? collisionBox.material
        : [collisionBox.material];
      for (const material of materials) material.dispose();
    }
    this.collisionBoxes.length = 0;
  }

  /** Shows a light's wireframe reach only while it is selected. */
  private updateLightGizmoVisibility(): void {
    this.lightObjects.forEach((record, index) => {
      const wire = record.gizmo.getObjectByName("light-wire");
      if (wire) wire.visible = this.isLightSelected(index);
    });
  }

  private isLightSelected(index: number): boolean {
    return this.isSelectionSelected({ kind: "light", index });
  }

  private removeSelectionBox(): void {
    this.selectionOutline?.setTargets([]);
  }

  private updateGizmo(): void {
    clearGizmoGroup(this.gizmoGroup, this.gizmoPickables);
    if (!this.selection) return;

    const selected = this.getSelected();
    // In pivot-edit mode the move gizmo is shown even under the Select tool.
    const pivotEditing = this.pivotEditMode && this.selection.kind !== "light";
    if (!selected || (this.activeTool === "select" && !pivotEditing)) return;
    if (this.selection && this.isSelectionLocked(this.selection)) return;

    this.gizmoGroup.visible = true;
    const pivotWorld = this.getSelectionPivotWorld(this.selection);
    if (pivotWorld) this.gizmoGroup.position.copy(pivotWorld);
    else this.gizmoGroup.position.set(...selected.position);
    if (this.transformSpace === "local") {
      applyEulerDegrees(this.gizmoGroup, selected.rotation);
    } else {
      this.gizmoGroup.rotation.set(0, 0, 0);
    }

    const tool = pivotEditing ? "move" : this.activeTool;
    if (tool === "move" || tool === "rotate" || tool === "scale") {
      buildGizmoHandles(tool, this.gizmoGroup, this.gizmoPickables, this.gizmoInteraction);
    }
    this.updateGizmoScreenScale();
  }

  private updateGizmoScreenScale(): void {
    if (!this.gizmoGroup.visible) return;
    const viewportHeight = this.renderer.domElement.clientHeight || window.innerHeight || 1;
    const scale = calculateGizmoScreenScale(
      this.camera.fov,
      this.camera.position.distanceTo(this.gizmoGroup.position),
      viewportHeight,
    );
    this.gizmoGroup.scale.setScalar(scale);
  }

  private getMutableTransform(
    selection: Selection,
  ): (LayoutPlacement | LayoutCharacter | LayoutLightActor) | null {
    if (!this.layout) return null;
    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      return instance?.placements[selection.placementIndex] ?? null;
    }
    if (selection.kind === "light") return this.layout.lights?.[selection.index] ?? null;
    return this.layout.characters[selection.index] ?? null;
  }

  private captureTransform(selection: Selection): EditableTransform | null {
    const transform = this.getMutableTransform(selection);
    if (!transform) return null;
    return {
      position: [...transform.position],
      rotation: readRotation(transform),
      scale:
        selection.kind === "light"
          ? [1, 1, 1]
          : readScale(transform as LayoutPlacement | LayoutCharacter),
    };
  }

  private applyTransform(selection: Selection, values: EditableTransform): void {
    if (!this.layout || !this.hasSelection(selection)) return;
    const transform = this.getMutableTransform(selection);
    if (!transform) return;
    transform.position = [...values.position];
    writeRotation(transform, values.rotation);
    writeScale(transform, values.scale);
    this.refreshSelectionObject(selection);
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private commitTransformChange(
    selection: Selection,
    before: EditableTransform,
    label = "Transform",
  ): void {
    const after = this.captureTransform(selection);
    if (!after || transformsEqual(before, after)) return;
    const commandSelection = { ...selection } as Selection;
    this.executeCommand({
      label,
      redo: () => {
        this.selectMany([commandSelection], commandSelection);
        this.applyTransform(commandSelection, after);
      },
      undo: () => {
        this.selectMany([commandSelection], commandSelection);
        this.applyTransform(commandSelection, before);
      },
    });
  }

  private commitLinkedMoveChange(
    drag: {
      selection: Selection;
      startTransform: EditableTransform;
      linkedTransforms?: LinkedMoveStart[] | undefined;
    },
    verb = "Move",
  ): void {
    const entries = [
      {
        selection: cloneSelection(drag.selection),
        before: drag.startTransform,
        after: this.captureTransform(drag.selection),
      },
      ...(drag.linkedTransforms ?? []).map((linked) => ({
        selection: cloneSelection(linked.selection),
        before: linked.startTransform,
        after: this.captureTransform(linked.selection),
      })),
    ];

    const changes: Array<{
      selection: Selection;
      before: EditableTransform;
      after: EditableTransform;
    }> = [];
    for (const entry of entries) {
      if (!entry.after || transformsEqual(entry.before, entry.after)) continue;
      changes.push({
        selection: entry.selection,
        before: entry.before,
        after: entry.after,
      });
    }

    if (changes.length === 0) return;
    const selections = changes.map((entry) => cloneSelection(entry.selection));
    const active = cloneSelection(drag.selection);

    this.executeCommand({
      label: `${verb} ${changes.length} objects`,
      redo: () => {
        this.selectMany(selections, active);
        for (const change of changes) this.applyTransform(change.selection, change.after);
      },
      undo: () => {
        this.selectMany(selections, active);
        for (const change of changes) this.applyTransform(change.selection, change.before);
      },
    });
  }

  private executeCommand(command: EditorCommand): void {
    this.editorSceneController.executeCommand(command);
  }

  private emitSelectionChanged(): void {
    this.onSelectionChanged?.(this.getSelected());
    this.emitSceneObjectsChanged();
  }

  private emitSceneObjectsChanged(): void {
    this.onSceneObjectsChanged?.(this.getSceneObjects());
  }

  private emitHistoryChanged(): void {
    this.onHistoryChanged?.(this.getHistoryState());
  }

  private emitWorldSettingsChanged(): void {
    this.onWorldSettingsChanged?.(this.getWorldSettings());
  }

  private staticObjectsCastShadow(): boolean {
    return resolveSceneWorldSettings(this.layout).staticObjectsCastShadow;
  }

  private staticObjectsReceiveShadow(): boolean {
    return resolveSceneWorldSettings(this.layout).staticObjectsReceiveShadow;
  }

  private backgroundColor(): string {
    return resolveSceneWorldSettings(this.layout).backgroundColor;
  }

  private ambientColor(): string {
    return resolveSceneWorldSettings(this.layout).ambientColor;
  }

  private ambientIntensity(): number {
    return resolveSceneWorldSettings(this.layout).ambientIntensity;
  }

  private gameMode(): string {
    return normalizeGameModeId(this.layout?.worldSettings?.gameMode);
  }

  private hasSelection(selection: Selection): boolean {
    if (!this.layout) return false;
    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      return Boolean(instance?.placements[selection.placementIndex]);
    }
    if (selection.kind === "light") return Boolean(this.layout.lights?.[selection.index]);
    return Boolean(this.layout.characters[selection.index]);
  }

  private handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const resetView = resizeSceneRuntimeViewport({
      camera: this.camera,
      renderer: this.renderer,
      width,
      height,
      viewTouched: this.cameraController.hasTouched,
    });
    this.selectionOutline?.setSize(width, height);
    if (resetView) {
      this.cameraController.syncAnglesFromCurrentView();
    }
  };
}
