/**
 * SceneApp - the single render-layer orchestrator (L11 boundary).
 *
 * three.js is imported ONLY under src/scene/. Game rules live in pure-TS
 * modules (M1-M9, src/core/...) and talk to this layer via the event bus.
 * This class owns: renderer, scene graph, camera rig, lights, frame loop.
 */
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Box3Helper,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import type { InstancedMesh, Intersection, PerspectiveCamera, WebGLRenderer } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AssetLoader } from "./assetLoader";
import { EngineApp } from "@engine/core/EngineApp";
import type { Subsystem } from "@engine/core/Subsystem";
import { AnimationSubsystem } from "@engine/render-three/animationSubsystem";
import { ActionMap, type ActionBindings } from "@engine/input/actionMap";
import { InputSubsystem } from "@engine/input/inputSubsystem";
import { BehaviorSubsystem } from "@engine/behavior/behaviorSubsystem";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { createBehaviorRegistry } from "@/game/behaviors";
import type { AssetManifest, EditableAsset } from "@engine/assets/manifest";
import {
  dirnameProjectPath,
  loadActiveProject,
  type ActiveProject,
} from "@/project/ProjectSystem";
import { loadRoomLayout } from "./roomLayout";
import {
  applyEulerDegrees,
  composePlacementMatrix,
  eulerDegrees,
} from "@engine/render-three/transforms";
import {
  collectMaterialStats,
  convertUnlitModelMaterialsToLit,
  isRenderableMesh,
} from "@engine/render-three/materials";
import {
  createCharacterSceneObject,
  createInstancedModelGroup,
  entityCharacterItem,
  entityInstanceItems,
} from "@engine/render-three/models";
import {
  createLightObject as createThreeLightObject,
  entityLightItem,
  syncLightObject,
  type LightObjectRecord,
} from "@engine/render-three/lights";
import {
  findParentCharacter,
  findParentInstancedMesh,
  findParentLight,
} from "@engine/render-three/picking";
import {
  applyResponsiveCameraViewport,
  createSceneCamera,
} from "@engine/render-three/camera";
import {
  createSceneRenderer,
  readRenderStats,
} from "@engine/render-three/renderer";
import {
  defaultLightIntensity,
  formatLightType,
  uniqueActorName,
} from "@engine/scene/lights";
import {
  degreesToRadians,
  readPivot,
  readRotation,
  readScale,
} from "@engine/scene/transform";
import type {
  LayoutCharacter,
  LayoutLightActor,
  LayoutPlacement,
  LayoutWorldSettings,
  MetadataValue,
  RoomLayout,
  Vec3,
} from "@engine/scene/layout";
import {
  characterEntity,
  instanceEntitiesForAsset,
  lightEntity,
  roomLayoutToSceneDocument,
} from "@engine/scene/legacyRoomLayoutAdapter";
import type { SceneDocument } from "@engine/scene/sceneDocument";
import type { TransformComponent } from "@engine/scene/components";
import {
  metadataValuesEqual,
  type MetadataSchema,
} from "@engine/scene/metadataSchema";
import {
  cloneCharacter,
  cloneLightActor,
  cloneMetadata,
  cloneMetadataValue,
  clonePlacement,
  cloneUngroupedCharacter,
  cloneUngroupedLightActor,
  cloneUngroupedPlacement,
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
import {
  defaultTrueFlagCommandLabel,
  flagCommandLabel,
  type EditorDefaultTrueFlagCommand,
  type EditorFlagCommand,
} from "@editor/core/commandLabels";
import type { EditorTool, TransformSpace } from "@editor/core/tools";
import {
  selectionToTransform,
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
  EditorCommandPhase,
  EditorHistoryState,
} from "@editor/core/history";
import { EditorCommandStore } from "@editor/core/history";
import {
  descendantSelections,
  groupedSelections,
} from "@editor/core/hierarchy";
import { uniqueEditorId } from "@editor/core/ids";
import {
  compareCharacterDeletes,
  compareCharacterRestores,
  compareInstanceDeletes,
  compareInstanceRestores,
  compareLightDeletes,
  compareLightRestores,
  cloneSelection,
  parseSelectionId,
  selectionId,
  selectionsEqual,
  type CharacterSelection,
  type InstanceSelection,
  type LightSelection,
  type Selection,
} from "@editor/core/selection";
import { SelectionStore } from "@editor/core/selectionStore";
import {
  axisToIndex,
  isPlaneAxis,
  planeAxisIndices,
  type GizmoAxis,
  type GizmoPlaneAxis,
  type GizmoVectorAxis,
} from "@editor/gizmos/axes";
import {
  createGizmoHandleMaterial,
  registerGizmoHandlePickables,
  type GizmoHandle,
} from "@editor/gizmos/handles";
import {
  calculateGizmoScreenScale,
  GizmoInteractionStore,
  pickGizmoHandle as pickGizmoHandleFromObjects,
  planeAxisNormalWorld,
  screenSpaceMoveBasis,
} from "@editor/gizmos/interaction";
import {
  isCameraNavigationKey,
  isEditableTarget,
} from "@editor/input/keyboard";
import {
  matrixToTransform,
  transformToMatrix,
} from "@editor/render-three/transformMatrices";

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

/** Perf budget: clamp DPR so 1080p+ phones don't render 3x fragments. */
const MAX_PIXEL_RATIO = 2;
const CAMERA_TARGET = new Vector3(0, 0.65, -0.2);
const CAMERA_MOVE_SPEED = 5.5;
const CAMERA_MIN_MOVE_SPEED = 0.8;
const CAMERA_MAX_MOVE_SPEED = 28;
const CAMERA_LOOK_SENSITIVITY = 0.003;
const CAMERA_PITCH_LIMIT = Math.PI * 0.47;
const CAMERA_ORBIT_SENSITIVITY = 0.006;
const CAMERA_PAN_SENSITIVITY = 0.0025;
const CAMERA_DOLLY_SENSITIVITY = 0.018;
const DEFAULT_STATIC_OBJECTS_CAST_SHADOWS = false;
const DEFAULT_STATIC_OBJECTS_RECEIVE_SHADOWS = true;
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_SUN_ID = "sun";
const DEFAULT_BACKGROUND_COLOR = "#d7d7c7";
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_INTENSITY = 0;

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

interface LinkedMoveStart {
  selection: Selection;
  startTransform: EditableTransform;
}

type CameraDrag =
  | {
      mode: "orbit";
      pointerId: number;
      target: Vector3;
      distance: number;
    }
  | {
      mode: "pan";
      pointerId: number;
    }
  | {
      mode: "dolly";
      pointerId: number;
    };

interface EditorOptions {
  enabled: boolean;
}

export class SceneApp {
  private renderer: WebGLRenderer;
  private scene = new Scene();
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
  };
  private readonly canvas: HTMLCanvasElement;
  private readonly editorEnabled: boolean;
  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly floorHit = new Vector3();
  private readonly pressedKeys = new Set<string>();
  private readonly cameraForward = new Vector3();
  private readonly cameraRight = new Vector3();
  private readonly cameraMove = new Vector3();
  private cameraNavigationActive = false;
  private cameraNavigationTouched = false;
  private cameraNavigationPointerId: number | null = null;
  private cameraYaw = 0;
  private cameraPitch = 0;
  private cameraMoveSpeed = CAMERA_MOVE_SPEED;
  private cameraDrag: CameraDrag | null = null;

  private manifest: AssetManifest | null = null;
  private metadataSchema: MetadataSchema | null = null;
  private layout: RoomLayout | null = null;
  private models = new Map<string, GLTF>();
  private instanceGroups = new Map<string, Group>();
  private instanceMeshes = new Map<string, InstancedMesh[]>();
  private characterObjects: Object3D[] = [];
  private lightObjects: LightObjectRecord[] = [];
  private localBounds = new Map<string, Box3>();
  private assetPlacements = new Map<string, EditableAsset["placement"]>();
  /** Owns the active selection + multi-select set (editor state, not runtime). */
  private readonly selectionStore = new SelectionStore();
  /** Active selection, delegating to the store so ownership lives there. */
  private get selection(): Selection | null {
    return this.selectionStore.activeSelection;
  }
  private set selection(value: Selection | null) {
    this.selectionStore.activeSelection = value;
  }
  private readonly selectionBoxes: Box3Helper[] = [];
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
  private pendingAssetId: string | null = null;
  private pointerDrag:
    | {
        mode: "move";
        axis: GizmoAxis;
        selection: Selection;
        offset: Vector3;
        pointerId: number;
        startTransform: EditableTransform;
        startPosition: [number, number, number];
        startClientX: number;
        startClientY: number;
        freeMoveRight?: Vector3 | undefined;
        freeMoveUp?: Vector3 | undefined;
        linkedTransforms?: LinkedMoveStart[] | undefined;
        movePlane?: Plane | undefined;
        planeStartHit?: Vector3 | undefined;
        /** When set, the move handles drag the pivot point instead of the object. */
        pivotEdit?: boolean | undefined;
        /** Inverse of the (fixed) object world matrix, to map dragged world → local pivot. */
        pivotMatrixInverse?: Matrix4 | undefined;
        /** Pivot value at drag start, for the undo step. */
        startPivot?: Vec3 | undefined;
      }
    | {
        mode: "rotate";
        axis: GizmoAxis;
        selection: Selection;
        pointerId: number;
        startTransform: EditableTransform;
        startClientX: number;
        startRotation: Vec3;
        linkedTransforms?: LinkedMoveStart[] | undefined;
        pivotWorld?: Vector3 | undefined;
        pivot?: Vec3 | undefined;
      }
    | {
        mode: "scale";
        axis: GizmoAxis;
        selection: Selection;
        pointerId: number;
        startTransform: EditableTransform;
        startClientX: number;
        startClientY: number;
        startScale: Vec3;
        linkedTransforms?: LinkedMoveStart[] | undefined;
        pivotWorld?: Vector3 | undefined;
        pivot?: Vec3 | undefined;
      }
    | null = null;
  private readonly commandStore = new EditorCommandStore();

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

    this.renderer = createSceneRenderer(canvas, MAX_PIXEL_RATIO);
    this.scene.background = new Color(0xd7d7c7);
    this.camera = createSceneCamera();

    this.gizmoGroup.name = "editor-transform-gizmo";
    this.gizmoGroup.visible = false;
    this.scene.add(this.gizmoGroup);

    // Register subsystems before scene load adds work to them (e.g. character
    // animations push mixers during loadActiveProjectScene) and before the
    // engine init()/start() that load triggers. Input advances before any later
    // behavior subsystem so behaviors read current-tick action state.
    this.engineApp.registerSubsystem(this.animationSubsystem);
    this.engineApp.registerSubsystem(this.inputSubsystem);
    // Registered after input so behaviors read current-tick action state.
    this.behaviorSubsystem = new BehaviorSubsystem(
      createBehaviorRegistry(),
      this.inputActions,
      this.syncEntityTransform,
    );
    this.engineApp.registerSubsystem(this.behaviorSubsystem);

    // Observer-only keyboard source: records raw codes into the action map in
    // both modes without consuming events, so editor shortcuts/camera nav are
    // untouched.
    this.keyboardInput.attach();

    this.projectReady = this.loadActiveProjectScene();

    if (this.editorEnabled) this.bindEditorPointerEvents();

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

      this.updateCameraNavigation(deltaSeconds);
      this.updateGizmoScreenScale();

      this.renderer.render(this.scene, this.camera);
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

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.keyboardInput.detach();
    // EngineApp.dispose() is async (subsystems may release async resources);
    // SceneApp.dispose() is sync, so fire-and-forget like the renderer teardown.
    void this.engineApp.dispose();
    this.renderer.dispose();
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return readRenderStats(this.renderer);
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
    return roomLayoutToSceneDocument(this.layout);
  }

  getSceneObjects(): EditableSceneObject[] {
    if (!this.layout) return [];

    const objects: EditableSceneObject[] = [];
    for (const instance of this.layout.instances) {
      instance.placements.forEach((placement, placementIndex) => {
        const selection: Selection = {
          kind: "instance",
          assetId: instance.assetId,
          placementIndex,
        };
        objects.push({
          id: selectionId(selection),
          kind: "instance",
          assetId: instance.assetId,
          category: this.assetCategory(instance.assetId),
          label: placement.name ?? `${instance.assetId} #${placementIndex + 1}`,
          position: [...placement.position],
          rotation: readRotation(placement),
          scale: readScale(placement),
          pivot: readPivot(placement),
          scaleLocked: placement.scaleLocked ?? false,
          selected: this.isSelectionSelected(selection),
          hidden: placement.hidden ?? false,
          locked: placement.locked ?? false,
          castShadow: this.staticObjectsCastShadow(),
          collision: placement.collision ?? true,
          metadata: {},
          groupId: placement.groupId,
          nodeId: placement.nodeId,
          parentId: placement.parentId,
        });
      });
    }

    this.layout.characters.forEach((character, index) => {
      const selection: Selection = { kind: "character", index };
      objects.push({
        id: selectionId(selection),
        kind: "character",
        assetId: character.assetId,
        category: this.assetCategory(character.assetId),
        label: character.name ?? `${character.assetId} #${index + 1}`,
        position: [...character.position],
        rotation: readRotation(character),
        scale: readScale(character),
        pivot: readPivot(character),
        scaleLocked: character.scaleLocked ?? false,
        selected: this.isSelectionSelected(selection),
        hidden: character.hidden ?? false,
        locked: character.locked ?? false,
        castShadow: character.castShadow ?? true,
        collision: character.collision ?? true,
        metadata: {},
        groupId: character.groupId,
        nodeId: character.nodeId,
        parentId: character.parentId,
      });
    });

    this.layout.lights?.forEach((light, index) => {
      const selection: Selection = { kind: "light", index };
      const sceneObject: EditableSceneObject = {
        id: selectionId(selection),
        kind: "light",
        assetId: light.type,
        category: "light",
        label: light.name ?? light.id,
        position: [...light.position],
        rotation: readRotation(light),
        scale: [1, 1, 1],
        pivot: [0, 0, 0],
        scaleLocked: true,
        selected: this.isSelectionSelected(selection),
        hidden: light.hidden ?? false,
        locked: light.locked ?? false,
        castShadow: light.castShadow ?? light.type === "directional",
        collision: false,
        metadata: {},
        groupId: light.groupId,
        nodeId: light.nodeId,
        parentId: light.parentId,
        lightType: light.type,
        color: light.color ?? DEFAULT_LIGHT_COLOR,
        intensity: light.intensity ?? defaultLightIntensity(light.type),
      };
      if (light.distance !== undefined) sceneObject.distance = light.distance;
      if (light.angle !== undefined) sceneObject.angle = light.angle;
      if (light.penumbra !== undefined) sceneObject.penumbra = light.penumbra;
      if (light.decay !== undefined) sceneObject.decay = light.decay;
      objects.push(sceneObject);
    });

    return objects;
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
    if (this.selectionStore.selectedCount > 1 && this.isSelectionSelected(selection)) {
      this.setSelectedHidden(hidden);
      return;
    }
    this.setSelectionFlag(selection, "hidden", hidden);
  }

  setSceneObjectLocked(id: string, locked: boolean): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (this.selectionStore.selectedCount > 1 && this.isSelectionSelected(selection)) {
      this.setSelectedLocked(locked);
      return;
    }
    this.setSelectionFlag(selection, "locked", locked);
  }

  getHistoryState(): EditorHistoryState {
    return this.commandStore.state();
  }

  undo(): void {
    const result = this.commandStore.undo();
    if (!result) return;
    this.emitHistoryChanged();
    this.onStatus?.(result.statusMessage, result.statusTone);
  }

  redo(): void {
    const result = this.commandStore.redo();
    if (!result) return;
    this.emitHistoryChanged();
    this.onStatus?.(result.statusMessage, result.statusTone);
  }

  setEditorTool(tool: EditorTool): void {
    this.activeTool = tool;
    this.pendingAssetId = null;
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
    return this.cameraNavigationActive || this.cameraDrag !== null;
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
      viewDirection.copy(CAMERA_TARGET).sub(this.camera.position).normalize();
    }

    const radius = box && !box.isEmpty() ? box.getSize(new Vector3()).length() * 0.5 : 0.8;
    const distance = clamp(radius * 1.8, 1.25, 4.2);
    this.camera.position.copy(target).addScaledVector(viewDirection, -distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.cameraNavigationTouched = true;
    this.syncCameraAnglesFromCurrentView();
    this.onStatus?.(`Focused ${selected.label}.`, "info");
  }

  setTechnicalView(view: "top" | "front" | "side"): void {
    const target = this.getCameraOrbitTarget();
    const distance = clamp(this.camera.position.distanceTo(target), 3, 10);
    this.cameraNavigationTouched = true;

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
    this.syncCameraAnglesFromCurrentView();
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
    const surfaceY = this.raycastSurfaceBelow(origin, this.selection);
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

  private raycastSurfaceBelow(origin: Vector3, exclude: Selection): number | null {
    const ray = new Raycaster(origin, new Vector3(0, -1, 0), 0, 1000);

    const pickables: Object3D[] = [];
    for (const meshes of this.instanceMeshes.values()) pickables.push(...meshes);
    pickables.push(...this.characterObjects);
    pickables.push(...this.lightObjects.map((entry) => entry.root));

    const hits = ray.intersectObjects(pickables, true);
    for (const hit of hits) {
      if (this.isSelfHit(hit, exclude)) continue;
      return hit.point.y;
    }
    return null;
  }

  private isSelfHit(hit: Intersection, selection: Selection): boolean {
    if (selection.kind === "instance") {
      const mesh = findParentInstancedMesh(hit.object);
      return Boolean(
        mesh &&
          String(mesh.userData.assetId ?? "") === selection.assetId &&
          hit.instanceId === selection.placementIndex,
      );
    }
    const character = findParentCharacter(hit.object);
    return character ? Number(character.userData.characterIndex) === selection.index : false;
  }

  /** End / "Snap" button entry: wall-snaps wall assets, otherwise surface-snaps. */
  snapSelected(): void {
    if (this.wallSnapSelected()) return;
    this.surfaceSnapSelected();
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

  /** Returns true when the selection is a wall asset (handled here, no surface fallback). */
  private wallSnapSelected(): boolean {
    if (!this.selection || this.selection.kind !== "instance") return false;
    if (!this.isWallAsset(this.selection.assetId)) return false;
    this.performWallSnap(this.selection);
    return true;
  }

  /** Slides and orients an instance flush against the nearest room wall. */
  private performWallSnap(selection: InstanceSelection): void {
    if (this.isSelectionLocked(selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    const before = this.captureTransform(selection);
    if (!before) return;
    const snap = this.computeWallSnap(
      selection.assetId,
      before.position,
      before.rotation[1],
      before.scale,
    );
    if (!snap) {
      this.onStatus?.("No room walls found to snap to.", "warning");
      return;
    }

    this.updateSelectedTransform({
      position: snap.position,
      rotation: [before.rotation[0], snap.rotationYDeg, before.rotation[2]],
    });
    this.commitTransformChange(selection, before, "Wall snap");
  }

  /**
   * Snaps a wall asset flush against the nearest of the room's four bounding
   * walls (derived from the room-shell world AABB) and orients it to face the
   * room interior. Returns the target transform, or null if no room is loaded.
   */
  private computeWallSnap(
    assetId: string,
    position: [number, number, number],
    currentRotationYDeg: number,
    scale: number | Vec3,
  ): { position: [number, number, number]; rotationYDeg: number } | null {
    const bounds = this.localBounds.get(assetId);
    const room = this.getRoomBounds();
    if (!bounds || !room) return null;

    const center = bounds
      .clone()
      .applyMatrix4(
        composePlacementMatrix({ position, rotationYDeg: currentRotationYDeg, scale }),
      )
      .getCenter(new Vector3());

    const toMinX = center.x - room.min.x;
    const toMaxX = room.max.x - center.x;
    const toMinZ = center.z - room.min.z;
    const toMaxZ = room.max.z - center.z;
    const nearest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);

    // Asset front assumed to face +Z; rotate so it faces the room interior.
    let rotationYDeg: number;
    let axis: "x" | "z";
    let wallCoord: number;
    let side: "min" | "max";
    if (nearest === toMinX) {
      rotationYDeg = 90;
      axis = "x";
      wallCoord = room.min.x;
      side = "min";
    } else if (nearest === toMaxX) {
      rotationYDeg = 270;
      axis = "x";
      wallCoord = room.max.x;
      side = "max";
    } else if (nearest === toMinZ) {
      rotationYDeg = 0;
      axis = "z";
      wallCoord = room.min.z;
      side = "min";
    } else {
      rotationYDeg = 180;
      axis = "z";
      wallCoord = room.max.z;
      side = "max";
    }

    // World box at the snapped rotation tells us how far to slide so the
    // back face sits flush against the wall (origin-agnostic).
    const probe = bounds
      .clone()
      .applyMatrix4(composePlacementMatrix({ position, rotationYDeg, scale }));
    const next: [number, number, number] = [...position];
    if (axis === "x") {
      next[0] = round(position[0] + (side === "min" ? wallCoord - probe.min.x : wallCoord - probe.max.x));
    } else {
      next[2] = round(position[2] + (side === "min" ? wallCoord - probe.min.z : wallCoord - probe.max.z));
    }
    return { position: next, rotationYDeg };
  }

  /** Fits the sun's shadow frustum to the room AABB so shadows stay crisp. */
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
      if (!this.isRoomAsset(instance.assetId)) continue;
      const bounds = this.localBounds.get(instance.assetId);
      if (!bounds) continue;
      for (const placement of instance.placements) {
        box.union(bounds.clone().applyMatrix4(composePlacementMatrix(placement)));
        found = true;
      }
    }
    return found ? box : null;
  }

  private isWallAsset(assetId: string): boolean {
    const placement = this.assetPlacements.get(assetId);
    return Boolean(placement && (placement.surface === "wall" || placement.snapToWall));
  }

  private isRoomAsset(assetId: string): boolean {
    return this.assetPlacements.get(assetId)?.surface === "room";
  }

  beginAssetPlacement(assetId: string): void {
    if (!this.models.has(assetId)) {
      this.onStatus?.(`Asset is still loading: ${assetId}`, "warning");
      return;
    }
    this.pendingAssetId = assetId;
    this.onStatus?.(`Placement armed: ${assetId}`, "info");
  }

  getSelected(): EditableSelection | null {
    if (!this.layout || !this.selection) return null;
    const selection = this.selection;
    if (selection.kind === "instance") {
      const instance = this.layout.instances.find(
        (entry) => entry.assetId === selection.assetId,
      );
      const placement = instance?.placements[selection.placementIndex];
      if (!placement) return null;
      return {
        id: selectionId(selection),
        kind: "instance",
        assetId: selection.assetId,
        category: this.assetCategory(selection.assetId),
        label: placement.name ?? `${selection.assetId} #${selection.placementIndex + 1}`,
        position: [...placement.position],
        rotation: readRotation(placement),
        scale: readScale(placement),
        pivot: readPivot(placement),
        scaleLocked: placement.scaleLocked ?? false,
        locked: placement.locked ?? false,
        castShadow: this.staticObjectsCastShadow(),
        collision: placement.collision ?? true,
        metadata: cloneMetadata(placement.metadata),
      };
    }

    if (selection.kind === "light") {
      const light = this.layout.lights?.[selection.index];
      if (!light) return null;
      const editable: EditableSelection = {
        id: selectionId(selection),
        kind: "light",
        assetId: light.type,
        category: "light",
        label: light.name ?? light.id,
        position: [...light.position],
        rotation: readRotation(light),
        scale: [1, 1, 1],
        pivot: [0, 0, 0],
        scaleLocked: true,
        locked: light.locked ?? false,
        castShadow: light.castShadow ?? light.type === "directional",
        collision: false,
        metadata: {},
        lightType: light.type,
        color: light.color ?? DEFAULT_LIGHT_COLOR,
        intensity: light.intensity ?? defaultLightIntensity(light.type),
      };
      if (light.distance !== undefined) editable.distance = light.distance;
      if (light.angle !== undefined) editable.angle = light.angle;
      if (light.penumbra !== undefined) editable.penumbra = light.penumbra;
      if (light.decay !== undefined) editable.decay = light.decay;
      return editable;
    }

    const character = this.layout.characters[selection.index];
    if (!character) return null;
    return {
      id: selectionId(selection),
      kind: "character",
      assetId: character.assetId,
      category: this.assetCategory(character.assetId),
      label: character.name ?? character.assetId,
      position: [...character.position],
      rotation: readRotation(character),
      scale: readScale(character),
      pivot: readPivot(character),
      scaleLocked: character.scaleLocked ?? false,
      locked: character.locked ?? false,
      castShadow: character.castShadow ?? true,
      collision: character.collision ?? true,
      metadata: cloneMetadata(character.metadata),
    };
  }

  /** Resolves an asset's manifest category for Details display. */
  private assetCategory(assetId: string): string {
    return this.manifest?.assets.find((entry) => entry.id === assetId)?.category ?? "";
  }

  captureSelectedTransform(): EditableTransform | null {
    if (!this.selection) return null;
    return this.captureTransform(this.selection);
  }

  commitSelectedTransform(before: EditableTransform | null, label = "Transform"): void {
    if (!before || !this.selection) return;
    this.commitTransformChange(this.selection, before, label);
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

  deleteSelected(): void {
    if (!this.layout) return;
    const selections = this.getSelectedSelections();
    if (selections.length === 0) return;

    const instanceDeletes: Array<{ selection: InstanceSelection; snapshot: LayoutPlacement }> = [];
    const characterDeletes: Array<{ selection: CharacterSelection; snapshot: LayoutCharacter }> = [];
    const lightDeletes: Array<{ selection: LightSelection; snapshot: LayoutLightActor }> = [];
    for (const selection of selections) {
      if (selection.kind === "instance") {
        const instance = this.layout?.instances.find((entry) => entry.assetId === selection.assetId);
        const placement = instance?.placements[selection.placementIndex];
        if (placement) {
          instanceDeletes.push({
            selection: cloneSelection(selection) as InstanceSelection,
            snapshot: clonePlacement(placement),
          });
        }
        continue;
      }

      if (selection.kind === "character") {
        const character = this.layout?.characters[selection.index];
        if (!character) continue;
        characterDeletes.push({
          selection: cloneSelection(selection) as CharacterSelection,
          snapshot: cloneCharacter(character),
        });
        continue;
      }

      const light = this.layout?.lights?.[selection.index];
      if (light) {
        lightDeletes.push({
          selection: cloneSelection(selection) as LightSelection,
          snapshot: cloneLightActor(light),
        });
      }
    }
    if (instanceDeletes.length + characterDeletes.length + lightDeletes.length === 0) return;

    const previousSelections = selections.map(cloneSelection);
    const previousActive = this.selection ? cloneSelection(this.selection) : null;
    this.executeCommand({
      label:
        selections.length === 1
          ? `Delete ${this.getSelectionLabel(selections[0]!)}`
          : `Delete ${selections.length} objects`,
      redo: () => {
        for (const entry of [...instanceDeletes].sort(compareInstanceDeletes)) {
          this.removeInstancePlacement(entry.selection.assetId, entry.selection.placementIndex);
        }
        for (const entry of [...characterDeletes].sort(compareCharacterDeletes)) {
          this.removeCharacterPlacement(entry.selection.index);
        }
        for (const entry of [...lightDeletes].sort(compareLightDeletes)) {
          this.removeLightActor(entry.selection.index);
        }
        this.select(null);
      },
      undo: () => {
        for (const entry of [...instanceDeletes].sort(compareInstanceRestores)) {
          this.insertInstancePlacement(
            entry.selection.assetId,
            entry.selection.placementIndex,
            entry.snapshot,
          );
        }
        for (const entry of [...characterDeletes].sort(compareCharacterRestores)) {
          this.insertCharacterPlacement(entry.selection.index, entry.snapshot);
        }
        for (const entry of [...lightDeletes].sort(compareLightRestores)) {
          this.insertLightActor(entry.selection.index, entry.snapshot);
        }
        this.selectMany(previousSelections, previousActive);
      },
    });
  }

  duplicateSelected(): void {
    const selections = this.getSelectedSelections();
    if (selections.length === 0) {
      this.onStatus?.("No selected object to duplicate.", "warning");
      return;
    }
    if (selections.length === 1) {
      this.duplicateSelection(selections[0]!);
      return;
    }

    this.duplicateSelections(selections);
  }

  hideSelected(): void {
    this.setSelectedHidden(true);
  }

  setSelectedHidden(hidden: boolean): void {
    this.setSelectionsFlag(
      this.getSelectedSelections(),
      "hidden",
      hidden,
      hidden ? "Hide selected" : "Show selected",
    );
  }

  setSelectedLocked(locked: boolean): void {
    this.setSelectionsFlag(
      this.getSelectedSelections(),
      "locked",
      locked,
      locked ? "Lock selected" : "Unlock selected",
    );
  }

  groupSelected(): void {
    const selections = this.getSelectedSelections();
    if (selections.length < 2) {
      this.onStatus?.("Select at least two objects to group.", "warning");
      return;
    }

    const groupId = this.createGroupId();
    const entries = selections.flatMap((selection) => {
      const target = this.getMutableTransform(selection);
      return target
        ? [
            {
              selection: cloneSelection(selection),
              previousGroupId: target.groupId,
            },
          ]
        : [];
    });
    if (entries.length < 2) {
      this.onStatus?.("Select at least two objects to group.", "warning");
      return;
    }

    const active = this.selection
      ? cloneSelection(this.selection)
      : cloneSelection(entries[0]!.selection);
    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyGroupId(
          entry.selection,
          mode === "redo" ? groupId : entry.previousGroupId,
          { notify: false },
        );
      }
      this.selectMany(
        entries.map((entry) => cloneSelection(entry.selection)),
        active,
      );
      this.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Group ${entries.length} objects`,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  /** Clears the group id from every member of any group in the current selection. */
  ungroupSelected(): void {
    const groupIds = new Set<string>();
    for (const selection of this.getSelectedSelections()) {
      const groupId = this.getMutableTransform(selection)?.groupId;
      if (groupId) groupIds.add(groupId);
    }
    if (groupIds.size === 0) {
      this.onStatus?.("Selection is not grouped.", "warning");
      return;
    }

    const entries = this.getAllSelections({ includeHidden: true }).flatMap((selection) => {
      const target = this.getMutableTransform(selection);
      return target?.groupId && groupIds.has(target.groupId)
        ? [{ selection: cloneSelection(selection), previousGroupId: target.groupId }]
        : [];
    });
    if (entries.length === 0) return;
    const active = this.selection ? cloneSelection(this.selection) : null;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyGroupId(
          entry.selection,
          mode === "redo" ? undefined : entry.previousGroupId,
          { notify: false },
        );
      }
      this.selectMany(entries.map((entry) => cloneSelection(entry.selection)), active);
      this.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Ungroup ${entries.length} objects`,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  /** Parents the other selected objects to the active selection (the parent). */
  parentSelectionToActive(): void {
    if (!this.selection) return;
    const parent = cloneSelection(this.selection);
    const parentTarget = this.getMutableTransform(parent);
    if (!parentTarget) return;

    // Cycle guard: an ancestor of the parent cannot become its child.
    const parentDescendantIds = new Set(
      this.descendantsOf(parent)
        .map((entry) => this.getMutableTransform(entry)?.nodeId)
        .filter((id): id is string => Boolean(id)),
    );

    const parentNodeId = parentTarget.nodeId ?? this.createNodeId();
    const children = this.getSelectedSelections().flatMap((selection) => {
      if (selectionsEqual(selection, parent)) return [];
      const target = this.getMutableTransform(selection);
      if (!target) return [];
      // Skip if this object is the parent's ancestor (would form a cycle).
      if (target.nodeId && parentDescendantIds.has(target.nodeId)) return [];
      if (target.parentId === parentNodeId) return [];
      return [{ selection: cloneSelection(selection), previousParentId: target.parentId }];
    });
    if (children.length === 0) {
      this.onStatus?.("Select children plus a parent (active) to parent.", "warning");
      return;
    }

    const hadParentNodeId = parentTarget.nodeId !== undefined;
    const apply = (mode: EditorCommandPhase): void => {
      const parentMut = this.getMutableTransform(parent);
      if (parentMut) {
        if (mode === "redo") parentMut.nodeId = parentNodeId;
        else if (!hadParentNodeId) delete parentMut.nodeId;
      }
      for (const child of children) {
        const target = this.getMutableTransform(child.selection);
        if (!target) continue;
        if (mode === "redo") target.parentId = parentNodeId;
        else if (child.previousParentId === undefined) delete target.parentId;
        else target.parentId = child.previousParentId;
      }
      this.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Parent ${children.length} to ${this.getSelectionLabel(parent)}`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
  }

  /**
   * Parents one or more objects (by scene-object id) to a target object.
   * Used by outliner drag-and-drop: drag child rows onto a parent row.
   * Cycle-safe (a target that is a descendant of a dragged object is skipped).
   */
  parentObjectsTo(childIds: string[], parentId: string): void {
    const parent = parseSelectionId(parentId);
    if (!parent || !this.hasSelection(parent)) return;
    const parentTarget = this.getMutableTransform(parent);
    if (!parentTarget) return;

    const parentNodeId = parentTarget.nodeId ?? this.createNodeId();
    const children = childIds.flatMap((childId) => {
      const selection = parseSelectionId(childId);
      if (!selection || !this.hasSelection(selection)) return [];
      if (selectionsEqual(selection, parent)) return [];
      const target = this.getMutableTransform(selection);
      if (!target) return [];
      // Cycle guard: the target cannot be a descendant of this child.
      const descendantIds = new Set(
        this.descendantsOf(selection)
          .map((entry) => this.getMutableTransform(entry)?.nodeId)
          .filter((id): id is string => Boolean(id)),
      );
      if (target.nodeId && descendantIds.has(parentNodeId)) return [];
      if (target.parentId === parentNodeId) return [];
      return [{ selection: cloneSelection(selection), previousParentId: target.parentId }];
    });
    if (children.length === 0) return;

    const hadParentNodeId = parentTarget.nodeId !== undefined;
    const apply = (mode: EditorCommandPhase): void => {
      const parentMut = this.getMutableTransform(parent);
      if (parentMut) {
        if (mode === "redo") parentMut.nodeId = parentNodeId;
        else if (!hadParentNodeId) delete parentMut.nodeId;
      }
      for (const child of children) {
        const target = this.getMutableTransform(child.selection);
        if (!target) continue;
        if (mode === "redo") target.parentId = parentNodeId;
        else if (child.previousParentId === undefined) delete target.parentId;
        else target.parentId = child.previousParentId;
      }
      this.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Parent ${children.length} to ${this.getSelectionLabel(parent)}`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
  }

  /** Clears the parent of every selected object. */
  unparentSelected(): void {
    const entries = this.getSelectedSelections().flatMap((selection) => {
      const target = this.getMutableTransform(selection);
      return target?.parentId !== undefined
        ? [{ selection: cloneSelection(selection), previousParentId: target.parentId }]
        : [];
    });
    if (entries.length === 0) {
      this.onStatus?.("Selection has no parent.", "warning");
      return;
    }

    const apply = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        const target = this.getMutableTransform(entry.selection);
        if (!target) continue;
        if (mode === "redo") delete target.parentId;
        else target.parentId = entry.previousParentId;
      }
      this.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Unparent ${entries.length} objects`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
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
    const hiddenSelections = this
      .getAllSelections({ includeHidden: true })
      .filter((selection) => this.getMutableTransform(selection)?.hidden);
    this.setSelectionsFlag(hiddenSelections, "hidden", false, "Show hidden objects");
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

  addAssetAt(assetId: string, clientX: number, clientY: number): void {
    if (!this.layout || !this.models.has(assetId)) return;
    const hit = this.clientToSurface(clientX, clientY);
    if (!hit) return;

    const x = snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled);
    const z = snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled);
    const bounds = this.localBounds.get(assetId);
    // Rest the model's base on the surface; bounds.min.y * scale is the offset
    // from the model origin down to its lowest point (y is unaffected by Y rotation).
    const baseY = (scale: number): number =>
      round(hit.y - (bounds ? bounds.min.y * scale : 0));

    const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
    if (asset?.category === "customer-character") {
      const characterScale = 0.42;
      const character: LayoutCharacter = {
        assetId,
        name: assetId,
        position: [x, baseY(characterScale), z],
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

    const placement: LayoutPlacement = {
      position: [x, baseY(1), z],
      rotationYDeg: snapValue(0, this.snapSettings.rotate, this.snapSettings.rotateEnabled),
      scale: 1,
    };

    // Wall assets dropped near a wall mount flush against it, facing the room.
    if (this.isWallAsset(assetId)) {
      const snap = this.computeWallSnap(assetId, placement.position, placement.rotationYDeg ?? 0, 1);
      if (snap) {
        placement.position = snap.position;
        placement.rotationYDeg = snap.rotationYDeg;
      }
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

  async saveLayout(): Promise<void> {
    if (!this.layout) throw new Error("Layout is not loaded yet.");
    const response = await fetch("/__save-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout: this.layout,
        editor: {
          gridSize: this.snapSettings.move,
          gridEnabled: this.snapSettings.moveEnabled,
          snapRotationDeg: this.snapSettings.rotate,
          snapRotationEnabled: this.snapSettings.rotateEnabled,
          snapScale: this.snapSettings.scale,
          snapScaleEnabled: this.snapSettings.scaleEnabled,
        },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      path?: string;
    };
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Save failed: HTTP ${response.status}`);
    }
    this.onStatus?.(`Saved ${body.path ?? "layout"}.`, "success");
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
    this.models = await this.assetLoader.loadGroups(this.layout.loadGroups);
    const convertedUnlitMaterials = convertUnlitModelMaterialsToLit(this.models);
    this.localBounds.clear();

    for (const [assetId, gltf] of this.models) {
      gltf.scene.updateMatrixWorld(true);
      this.localBounds.set(assetId, new Box3().setFromObject(gltf.scene));
    }

    this.assetPlacements.clear();
    for (const asset of await this.assetLoader.loadEditableAssets()) {
      this.assetPlacements.set(asset.id, asset.placement);
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

    // Derive the runtime entity set once and hand it to the behavior subsystem.
    // SceneDocument starts acting as a runtime source of truth here: behaviors
    // mutate per-entity transform copies, synced back to the rendered objects
    // each tick via syncEntityTransform.
    this.behaviorSubsystem.setEntities(this.getSceneDocument().entities);

    // Bring the engine-core spine online now that the scene is fully built.
    // The rAF loop's engineApp.update() has been ticking the registry since
    // start(); behaviors only have entities to act on from here.
    await this.engineApp.init();
    await this.engineApp.start();
  }

  private createInstancedModel(assetId: string, placements: LayoutPlacement[]): Group {
    const gltf = this.models.get(assetId);
    if (!gltf) throw new Error(`Render test asset missing: ${assetId}`);

    // Static mesh instances now flow through the entity/component model: the
    // layout placements are derived into instance entities, then into render
    // items. Matrices match the legacy placement path (same composeTransformMatrix).
    const items = entityInstanceItems(instanceEntitiesForAsset(assetId, placements));
    const { group, meshes } = createInstancedModelGroup({
      assetId,
      gltf,
      items,
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
        intensity: 2.0,
        castShadow: true,
      },
    ];
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
      color: DEFAULT_LIGHT_COLOR,
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
    record.root.userData.lightIndex = this.lightObjects.length;
    record.root.traverse((child) => {
      child.userData.lightIndex = this.lightObjects.length;
    });
    this.scene.add(record.root);
    if (record.target) this.scene.add(record.target);
    this.lightObjects.push(record);
    if (actor.type === "directional" && (!this.sun || actor.id === DEFAULT_SUN_ID)) {
      this.sun = record.light as DirectionalLight;
    }
    this.refreshLightObject(this.lightObjects.length - 1);
  }

  private createLightObject(actor: LayoutLightActor, index: number): LightObjectRecord {
    // Light objects now flow through the entity/component model: the layout
    // actor is derived into a scene entity, then into a render item. Inputs
    // match the legacy actor path (same transform/light component round-trip).
    return createThreeLightObject(entityLightItem(lightEntity(index, actor)), DEFAULT_LIGHT_COLOR);
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
    if (actor.type === "directional" && (!this.sun || actor.id === DEFAULT_SUN_ID)) {
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
      defaultColor: DEFAULT_LIGHT_COLOR,
      selected: this.isLightSelected(index),
    });
  }

  private duplicateSelection(selection: Selection): Selection | null {
    if (!this.layout || !this.hasSelection(selection)) return null;

    if (selection.kind === "instance") {
      const transform = this.getMutableTransform(selection);
      if (!transform) return null;
      const snapshot = clonePlacement(transform);
      delete snapshot.groupId;
      delete snapshot.nodeId;
      const duplicateIndex = selection.placementIndex + 1;
      const duplicateSelection: Selection = {
        kind: "instance",
        assetId: selection.assetId,
        placementIndex: duplicateIndex,
      };
      this.executeCommand({
        label: `Duplicate ${selection.assetId}`,
        redo: () => {
          this.insertInstancePlacement(selection.assetId, duplicateIndex, snapshot);
          this.select(duplicateSelection);
        },
        undo: () => {
          this.removeInstancePlacement(selection.assetId, duplicateIndex);
          this.select(selection);
        },
      });
      return duplicateSelection;
    }

    if (selection.kind === "light") {
      const light = this.layout.lights?.[selection.index];
      if (!light) return null;
      const snapshot = cloneLightActor(light);
      snapshot.id = this.createLightId(light.type);
      snapshot.name = uniqueActorName(light.name ?? light.id, this.layout.lights ?? []);
      delete snapshot.groupId;
      delete snapshot.nodeId;
      const duplicateIndex = selection.index + 1;
      const duplicateSelection: Selection = { kind: "light", index: duplicateIndex };
      this.executeCommand({
        label: `Duplicate ${light.name ?? light.id}`,
        redo: () => {
          this.insertLightActor(duplicateIndex, snapshot);
          this.select(duplicateSelection);
        },
        undo: () => {
          this.removeLightActor(duplicateIndex);
          this.select(selection);
        },
      });
      return duplicateSelection;
    }

    const character = this.layout.characters[selection.index];
    if (!character) return null;
    const snapshot = cloneCharacter(character);
    delete snapshot.groupId;
    delete snapshot.nodeId;
    const duplicateIndex = selection.index + 1;
    const duplicateSelection: Selection = { kind: "character", index: duplicateIndex };
    this.executeCommand({
      label: `Duplicate ${character.name ?? character.assetId}`,
      redo: () => {
        this.insertCharacterPlacement(duplicateIndex, snapshot);
        this.select(duplicateSelection);
      },
      undo: () => {
        this.removeCharacterPlacement(duplicateIndex);
        this.select(selection);
      },
    });
    return duplicateSelection;
  }

  private duplicateSelectionForDrag(selection: Selection): Selection | null {
    const selections = this.getSelectedSelections();
    if (selections.length > 1 && selections.some((entry) => selectionsEqual(entry, selection))) {
      return this.duplicateSelections(selections);
    }
    return this.duplicateSelection(selection);
  }

  private duplicateSelections(selections: Selection[]): Selection | null {
    if (!this.layout) return null;

    const previousSelections = selections.map(cloneSelection);
    const previousActive = this.selection ? cloneSelection(this.selection) : null;
    const inserts: Array<{
      source: Selection;
      selection: Selection;
      snapshot: LayoutPlacement | LayoutCharacter | LayoutLightActor;
    }> = [];

    const instancesByAsset = new Map<string, Selection[]>();
    for (const selection of selections) {
      if (selection.kind !== "instance") continue;
      const entries = instancesByAsset.get(selection.assetId) ?? [];
      entries.push(cloneSelection(selection));
      instancesByAsset.set(selection.assetId, entries);
    }

    for (const [assetId, entries] of instancesByAsset) {
      entries.sort((left, right) => {
        if (left.kind !== "instance" || right.kind !== "instance") return 0;
        return left.placementIndex - right.placementIndex;
      });
      entries.forEach((selection, offset) => {
        if (selection.kind !== "instance") return;
        const transform = this.getMutableTransform(selection);
        if (!transform) return;
        const duplicateSelection: Selection = {
          kind: "instance",
          assetId,
          placementIndex: selection.placementIndex + offset + 1,
        };
        inserts.push({
          source: cloneSelection(selection),
          selection: duplicateSelection,
          snapshot: cloneUngroupedPlacement(transform),
        });
      });
    }

    const characterSelections = selections
      .filter((selection): selection is CharacterSelection => selection.kind === "character")
      .map((selection) => cloneSelection(selection) as CharacterSelection)
      .sort((left, right) => left.index - right.index);
    characterSelections.forEach((selection, offset) => {
      const character = this.layout?.characters[selection.index];
      if (!character) return;
      inserts.push({
        source: cloneSelection(selection),
        selection: { kind: "character", index: selection.index + offset + 1 },
        snapshot: cloneUngroupedCharacter(character),
      });
    });

    const lightSelections = selections
      .filter((selection): selection is LightSelection => selection.kind === "light")
      .map((selection) => cloneSelection(selection) as LightSelection)
      .sort((left, right) => left.index - right.index);
    lightSelections.forEach((selection, offset) => {
      const light = this.layout?.lights?.[selection.index];
      if (!light) return;
      const snapshot = cloneUngroupedLightActor(light);
      snapshot.id = this.createLightId(light.type);
      snapshot.name = uniqueActorName(light.name ?? light.id, this.layout?.lights ?? []);
      inserts.push({
        source: cloneSelection(selection),
        selection: { kind: "light", index: selection.index + offset + 1 },
        snapshot,
      });
    });

    if (inserts.length === 0) return null;

    const duplicateSelections = inserts.map((entry) => cloneSelection(entry.selection));
    const activeDuplicate =
      (previousActive &&
        inserts.find((entry) => selectionsEqual(entry.source, previousActive))?.selection) ??
      duplicateSelections.at(-1) ??
      null;

    this.executeCommand({
      label: `Duplicate ${inserts.length} objects`,
      redo: () => {
        for (const entry of inserts) {
          if (entry.selection.kind === "instance") {
            this.insertInstancePlacement(
              entry.selection.assetId,
              entry.selection.placementIndex,
              entry.snapshot as LayoutPlacement,
            );
          } else if (entry.selection.kind === "character") {
            this.insertCharacterPlacement(
              entry.selection.index,
              entry.snapshot as LayoutCharacter,
            );
          } else {
            this.insertLightActor(entry.selection.index, entry.snapshot as LayoutLightActor);
          }
        }
        this.selectMany(
          duplicateSelections,
          activeDuplicate ? cloneSelection(activeDuplicate) : null,
        );
      },
      undo: () => {
        for (const entry of [...inserts].reverse()) {
          if (entry.selection.kind === "instance") {
            this.removeInstancePlacement(entry.selection.assetId, entry.selection.placementIndex);
          } else if (entry.selection.kind === "character") {
            this.removeCharacterPlacement(entry.selection.index);
          } else {
            this.removeLightActor(entry.selection.index);
          }
        }
        this.selectMany(previousSelections, previousActive);
      },
    });
    return activeDuplicate ? cloneSelection(activeDuplicate) : null;
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
    if (!this.selection || !this.hasSelection(this.selection)) return;
    this.setSelectionFlag(this.selection, "scaleLocked", value);
  }

  /** Details "Cast Shadow" toggle for the active selection (default on). */
  setSelectionCastShadow(value: boolean): void {
    if (!this.selection || !this.hasSelection(this.selection)) return;
    if (this.selection.kind !== "character") {
      this.onStatus?.("Cast Shadow is controlled centrally for static objects.", "info");
      return;
    }
    this.setSelectionDefaultTrueFlag(this.selection, "castShadow", value);
  }

  /** Details "Collision" toggle for the active selection (default on). */
  setSelectionCollision(value: boolean): void {
    if (!this.selection || !this.hasSelection(this.selection)) return;
    if (this.selection.kind === "light") return;
    this.setSelectionDefaultTrueFlag(this.selection, "collision", value);
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
    if (!this.selection || !this.hasSelection(this.selection)) return;
    if (this.selection.kind === "light") return;
    const target = this.getMutableTransform(this.selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!target) return;
    const previous = cloneMetadataValue(target.metadata?.[key]);
    if (metadataValuesEqual(previous, value)) return;

    const commandSelection = cloneSelection(this.selection);
    this.executeCommand({
      label: label ?? `Set ${key}`,
      redo: () => this.applyMetadataValue(commandSelection, key, value),
      undo: () => this.applyMetadataValue(commandSelection, key, previous),
    });
  }

  private applyMetadataValue(
    selection: Selection,
    key: string,
    value: MetadataValue | undefined,
  ): void {
    if (selection.kind === "light") return;
    const target = this.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!target) return;
    if (value === undefined) {
      if (target.metadata) {
        delete target.metadata[key];
        if (Object.keys(target.metadata).length === 0) delete target.metadata;
      }
    } else {
      target.metadata ??= {};
      target.metadata[key] = cloneMetadataValue(value) as MetadataValue;
    }
    this.emitSelectionChanged();
  }

  /**
   * Sets a default-true boolean placement field (castShadow/collision) with
   * undo/redo. The absent key means true, so the default value is omitted on
   * save and only the deviation (false) is stored.
   */
  private setSelectionDefaultTrueFlag(
    selection: Selection,
    field: EditorDefaultTrueFlagCommand,
    value: boolean,
  ): void {
    if (selection.kind === "light") return;
    const target = this.getMutableTransform(selection) as LayoutPlacement | LayoutCharacter | null;
    if (!target) return;
    const previous = target[field] ?? true;
    if (previous === value) return;

    const label = defaultTrueFlagCommandLabel(field, value);
    const commandSelection = cloneSelection(selection);

    this.executeCommand({
      label,
      redo: () => this.applyDefaultTrueFlag(commandSelection, field, value),
      undo: () => this.applyDefaultTrueFlag(commandSelection, field, previous),
    });
  }

  private applyDefaultTrueFlag(
    selection: Selection,
    field: EditorDefaultTrueFlagCommand,
    value: boolean,
  ): void {
    if (selection.kind === "light") return;
    const target = this.getMutableTransform(selection) as LayoutPlacement | LayoutCharacter | null;
    if (!target) return;
    if (value) delete target[field];
    else target[field] = false;
    if (field === "castShadow") this.applyCastShadow(selection);
    this.emitSelectionChanged();
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

    if (settings.staticObjectsCastShadow === DEFAULT_STATIC_OBJECTS_CAST_SHADOWS) {
      delete worldSettings.staticObjectsCastShadow;
    } else {
      worldSettings.staticObjectsCastShadow = settings.staticObjectsCastShadow;
    }

    if (settings.staticObjectsReceiveShadow === DEFAULT_STATIC_OBJECTS_RECEIVE_SHADOWS) {
      delete worldSettings.staticObjectsReceiveShadow;
    } else {
      worldSettings.staticObjectsReceiveShadow = settings.staticObjectsReceiveShadow;
    }

    if (settings.backgroundColor.toLowerCase() === DEFAULT_BACKGROUND_COLOR) {
      delete worldSettings.backgroundColor;
    } else {
      worldSettings.backgroundColor = settings.backgroundColor;
    }

    if (settings.ambientColor.toLowerCase() === DEFAULT_AMBIENT_COLOR) {
      delete worldSettings.ambientColor;
    } else {
      worldSettings.ambientColor = settings.ambientColor;
    }

    if (settings.ambientIntensity === DEFAULT_AMBIENT_INTENSITY) {
      delete worldSettings.ambientIntensity;
    } else {
      worldSettings.ambientIntensity = settings.ambientIntensity;
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
      this.ambientLight.name = "editor-ambient-light";
      this.scene.add(this.ambientLight);
    } else {
      this.ambientLight.color.set(this.ambientColor());
      this.ambientLight.intensity = intensity;
    }
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

  private setSelectionFlag(
    selection: Selection,
    flag: EditorFlagCommand,
    value: boolean,
  ): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    const previous = Boolean(target[flag]);
    if (previous === value) return;

    const label = flagCommandLabel(flag, value);

    this.executeCommand({
      label,
      redo: () => this.applyFlag(selection, flag, value),
      undo: () => this.applyFlag(selection, flag, previous),
    });
  }

  private setSelectionsFlag(
    selections: Selection[],
    flag: EditorFlagCommand,
    value: boolean,
    label: string,
  ): void {
    const entries = selections.flatMap((selection) => {
      const target = this.getMutableTransform(selection);
      return target
        ? [{ selection: cloneSelection(selection), previous: Boolean(target[flag]) }]
        : [];
    });
    if (entries.length === 0) {
      this.onStatus?.("No matching objects.", "warning");
      return;
    }
    if (entries.every((entry) => entry.previous === value)) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyFlag(
          entry.selection,
          flag,
          mode === "redo" ? value : entry.previous,
          { notify: false },
        );
      }
      this.updateSelectionBox();
      this.updateGizmo();
      this.emitSelectionChanged();
    };

    this.executeCommand({
      label,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  private applyFlag(
    selection: Selection,
    flag: EditorFlagCommand,
    value: boolean,
    options: { notify?: boolean } = {},
  ): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    if (value) target[flag] = true;
    else delete target[flag];

    if (flag === "hidden") this.applyVisibility(selection);
    this.updateSelectionBox();
    this.updateGizmo();
    if (options.notify !== false) this.emitSelectionChanged();
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

  private createGroupId(): string {
    const existing = new Set<string>();
    for (const selection of this.getAllSelections({ includeHidden: true })) {
      const groupId = this.getMutableTransform(selection)?.groupId;
      if (groupId) existing.add(groupId);
    }

    return uniqueEditorId("group", existing, 10_000);
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
    // Character objects now flow through the entity/component model: the layout
    // character is derived into a scene entity, then into a render item. Inputs
    // match the legacy placement path (same readRotation/readScale transform).
    return createCharacterSceneObject(gltf, entityCharacterItem(characterEntity(index, placement)));
  }

  private playCharacterAnimation(
    character: Object3D,
    gltf: GLTF,
    animationName: string | undefined,
  ): void {
    const idle = animationName
      ? gltf.animations.find((clip) => clip.name === animationName)
      : null;
    if (idle) {
      const mixer = new AnimationMixer(character);
      mixer.clipAction(idle).play();
      this.animationSubsystem.add(mixer);
    }
  }

  private refreshCharacterIndices(): void {
    this.characterObjects.forEach((object, index) => {
      object.userData.characterIndex = index;
    });
  }

  private bindEditorPointerEvents(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.altKey) {
        const gizmoHandle = this.pickGizmoHandle(event.clientX, event.clientY);
        if (event.button === 0 && gizmoHandle && this.selection) {
          this.startGizmoDrag(gizmoHandle, event);
          return;
        }
        if (this.beginAltCameraDrag(event)) return;
      }

      // Middle mouse button = pan (no Alt required).
      if (event.button === 1) {
        this.beginAltCameraDrag(event);
        return;
      }

      if (event.button === 2) {
        this.beginCameraNavigation(event);
        return;
      }

      if (this.pendingAssetId) {
        this.addAssetAt(this.pendingAssetId, event.clientX, event.clientY);
        this.pendingAssetId = null;
        return;
      }

      const gizmoHandle = this.pickGizmoHandle(event.clientX, event.clientY);
      if (gizmoHandle && this.selection) {
        this.startGizmoDrag(gizmoHandle, event);
        return;
      }

      const picked = this.pickSelection(event.clientX, event.clientY);
      if (event.ctrlKey || event.shiftKey) {
        if (picked) this.toggleSelection(picked);
        return;
      }

      if (picked) {
        this.select(picked);
      } else {
        this.select(null);
      }
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (this.cameraNavigationActive && this.cameraNavigationPointerId === event.pointerId) {
        this.updateCameraLook(event.movementX, event.movementY);
        return;
      }

      if (this.cameraDrag?.pointerId === event.pointerId) {
        this.updateCameraDrag(event);
        return;
      }

      if (!this.pointerDrag) {
        this.updateGizmoHover(event.clientX, event.clientY);
        return;
      }
      if (this.pointerDrag.pointerId !== event.pointerId) return;
      const selected = this.getSelected();
      if (!selected) return;

      if (this.pointerDrag.mode === "move") {
        this.updateMoveDrag(event, selected);
      } else if (this.pointerDrag.mode === "rotate") {
        this.updateRotateDrag(event);
      } else {
        this.updateScaleDrag(event);
      }
    });

    const clearDrag = (event: PointerEvent) => {
      if (this.cameraNavigationPointerId === event.pointerId) {
        this.endCameraNavigation(event);
      }
      if (this.cameraDrag?.pointerId === event.pointerId) {
        this.endCameraDrag(event);
      }
      if (this.pointerDrag?.pointerId === event.pointerId) {
        const drag = this.pointerDrag;
        this.pointerDrag = null;
        this.gizmoInteraction.endDrag();
        this.canvas.releasePointerCapture(event.pointerId);
        if (drag.mode === "move" && drag.pivotEdit) {
          this.commitPivotChange(
            drag.selection,
            drag.startPivot ?? [0, 0, 0],
            this.getSelectionPivot(drag.selection),
          );
        } else if (drag.linkedTransforms?.length) {
          const verb =
            drag.mode === "rotate" ? "Rotate" : drag.mode === "scale" ? "Scale" : "Move";
          this.commitLinkedMoveChange(drag, verb);
        } else {
          this.commitTransformChange(drag.selection, drag.startTransform);
        }
        this.updateGizmo();
      }
    };
    this.canvas.addEventListener("pointerup", clearDrag);
    this.canvas.addEventListener("pointercancel", clearDrag);
    this.canvas.addEventListener("pointerleave", () => this.clearGizmoHover());
    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);

    this.canvas.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
    });
    this.canvas.addEventListener("drop", (event) => {
      event.preventDefault();
      const assetId = event.dataTransfer?.getData("application/x-3dgamedev-asset");
      if (!assetId) return;
      this.addAssetAt(assetId, event.clientX, event.clientY);
    });
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  private beginCameraNavigation(event: PointerEvent): void {
    event.preventDefault();
    this.cameraNavigationActive = true;
    this.cameraNavigationTouched = true;
    this.cameraNavigationPointerId = event.pointerId;
    this.camera.up.set(0, 1, 0);
    this.pointerDrag = null;
    this.pendingAssetId = null;
    this.canvas.style.cursor = "none";
    this.onStatus?.("Camera navigation");
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic tests and a few browser edge cases can reject capture.
    }
  }

  private endCameraNavigation(event: PointerEvent): void {
    this.cameraNavigationActive = false;
    this.cameraNavigationPointerId = null;
    this.pressedKeys.clear();
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Matching beginCameraNavigation: capture may not exist for synthetic events.
    }
    this.canvas.style.cursor = "";
  }

  private beginAltCameraDrag(event: PointerEvent): boolean {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return false;
    event.preventDefault();
    this.cameraNavigationTouched = true;
    this.pointerDrag = null;
    this.pendingAssetId = null;

    if (event.button === 0) {
      this.camera.up.set(0, 1, 0);
      const target = this.getCameraOrbitTarget();
      this.cameraDrag = {
        mode: "orbit",
        pointerId: event.pointerId,
        target,
        distance: Math.max(0.3, this.camera.position.distanceTo(target)),
      };
      this.canvas.style.cursor = "grabbing";
      this.onStatus?.("Camera orbit");
    } else if (event.button === 1) {
      this.cameraDrag = { mode: "pan", pointerId: event.pointerId };
      this.canvas.style.cursor = "move";
      this.onStatus?.("Camera pan");
    } else {
      this.camera.up.set(0, 1, 0);
      this.cameraDrag = { mode: "dolly", pointerId: event.pointerId };
      this.canvas.style.cursor = "ns-resize";
      this.onStatus?.("Camera dolly");
    }

    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be unavailable in synthetic events.
    }
    return true;
  }

  private updateCameraDrag(event: PointerEvent): void {
    if (!this.cameraDrag) return;
    event.preventDefault();
    this.cameraNavigationTouched = true;

    if (this.cameraDrag.mode === "orbit") {
      this.cameraYaw -= event.movementX * CAMERA_ORBIT_SENSITIVITY;
      this.cameraPitch = clamp(
        this.cameraPitch - event.movementY * CAMERA_ORBIT_SENSITIVITY,
        -CAMERA_PITCH_LIMIT,
        CAMERA_PITCH_LIMIT,
      );
      const lookDirection = this.getCameraLookDirection();
      this.camera.position
        .copy(this.cameraDrag.target)
        .addScaledVector(lookDirection, -this.cameraDrag.distance);
      this.camera.lookAt(this.cameraDrag.target);
      this.syncCameraAnglesFromCurrentView();
      return;
    }

    if (this.cameraDrag.mode === "pan") {
      const distanceScale = Math.max(1, this.getCameraOrbitTarget().distanceTo(this.camera.position));
      const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
      const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
      this.camera.position
        .addScaledVector(right, -event.movementX * CAMERA_PAN_SENSITIVITY * distanceScale)
        .addScaledVector(up, event.movementY * CAMERA_PAN_SENSITIVITY * distanceScale);
      return;
    }

    this.dollyCamera(event.movementY * CAMERA_DOLLY_SENSITIVITY);
  }

  private endCameraDrag(event: PointerEvent): void {
    this.cameraDrag = null;
    this.syncCameraAnglesFromCurrentView();
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be gone.
    }
    this.canvas.style.cursor = "";
  }

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.cameraNavigationActive) {
      this.adjustCameraMoveSpeed(event.deltaY);
      return;
    }

    this.cameraNavigationTouched = true;
    this.dollyCamera(event.deltaY * CAMERA_DOLLY_SENSITIVITY);
  };

  private updateCameraLook(movementX: number, movementY: number): void {
    this.cameraYaw -= movementX * CAMERA_LOOK_SENSITIVITY;
    this.cameraPitch = clamp(
      this.cameraPitch - movementY * CAMERA_LOOK_SENSITIVITY,
      -CAMERA_PITCH_LIMIT,
      CAMERA_PITCH_LIMIT,
    );
    this.applyCameraOrientation();
  }

  private getCameraLookDirection(): Vector3 {
    return new Vector3(
      -Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      Math.sin(this.cameraPitch),
      -Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
    ).normalize();
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

  private dollyCamera(amount: number): void {
    const direction = new Vector3();
    this.camera.getWorldDirection(direction);
    if (direction.lengthSq() === 0) return;
    this.camera.position.addScaledVector(direction.normalize(), -amount);
  }

  private adjustCameraMoveSpeed(deltaY: number): void {
    const factor = deltaY < 0 ? 1.15 : 1 / 1.15;
    this.cameraMoveSpeed = clamp(
      this.cameraMoveSpeed * factor,
      CAMERA_MIN_MOVE_SPEED,
      CAMERA_MAX_MOVE_SPEED,
    );
    this.onStatus?.(`Camera speed ${this.cameraMoveSpeed.toFixed(1)}`, "info");
  }

  private updateCameraNavigation(deltaSeconds: number): void {
    if (!this.cameraNavigationActive || this.pressedKeys.size === 0) return;

    this.getCameraBasis();
    this.cameraMove.set(0, 0, 0);

    if (this.pressedKeys.has("KeyW")) this.cameraMove.add(this.cameraForward);
    if (this.pressedKeys.has("KeyS")) this.cameraMove.sub(this.cameraForward);
    if (this.pressedKeys.has("KeyD")) this.cameraMove.add(this.cameraRight);
    if (this.pressedKeys.has("KeyA")) this.cameraMove.sub(this.cameraRight);
    if (this.pressedKeys.has("KeyE")) this.cameraMove.y += 1;
    if (this.pressedKeys.has("KeyQ")) this.cameraMove.y -= 1;

    if (this.cameraMove.lengthSq() === 0) return;
    this.cameraMove.normalize().multiplyScalar(this.cameraMoveSpeed * deltaSeconds);
    this.camera.position.add(this.cameraMove);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.cameraNavigationActive || isEditableTarget(event.target)) return;
    if (!isCameraNavigationKey(event.code)) return;
    event.preventDefault();
    this.pressedKeys.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (!isCameraNavigationKey(event.code)) return;
    this.pressedKeys.delete(event.code);
  };

  private getCameraBasis(): void {
    this.camera.getWorldDirection(this.cameraForward);
    this.cameraForward.y = 0;
    if (this.cameraForward.lengthSq() === 0) this.cameraForward.set(0, 0, -1);
    this.cameraForward.normalize();
    this.cameraRight.crossVectors(this.cameraForward, this.camera.up).normalize();
  }

  private syncCameraAnglesFromCurrentView(): void {
    const direction = new Vector3();
    this.camera.getWorldDirection(direction);
    this.cameraYaw = Math.atan2(-direction.x, -direction.z);
    this.cameraPitch = Math.asin(clamp(direction.y, -1, 1));
  }

  private applyCameraOrientation(): void {
    this.camera.up.set(0, 1, 0);
    const lookDirection = new Vector3(
      -Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      Math.sin(this.cameraPitch),
      -Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
    );
    this.camera.lookAt(this.camera.position.clone().add(lookDirection));
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

    if (handle.tool === "move") {
      const pivotEditing = this.pivotEditMode && this.selection.kind !== "light";
      // The drag base is the pivot point when editing the pivot, else the origin.
      const base =
        (pivotEditing ? this.getSelectionPivotWorld(this.selection) : null) ??
        new Vector3(...selected.position);
      const hit = this.clientToFloor(event.clientX, event.clientY);
      const freeMoveBasis = this.getScreenSpaceMoveBasis();
      let movePlane: Plane | undefined;
      let planeStartHit: Vector3 | undefined;
      if (isPlaneAxis(handle.axis)) {
        movePlane = new Plane().setFromNormalAndCoplanarPoint(
          this.planeNormalWorld(handle.axis),
          base,
        );
        planeStartHit =
          this.clientToPlane(event.clientX, event.clientY, movePlane) ?? base.clone();
      }
      this.pointerDrag = {
        mode: "move",
        axis: handle.axis,
        selection: this.selection,
        pointerId: event.pointerId,
        startTransform: selectionToTransform(selected),
        offset: hit
          ? new Vector3(base.x - hit.x, 0, base.z - hit.z)
          : new Vector3(),
        startPosition: [base.x, base.y, base.z],
        startClientX: event.clientX,
        startClientY: event.clientY,
        freeMoveRight: freeMoveBasis.right,
        freeMoveUp: freeMoveBasis.up,
        linkedTransforms: pivotEditing ? undefined : linkedTransforms,
        movePlane,
        planeStartHit,
        pivotEdit: pivotEditing ? true : undefined,
        pivotMatrixInverse: pivotEditing
          ? transformToMatrix(selectionToTransform(selected)).invert()
          : undefined,
        startPivot: pivotEditing ? this.getSelectionPivot(this.selection) : undefined,
      };
    } else if (handle.tool === "rotate") {
      const pivot = this.getSelectionPivot(this.selection);
      const hasPivot = pivot[0] !== 0 || pivot[1] !== 0 || pivot[2] !== 0;
      this.pointerDrag = {
        mode: "rotate",
        axis: handle.axis,
        selection: this.selection,
        pointerId: event.pointerId,
        startTransform: selectionToTransform(selected),
        startClientX: event.clientX,
        startRotation: [...selected.rotation],
        linkedTransforms: this.captureDescendantStarts(this.selection),
        pivot: hasPivot ? pivot : undefined,
        pivotWorld: hasPivot ? this.getSelectionPivotWorld(this.selection) ?? undefined : undefined,
      };
    } else {
      const pivot = this.getSelectionPivot(this.selection);
      const hasPivot = pivot[0] !== 0 || pivot[1] !== 0 || pivot[2] !== 0;
      this.pointerDrag = {
        mode: "scale",
        axis: handle.axis,
        selection: this.selection,
        pointerId: event.pointerId,
        startTransform: selectionToTransform(selected),
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScale: [...selected.scale],
        linkedTransforms: this.captureDescendantStarts(this.selection),
        pivot: hasPivot ? pivot : undefined,
        pivotWorld: hasPivot ? this.getSelectionPivotWorld(this.selection) ?? undefined : undefined,
      };
    }

    this.canvas.setPointerCapture(event.pointerId);
  }

  private updateMoveDrag(event: PointerEvent, selected: EditableSelection): void {
    if (!this.pointerDrag || this.pointerDrag.mode !== "move") return;

    // When editing the pivot the object stays put, so the unchanged components
    // come from the pivot's start point (startPosition), not the object origin.
    const position: [number, number, number] = this.pointerDrag.pivotEdit
      ? [...this.pointerDrag.startPosition]
      : [...selected.position];
    if (this.pointerDrag.axis === "xyz") {
      const deltaX = event.clientX - this.pointerDrag.startClientX;
      const deltaY = event.clientY - this.pointerDrag.startClientY;
      const right = this.pointerDrag.freeMoveRight ?? new Vector3(1, 0, 0);
      const up = this.pointerDrag.freeMoveUp ?? new Vector3(0, 1, 0);
      const offset = right
        .clone()
        .multiplyScalar(deltaX * 0.01)
        .add(up.clone().multiplyScalar(-deltaY * 0.01));
      position[0] = snapValue(
        this.pointerDrag.startPosition[0] + offset.x,
        this.snapSettings.move,
        this.snapSettings.moveEnabled,
      );
      position[1] = snapValue(
        this.pointerDrag.startPosition[1] + offset.y,
        this.snapSettings.move,
        this.snapSettings.moveEnabled,
      );
      position[2] = snapValue(
        this.pointerDrag.startPosition[2] + offset.z,
        this.snapSettings.move,
        this.snapSettings.moveEnabled,
      );
      this.updateMoveDragPosition(position);
      return;
    }

    if (isPlaneAxis(this.pointerDrag.axis) && this.pointerDrag.movePlane && this.pointerDrag.planeStartHit) {
      const hit = this.clientToPlane(event.clientX, event.clientY, this.pointerDrag.movePlane);
      if (!hit) return;
      const delta = hit.sub(this.pointerDrag.planeStartHit);
      const start = this.pointerDrag.startPosition;
      for (let i = 0; i < 3; i += 1) {
        position[i] = snapValue(
          (start[i] ?? 0) + delta.getComponent(i),
          this.snapSettings.move,
          this.snapSettings.moveEnabled,
        );
      }
      this.updateMoveDragPosition(position);
      return;
    }

    if (this.pointerDrag.axis === "y") {
      const deltaY = event.clientY - this.pointerDrag.startClientY;
      position[1] = snapValue(
        this.pointerDrag.startPosition[1] - deltaY * 0.01,
        this.snapSettings.move,
        this.snapSettings.moveEnabled,
      );
      this.updateMoveDragPosition(position);
      return;
    }

    const hit = this.clientToFloor(event.clientX, event.clientY);
    if (!hit) return;

    if (
      this.transformSpace === "local" &&
      (this.pointerDrag.axis === "x" || this.pointerDrag.axis === "z")
    ) {
      // Move along the object's local axis. Y rotation drives the floor-plane
      // heading; X/Z tilt is ignored here since local move stays on the floor.
      const theta = degreesToRadians(this.pointerDrag.startTransform.rotation[1]);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const dirX = this.pointerDrag.axis === "x" ? cos : sin;
      const dirZ = this.pointerDrag.axis === "x" ? -sin : cos;
      const startHitX = this.pointerDrag.startPosition[0] - this.pointerDrag.offset.x;
      const startHitZ = this.pointerDrag.startPosition[2] - this.pointerDrag.offset.z;
      const distance = snapValue(
        (hit.x - startHitX) * dirX + (hit.z - startHitZ) * dirZ,
        this.snapSettings.move,
        this.snapSettings.moveEnabled,
      );
      position[0] = round(this.pointerDrag.startPosition[0] + dirX * distance);
      position[2] = round(this.pointerDrag.startPosition[2] + dirZ * distance);
      this.updateMoveDragPosition(position);
      return;
    }

    if (this.pointerDrag.axis === "x") {
      position[0] = snapValue(
        hit.x + this.pointerDrag.offset.x,
        this.snapSettings.move,
        this.snapSettings.moveEnabled,
      );
    }
    if (this.pointerDrag.axis === "z") {
      position[2] = snapValue(
        hit.z + this.pointerDrag.offset.z,
        this.snapSettings.move,
        this.snapSettings.moveEnabled,
      );
    }

    this.updateMoveDragPosition(position);
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
    if (!this.pointerDrag || this.pointerDrag.mode !== "rotate") return;
    const axisIndex = axisToIndex(this.pointerDrag.axis);
    const deltaDeg = (event.clientX - this.pointerDrag.startClientX) * 0.5;
    const rotation: Vec3 = [...this.pointerDrag.startRotation];
    rotation[axisIndex] = snapValue(
      this.pointerDrag.startRotation[axisIndex] + deltaDeg,
      this.snapSettings.rotate,
      this.snapSettings.rotateEnabled,
    );
    const values: { rotation: Vec3; position?: Vec3 } = { rotation };
    if (this.pointerDrag.pivotWorld && this.pointerDrag.pivot) {
      // Pivot around the offset point: keep it fixed by shifting the origin.
      values.position = this.pivotCorrectedPosition(
        this.pointerDrag.pivotWorld,
        rotation,
        this.pointerDrag.startTransform.scale,
        this.pointerDrag.pivot,
      );
    }
    this.updateSelectedTransform(values, { notifySelection: false });
    this.cascadeActiveDragToLinks();
    this.emitSelectionChanged();
  }

  private updateScaleDrag(event: PointerEvent): void {
    if (!this.pointerDrag || this.pointerDrag.mode !== "scale") return;
    const delta =
      event.clientX -
      this.pointerDrag.startClientX -
      (event.clientY - this.pointerDrag.startClientY);
    const factor = delta * 0.005;
    const start = this.pointerDrag.startScale;
    const locked = this.pointerDrag.axis === "uniform";

    const apply = (value: number): number =>
      Math.max(
        0.05,
        snapValue(value + factor, this.snapSettings.scale, this.snapSettings.scaleEnabled),
      );

    let scale: Vec3;
    if (locked) {
      // Grow every axis by the same amount so a locked object keeps its profile.
      scale = [apply(start[0]), apply(start[1]), apply(start[2])];
    } else if (isPlaneAxis(this.pointerDrag.axis)) {
      const [i, j] = planeAxisIndices(this.pointerDrag.axis);
      scale = [...start];
      scale[i] = apply(start[i]);
      scale[j] = apply(start[j]);
    } else {
      const axisIndex = axisToIndex(this.pointerDrag.axis);
      scale = [...start];
      scale[axisIndex] = apply(start[axisIndex]);
    }
    const values: { scale: Vec3; position?: Vec3 } = { scale };
    if (this.pointerDrag.pivotWorld && this.pointerDrag.pivot) {
      values.position = this.pivotCorrectedPosition(
        this.pointerDrag.pivotWorld,
        this.pointerDrag.startTransform.rotation,
        scale,
        this.pointerDrag.pivot,
      );
    }
    this.updateSelectedTransform(values, { notifySelection: false });
    this.cascadeActiveDragToLinks();
    this.emitSelectionChanged();
  }

  private pickGizmoHandle(clientX: number, clientY: number): GizmoHandle | null {
    if (!this.gizmoGroup.visible || this.gizmoPickables.length === 0) return null;
    this.setPointerNdc(clientX, clientY);
    return pickGizmoHandleFromObjects(
      this.raycaster,
      this.camera,
      this.pointerNdc,
      this.gizmoGroup.visible,
      this.gizmoPickables,
    );
  }

  /** Highlights the handle under the cursor (idle, not dragging) so it's clear what a click will grab. */
  private updateGizmoHover(clientX: number, clientY: number): void {
    if (this.cameraDrag || this.cameraNavigationActive) return;
    const handle = this.gizmoGroup.visible ? this.pickGizmoHandle(clientX, clientY) : null;
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

  /** World-space normal of a plane handle, matching the gizmo's orientation. */
  private planeNormalWorld(axis: GizmoPlaneAxis): Vector3 {
    return planeAxisNormalWorld(axis, this.gizmoGroup.quaternion);
  }

  private clientToPlane(clientX: number, clientY: number, plane: Plane): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const target = new Vector3();
    return this.raycaster.ray.intersectPlane(plane, target) ? target : null;
  }

  private pickSelection(clientX: number, clientY: number): Selection | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const pickables: Object3D[] = [];
    for (const meshes of this.instanceMeshes.values()) pickables.push(...meshes);
    pickables.push(...this.characterObjects);
    for (const record of this.lightObjects) pickables.push(record.root);

    const hits = this.raycaster.intersectObjects(pickables, true);
    for (const hit of hits) {
      const mesh = findParentInstancedMesh(hit.object);
      if (mesh) {
        const assetId = String(mesh.userData.assetId ?? "");
        if (!assetId || hit.instanceId == null) continue;
        return { kind: "instance", assetId, placementIndex: hit.instanceId };
      }

      const character = findParentCharacter(hit.object);
      if (character) {
        const index = Number(character.userData.characterIndex);
        if (Number.isInteger(index)) return { kind: "character", index };
      }

      const light = findParentLight(hit.object);
      if (light) {
        const index = Number(light.userData.lightIndex);
        if (Number.isInteger(index)) return { kind: "light", index };
      }
    }
    return null;
  }

  private select(selection: Selection | null): void {
    this.selection = this.selectionStore.selectGroup(
      selection,
      selection ? this.getGroupedSelections(selection) : [],
    );
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private selectMany(selections: Selection[], active: Selection | null): void {
    this.selection = this.selectionStore.selectMany(
      selections.filter((selection) => this.hasSelection(selection)),
      active,
    );
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private toggleSelection(selection: Selection): void {
    this.selection = this.selectionStore.toggleGroup(
      selection,
      this.getGroupedSelections(selection),
    );
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
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

  private createNodeId(): string {
    const existing = new Set<string>();
    for (const selection of this.getAllSelections({ includeHidden: true })) {
      const nodeId = this.getMutableTransform(selection)?.nodeId;
      if (nodeId) existing.add(nodeId);
    }
    return uniqueEditorId("node", existing);
  }

  private isSelectionSelected(selection: Selection): boolean {
    return this.selectionStore.has(selection);
  }

  private getSelectedSelections(): Selection[] {
    return this.selectionStore.list((selection) => this.hasSelection(selection));
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

  /**
   * Origin position that keeps `pivotWorld` fixed for a given rotation+scale:
   * p' = pivotWorld − R·S·pivotLocal.
   */
  private pivotCorrectedPosition(
    pivotWorld: Vector3,
    rotation: Vec3,
    scale: Vec3,
    pivot: Vec3,
  ): Vec3 {
    const rotScale = new Matrix4().compose(
      new Vector3(0, 0, 0),
      new Quaternion().setFromEuler(eulerDegrees(rotation)),
      new Vector3(...scale),
    );
    const offset = new Vector3(...pivot).applyMatrix4(rotScale);
    return [
      round(pivotWorld.x - offset.x),
      round(pivotWorld.y - offset.y),
      round(pivotWorld.z - offset.z),
    ];
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
    if (!this.layout) return;

    for (const selection of this.getSelectedSelections()) {
      const box = this.getSelectionWorldBox(selection);
      if (!box || box.isEmpty()) continue;
      const active = this.selection && selectionsEqual(this.selection, selection);
      const helper = new Box3Helper(box, active ? 0x00aaff : 0xf3cc5c);
      helper.name = active ? "editor-selection-box-active" : "editor-selection-box";
      this.selectionBoxes.push(helper);
      this.scene.add(helper);
    }
  }

  /** Shows a light's wireframe reach only while it is selected. */
  private updateLightGizmoVisibility(): void {
    this.lightObjects.forEach((record, index) => {
      const wire = record.gizmo.getObjectByName("light-wire");
      if (wire) wire.visible = this.isLightSelected(index);
    });
  }

  private isLightSelected(index: number): boolean {
    return this.selectionStore.has({ kind: "light", index });
  }

  private removeSelectionBox(): void {
    for (const selectionBox of this.selectionBoxes) {
      this.scene.remove(selectionBox);
      selectionBox.geometry.dispose();
      const materials = Array.isArray(selectionBox.material)
        ? selectionBox.material
        : [selectionBox.material];
      for (const material of materials) material.dispose();
    }
    this.selectionBoxes.length = 0;
  }

  private updateGizmo(): void {
    this.clearGizmo();
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
    if (tool === "move") {
      this.addMoveGizmo();
    } else if (tool === "rotate") {
      this.addRotateGizmo();
    } else if (tool === "scale") {
      this.addScaleGizmo();
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

  private clearGizmo(): void {
    for (const child of [...this.gizmoGroup.children]) {
      child.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
      child.removeFromParent();
    }
    this.gizmoPickables.length = 0;
    this.gizmoGroup.scale.setScalar(1);
    this.gizmoGroup.visible = false;
  }

  private addMoveGizmo(): void {
    this.addArrowHandle("x", 0xe15b5b);
    this.addArrowHandle("y", 0x69d282);
    this.addArrowHandle("z", 0x5b8fe1);

    // Two-axis plane handles, colored by the axis they are perpendicular to.
    this.addPlaneHandle("move", "xy", 0x5b8fe1);
    this.addPlaneHandle("move", "xz", 0x69d282);
    this.addPlaneHandle("move", "yz", 0xe15b5b);

    const center = new Mesh(
      new BoxGeometry(0.18, 0.18, 0.18),
      this.gizmoMaterialFor("move", "xyz", 0xf3cc5c),
    );
    center.name = "move-xyz-free";
    this.registerGizmoHandle(center, { tool: "move", axis: "xyz" });
    this.gizmoGroup.add(center);
  }

  private addRotateGizmo(): void {
    this.addRotateRing("x", 0xe15b5b);
    this.addRotateRing("y", 0x69d282);
    this.addRotateRing("z", 0x5b8fe1);
  }

  private addRotateRing(axis: GizmoVectorAxis, color: number): void {
    const ring = new Mesh(
      new TorusGeometry(0.72, 0.01, 10, 96),
      this.gizmoMaterialFor("rotate", axis, color),
    );
    ring.name = `rotate-${axis}-ring`;
    // A torus lies in its local XY plane (normal +Z); orient each ring so its
    // normal points down the axis it rotates about.
    if (axis === "x") ring.rotation.y = Math.PI / 2;
    else if (axis === "y") ring.rotation.x = Math.PI / 2;
    this.registerGizmoHandle(ring, { tool: "rotate", axis });
    this.gizmoGroup.add(ring);
  }

  private addScaleGizmo(): void {
    const center = new Mesh(
      new BoxGeometry(0.16, 0.16, 0.16),
      this.gizmoMaterialFor("scale", "uniform", 0xf3cc5c),
    );
    center.name = "scale-uniform";
    this.registerGizmoHandle(center, { tool: "scale", axis: "uniform" });
    this.gizmoGroup.add(center);

    this.addScaleHandle("x", 0xe15b5b);
    this.addScaleHandle("y", 0x69d282);
    this.addScaleHandle("z", 0x5b8fe1);

    this.addPlaneHandle("scale", "xy", 0x5b8fe1);
    this.addPlaneHandle("scale", "xz", 0x69d282);
    this.addPlaneHandle("scale", "yz", 0xe15b5b);
  }

  /** Small square handle for two-axis (planar) move/scale, like Unreal's gizmo. */
  private addPlaneHandle(tool: "move" | "scale", axis: GizmoPlaneAxis, color: number): void {
    const size = 0.2;
    const reach = 0.34;
    const material = this.gizmoMaterialFor(tool, axis, color);
    const quad = new Mesh(new PlaneGeometry(size, size), material);
    quad.name = `${tool}-${axis}-plane`;
    if (axis === "xy") {
      quad.position.set(reach, reach, 0);
    } else if (axis === "xz") {
      quad.position.set(reach, 0, reach);
      quad.rotation.x = -Math.PI / 2;
    } else {
      quad.position.set(0, reach, reach);
      quad.rotation.y = Math.PI / 2;
    }
    this.registerGizmoHandle(quad, { tool, axis });
    this.gizmoGroup.add(quad);
  }

  private addArrowHandle(axis: GizmoVectorAxis, color: number): void {
    const group = new Group();
    group.name = `move-${axis}-axis`;

    const material = this.gizmoMaterialFor("move", axis, color);
    const shaft = new Mesh(new CylinderGeometry(0.012, 0.012, 0.62, 8), material.clone());
    const head = new Mesh(new ConeGeometry(0.055, 0.14, 14), material.clone());
    shaft.position.y = 0.31;
    head.position.y = 0.69;
    group.add(shaft, head);

    if (axis === "x") group.rotation.z = -Math.PI / 2;
    if (axis === "z") group.rotation.x = Math.PI / 2;

    this.registerGizmoHandle(group, { tool: "move", axis });
    this.gizmoGroup.add(group);
  }

  private addScaleHandle(axis: GizmoVectorAxis, color: number): void {
    const group = new Group();
    group.name = `scale-${axis}-axis`;

    const material = this.gizmoMaterialFor("scale", axis, color);
    const shaft = new Mesh(new CylinderGeometry(0.01, 0.01, 0.52, 8), material.clone());
    const handle = new Mesh(new BoxGeometry(0.11, 0.11, 0.11), material.clone());
    shaft.position.y = 0.26;
    handle.position.y = 0.58;
    group.add(shaft, handle);

    if (axis === "x") group.rotation.z = -Math.PI / 2;
    if (axis === "z") group.rotation.x = Math.PI / 2;
    this.registerGizmoHandle(group, { tool: "scale", axis });
    this.gizmoGroup.add(group);
  }

  private gizmoMaterialFor(tool: EditorTool, axis: GizmoAxis, color: number): MeshBasicMaterial {
    return createGizmoHandleMaterial(
      { tool, axis },
      color,
      this.gizmoInteraction.activeHandle,
      this.gizmoInteraction.hoveredHandle,
    );
  }

  private registerGizmoHandle(object: Object3D, handle: GizmoHandle): void {
    registerGizmoHandlePickables(object, handle, this.gizmoPickables);
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
    const result = this.commandStore.execute(command);
    this.emitHistoryChanged();
    this.onStatus?.(result.statusMessage, result.statusTone);
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
    return (
      this.layout?.worldSettings?.staticObjectsCastShadow ??
      DEFAULT_STATIC_OBJECTS_CAST_SHADOWS
    );
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

  private hasSelection(selection: Selection): boolean {
    if (!this.layout) return false;
    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      return Boolean(instance?.placements[selection.placementIndex]);
    }
    if (selection.kind === "light") return Boolean(this.layout.lights?.[selection.index]);
    return Boolean(this.layout.characters[selection.index]);
  }

  private clientToFloor(clientX: number, clientY: number): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit);
    return hit ? this.floorHit.clone() : null;
  }

  /**
   * Resolves the cursor to a placement point: the nearest scene surface under
   * the cursor (so assets land on table/shelf tops), falling back to the floor
   * plane (y = 0) when no geometry is hit.
   */
  private clientToSurface(clientX: number, clientY: number): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const pickables: Object3D[] = [];
    for (const meshes of this.instanceMeshes.values()) pickables.push(...meshes);
    pickables.push(...this.characterObjects);

    const hits = this.raycaster.intersectObjects(pickables, true);
    if (hits[0]) return hits[0].point.clone();

    const floor = this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit);
    return floor ? this.floorHit.clone() : null;
  }

  private setPointerNdc(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  }

  private handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const resetView = applyResponsiveCameraViewport(this.camera, {
      width,
      height,
      target: CAMERA_TARGET,
      viewTouched: this.cameraNavigationTouched,
    });
    if (resetView) {
      this.syncCameraAnglesFromCurrentView();
    }
    this.renderer.setSize(width, height, false);
  };
}
