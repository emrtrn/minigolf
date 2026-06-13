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
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Intersection, Material } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AssetLoader, type AssetManifest, type EditableAsset } from "./assetLoader";
import { loadActiveProject, type ActiveProject } from "@/project/ProjectSystem";
import {
  degreesToRadians,
  loadRoomLayout,
  readRotation,
  readScale,
  type LayoutCharacter,
  type LayoutPlacement,
  type RoomLayout,
  type Vec3,
} from "./roomLayout";

/** Perf budget: clamp DPR so 1080p+ phones don't render 3x fragments. */
const MAX_PIXEL_RATIO = 2;
const CAMERA_TARGET = new Vector3(0, 0.65, -0.2);
const GIZMO_RENDER_ORDER = 1000;
const GIZMO_OPACITY = 0.42;
const GIZMO_ACTIVE_OPACITY = 0.62;
const GIZMO_ACTIVE_COLOR = 0xff9f1a;
const CAMERA_MOVE_SPEED = 5.5;
const CAMERA_MIN_MOVE_SPEED = 0.8;
const CAMERA_MAX_MOVE_SPEED = 28;
const CAMERA_LOOK_SENSITIVITY = 0.003;
const CAMERA_PITCH_LIMIT = Math.PI * 0.47;
const CAMERA_ORBIT_SENSITIVITY = 0.006;
const CAMERA_PAN_SENSITIVITY = 0.0025;
const CAMERA_DOLLY_SENSITIVITY = 0.018;
const GIZMO_SCREEN_SIZE_PX = 118;

type EditorTool = "select" | "move" | "rotate" | "scale";
type TransformSpace = "world" | "local";
type GizmoAxis = "x" | "y" | "z" | "xyz" | "uniform";
type GizmoVectorAxis = Extract<GizmoAxis, "x" | "y" | "z">;

const FLAG_LABELS: Record<"hidden" | "locked" | "scaleLocked", { on: string; off: string }> = {
  hidden: { on: "Hide object", off: "Show object" },
  locked: { on: "Lock object", off: "Unlock object" },
  scaleLocked: { on: "Lock scale ratio", off: "Unlock scale ratio" },
};

interface GizmoHandle {
  tool: EditorTool;
  axis: GizmoAxis;
}

type Selection =
  | { kind: "instance"; assetId: string; placementIndex: number }
  | { kind: "character"; index: number };
type InstanceSelection = Extract<Selection, { kind: "instance" }>;
type CharacterSelection = Extract<Selection, { kind: "character" }>;

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

export interface EditableTransform {
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation: Vec3;
  /** Per-axis scale. */
  scale: Vec3;
}

export interface EditableSelection {
  id: string;
  kind: Selection["kind"];
  assetId: string;
  label: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  scaleLocked: boolean;
  locked: boolean;
}

export interface EditableSceneObject extends EditableSelection {
  selected: boolean;
  hidden: boolean;
  locked: boolean;
}

export interface EditorHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export interface EditorProjectInfo {
  manifest: ActiveProject["manifest"];
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

interface EditorCommand {
  label: string;
  undo: () => void;
  redo: () => void;
}

interface MaterialStats {
  basic: number;
  lit: number;
  total: number;
}

interface EditorOptions {
  enabled: boolean;
}

export class SceneApp {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private frameHandle = 0;
  private lastTime = 0;
  private assetLoader: AssetLoader | null = null;
  private activeProject: ActiveProject | null = null;
  private readonly projectReady: Promise<void>;
  private readonly mixers: AnimationMixer[] = [];
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
  private layout: RoomLayout | null = null;
  private models = new Map<string, GLTF>();
  private instanceGroups = new Map<string, Group>();
  private instanceMeshes = new Map<string, InstancedMesh[]>();
  private characterObjects: Object3D[] = [];
  private localBounds = new Map<string, Box3>();
  private assetPlacements = new Map<string, EditableAsset["placement"]>();
  private selection: Selection | null = null;
  private readonly selectedSelections = new Map<string, Selection>();
  private readonly selectionBoxes: Box3Helper[] = [];
  private readonly gizmoGroup = new Group();
  private readonly gizmoPickables: Object3D[] = [];
  private activeGizmoHandle: GizmoHandle | null = null;
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
      }
    | {
        mode: "rotate";
        axis: GizmoAxis;
        selection: Selection;
        pointerId: number;
        startTransform: EditableTransform;
        startClientX: number;
        startRotation: Vec3;
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
      }
    | null = null;
  private readonly undoStack: EditorCommand[] = [];
  private readonly redoStack: EditorCommand[] = [];

  /** Called every frame with the smoothed delta; used by the debug overlay. */
  onFrame: ((deltaMs: number) => void) | null = null;
  onSelectionChanged: ((selection: EditableSelection | null) => void) | null = null;
  onSceneObjectsChanged: ((objects: EditableSceneObject[]) => void) | null = null;
  onHistoryChanged: ((state: EditorHistoryState) => void) | null = null;
  onStatus: ((message: string, tone?: "info" | "success" | "warning" | "error") => void) | null =
    null;

  constructor(canvas: HTMLCanvasElement, options: EditorOptions = { enabled: false }) {
    this.canvas = canvas;
    this.editorEnabled = options.enabled;

    if (!canvas.getContext("webgl2")) {
      throw new Error("WebGL2 is not supported on this device/browser.");
    }

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));

    this.scene.background = new Color(0xd7d7c7);
    this.camera = new PerspectiveCamera(44, 1, 0.1, 100);

    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(3, 8, 4);
    this.scene.add(sun);
    this.scene.add(new AmbientLight(0xffffff, 0.75));

    this.gizmoGroup.name = "editor-transform-gizmo";
    this.gizmoGroup.visible = false;
    this.scene.add(this.gizmoGroup);

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

      for (const mixer of this.mixers) mixer.update(deltaMs / 1000);
      this.updateCameraNavigation(deltaMs / 1000);
      this.updateGizmoScreenScale();

      this.renderer.render(this.scene, this.camera);
      this.onFrame?.(deltaMs);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.renderer.dispose();
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    const { calls, triangles } = this.renderer.info.render;
    return { drawCalls: calls, triangles };
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
          label: placement.name ?? `${instance.assetId} #${placementIndex + 1}`,
          position: [...placement.position],
          rotation: readRotation(placement),
          scale: readScale(placement),
          scaleLocked: placement.scaleLocked ?? false,
          selected: this.isSelectionSelected(selection),
          hidden: placement.hidden ?? false,
          locked: placement.locked ?? false,
        });
      });
    }

    this.layout.characters.forEach((character, index) => {
      const selection: Selection = { kind: "character", index };
      objects.push({
        id: selectionId(selection),
        kind: "character",
        assetId: character.assetId,
        label: character.name ?? `${character.assetId} #${index + 1}`,
        position: [...character.position],
        rotation: readRotation(character),
        scale: readScale(character),
        scaleLocked: character.scaleLocked ?? false,
        selected: this.isSelectionSelected(selection),
        hidden: character.hidden ?? false,
        locked: character.locked ?? false,
      });
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
    if (this.selectedSelections.size > 1 && this.isSelectionSelected(selection)) {
      this.setSelectedHidden(hidden);
      return;
    }
    this.setSelectionFlag(selection, "hidden", hidden);
  }

  setSceneObjectLocked(id: string, locked: boolean): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (this.selectedSelections.size > 1 && this.isSelectionSelected(selection)) {
      this.setSelectedLocked(locked);
      return;
    }
    this.setSelectionFlag(selection, "locked", locked);
  }

  getHistoryState(): EditorHistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
    };
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
    this.emitHistoryChanged();
    this.onStatus?.(`Undo: ${command.label}`, "info");
  }

  redo(): void {
    const command = this.redoStack.pop();
    if (!command) return;
    command.redo();
    this.undoStack.push(command);
    this.emitHistoryChanged();
    this.onStatus?.(`Redo: ${command.label}`, "info");
  }

  setEditorTool(tool: EditorTool): void {
    this.activeTool = tool;
    this.pendingAssetId = null;
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

  /** Returns true when the selection is a wall asset (handled here, no surface fallback). */
  private wallSnapSelected(): boolean {
    if (!this.selection || this.selection.kind !== "instance") return false;
    if (!this.isWallAsset(this.selection.assetId)) return false;
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return true;
    }

    const before = this.captureTransform(this.selection);
    if (!before) return false;
    const snap = this.computeWallSnap(
      this.selection.assetId,
      before.position,
      before.rotation[1],
      before.scale,
    );
    if (!snap) {
      this.onStatus?.("No room walls found to snap to.", "warning");
      return true;
    }

    this.updateSelectedTransform({
      position: snap.position,
      rotation: [before.rotation[0], snap.rotationYDeg, before.rotation[2]],
    });
    this.commitTransformChange(this.selection, before, "Wall snap");
    return true;
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
        label: placement.name ?? `${selection.assetId} #${selection.placementIndex + 1}`,
        position: [...placement.position],
        rotation: readRotation(placement),
        scale: readScale(placement),
        scaleLocked: placement.scaleLocked ?? false,
        locked: placement.locked ?? false,
      };
    }

    const character = this.layout.characters[selection.index];
    if (!character) return null;
    return {
      id: selectionId(selection),
      kind: "character",
      assetId: character.assetId,
      label: character.name ?? character.assetId,
      position: [...character.position],
      rotation: readRotation(character),
      scale: readScale(character),
      scaleLocked: character.scaleLocked ?? false,
      locked: character.locked ?? false,
    };
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

      const character = this.layout?.characters[selection.index];
      if (character) {
        characterDeletes.push({
          selection: cloneSelection(selection) as CharacterSelection,
          snapshot: cloneCharacter(character),
        });
      }
    }
    if (instanceDeletes.length + characterDeletes.length === 0) return;

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
    const applyEntries = (mode: "redo" | "undo"): void => {
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

  showHiddenObjects(): void {
    const hiddenSelections = this
      .getAllSelections({ includeHidden: true })
      .filter((selection) => this.getMutableTransform(selection)?.hidden);
    this.setSelectionsFlag(hiddenSelections, "hidden", false, "Show hidden objects");
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
    this.layout = await loadRoomLayout(this.activeProject.manifest.editor.defaultScene);
    this.models = await this.assetLoader.loadGroups(this.layout.loadGroups);
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

    this.emitSceneObjectsChanged();
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
        note:
          materialStats.basic > 0
            ? "MeshBasicMaterial indicates KHR_materials_unlit is active; scene lights do not affect those assets."
            : "No unlit runtime materials detected.",
      }),
    );
  }

  private createInstancedModel(assetId: string, placements: LayoutPlacement[]): Group {
    const gltf = this.models.get(assetId);
    if (!gltf) throw new Error(`Render test asset missing: ${assetId}`);

    const group = new Group();
    group.name = `instanced-${assetId}`;
    this.instanceGroups.set(assetId, group);
    this.instanceMeshes.set(assetId, []);

    gltf.scene.updateMatrixWorld(true);
    const placementMatrices = placements.map((placement) => composePlacementMatrix(placement));

    gltf.scene.traverse((object) => {
      if (!isRenderableMesh(object)) return;

      const instanced = new InstancedMesh(
        object.geometry,
        object.material,
        placementMatrices.length,
      );
      instanced.name = `${assetId}-${object.name || "mesh"}`;
      instanced.frustumCulled = false;
      instanced.userData.assetId = assetId;

      for (let index = 0; index < placementMatrices.length; index += 1) {
        const placementMatrix = placementMatrices[index];
        if (!placementMatrix) continue;
        if (placements[index]?.hidden) {
          instanced.setMatrixAt(index, HIDDEN_INSTANCE_MATRIX);
          continue;
        }
        const matrix = placementMatrix.clone().multiply(object.matrixWorld);
        instanced.setMatrixAt(index, matrix);
      }
      instanced.instanceMatrix.needsUpdate = true;
      group.add(instanced);
      this.instanceMeshes.get(assetId)?.push(instanced);
    });

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

    const object = this.characterObjects[selection.index];
    const transform = this.getMutableTransform(selection);
    if (!object || !transform) return;
    object.position.set(...transform.position);
    applyEulerDegrees(object, readRotation(transform));
    object.scale.set(...readScale(transform));
  }

  private addCharacter(gltf: GLTF | undefined, placement: LayoutCharacter): void {
    if (!gltf) return;

    const character = this.createCharacterObject(gltf, placement);
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
    const character = this.createCharacterObject(gltf, placement);
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

  private duplicateSelection(selection: Selection): Selection | null {
    if (!this.layout || !this.hasSelection(selection)) return null;

    if (selection.kind === "instance") {
      const transform = this.getMutableTransform(selection);
      if (!transform) return null;
      const snapshot = clonePlacement(transform);
      delete snapshot.groupId;
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

    const character = this.layout.characters[selection.index];
    if (!character) return null;
    const snapshot = cloneCharacter(character);
    delete snapshot.groupId;
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
      snapshot: LayoutPlacement | LayoutCharacter;
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
          } else {
            this.insertCharacterPlacement(
              entry.selection.index,
              entry.snapshot as LayoutCharacter,
            );
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
          } else {
            this.removeCharacterPlacement(entry.selection.index);
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

  private setSelectionFlag(
    selection: Selection,
    flag: "hidden" | "locked" | "scaleLocked",
    value: boolean,
  ): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    const previous = Boolean(target[flag]);
    if (previous === value) return;

    const label = FLAG_LABELS[flag][value ? "on" : "off"];

    this.executeCommand({
      label,
      redo: () => this.applyFlag(selection, flag, value),
      undo: () => this.applyFlag(selection, flag, previous),
    });
  }

  private setSelectionsFlag(
    selections: Selection[],
    flag: "hidden" | "locked" | "scaleLocked",
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

    const applyEntries = (mode: "redo" | "undo"): void => {
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
    flag: "hidden" | "locked" | "scaleLocked",
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

    let candidate = "";
    do {
      candidate = `group-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`;
    } while (existing.has(candidate));
    return candidate;
  }

  private applyVisibility(selection: Selection): void {
    if (selection.kind === "instance") {
      this.rebuildInstanceGroup(selection.assetId);
      return;
    }
    const object = this.characterObjects[selection.index];
    const character = this.layout?.characters[selection.index];
    if (object && character) object.visible = !(character.hidden ?? false);
  }

  private createCharacterObject(gltf: GLTF, placement: LayoutCharacter): Object3D {
    const character = gltf.scene.clone();
    character.name = placement.name ?? placement.assetId;
    character.position.set(...placement.position);
    applyEulerDegrees(character, readRotation(placement));
    character.scale.set(...readScale(placement));
    character.visible = !(placement.hidden ?? false);
    return character;
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
      this.mixers.push(mixer);
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

      if (!this.pointerDrag || this.pointerDrag.pointerId !== event.pointerId) return;
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
        this.activeGizmoHandle = null;
        this.canvas.releasePointerCapture(event.pointerId);
        if (drag.mode === "move" && drag.linkedTransforms?.length) {
          this.commitLinkedMoveChange(drag);
        } else {
          this.commitTransformChange(drag.selection, drag.startTransform);
        }
        this.updateGizmo();
      }
    };
    this.canvas.addEventListener("pointerup", clearDrag);
    this.canvas.addEventListener("pointercancel", clearDrag);
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

    this.activeGizmoHandle = { ...handle };
    this.updateGizmo();

    if (handle.tool === "move") {
      const hit = this.clientToFloor(event.clientX, event.clientY);
      const freeMoveBasis = this.getScreenSpaceMoveBasis();
      this.pointerDrag = {
        mode: "move",
        axis: handle.axis,
        selection: this.selection,
        pointerId: event.pointerId,
        startTransform: selectionToTransform(selected),
        offset: hit
          ? new Vector3(selected.position[0] - hit.x, 0, selected.position[2] - hit.z)
          : new Vector3(),
        startPosition: [...selected.position],
        startClientX: event.clientX,
        startClientY: event.clientY,
        freeMoveRight: freeMoveBasis.right,
        freeMoveUp: freeMoveBasis.up,
        linkedTransforms,
      };
    } else if (handle.tool === "rotate") {
      this.pointerDrag = {
        mode: "rotate",
        axis: handle.axis,
        selection: this.selection,
        pointerId: event.pointerId,
        startTransform: selectionToTransform(selected),
        startClientX: event.clientX,
        startRotation: [...selected.rotation],
      };
    } else {
      this.pointerDrag = {
        mode: "scale",
        axis: handle.axis,
        selection: this.selection,
        pointerId: event.pointerId,
        startTransform: selectionToTransform(selected),
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScale: [...selected.scale],
      };
    }

    this.canvas.setPointerCapture(event.pointerId);
  }

  private updateMoveDrag(event: PointerEvent, selected: EditableSelection): void {
    if (!this.pointerDrag || this.pointerDrag.mode !== "move") return;

    const position: [number, number, number] = [...selected.position];
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
    this.updateSelectedTransform({ rotation });
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
    } else {
      const axisIndex = axisToIndex(this.pointerDrag.axis);
      scale = [...start];
      scale[axisIndex] = apply(start[axisIndex]);
    }
    this.updateSelectedTransform({ scale });
  }

  private pickGizmoHandle(clientX: number, clientY: number): GizmoHandle | null {
    if (!this.gizmoGroup.visible || this.gizmoPickables.length === 0) return null;
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.gizmoPickables, true);
    const handle = hits[0]?.object.userData.gizmoHandle as GizmoHandle | undefined;
    return handle ?? null;
  }

  private getScreenSpaceMoveBasis(): { right: Vector3; up: Vector3 } {
    return {
      right: new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize(),
      up: new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize(),
    };
  }

  private pickSelection(clientX: number, clientY: number): Selection | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const pickables: Object3D[] = [];
    for (const meshes of this.instanceMeshes.values()) pickables.push(...meshes);
    pickables.push(...this.characterObjects);

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
    }
    return null;
  }

  private select(selection: Selection | null): void {
    this.selectedSelections.clear();
    if (selection) {
      const groupSelections = this.getGroupedSelections(selection);
      for (const groupSelection of groupSelections) {
        const current = cloneSelection(groupSelection);
        this.selectedSelections.set(selectionId(current), current);
      }
      this.selection = cloneSelection(selection);
    } else {
      this.selection = null;
    }
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private selectMany(selections: Selection[], active: Selection | null): void {
    this.selectedSelections.clear();
    for (const selection of selections) {
      if (!this.hasSelection(selection)) continue;
      const current = cloneSelection(selection);
      this.selectedSelections.set(selectionId(current), current);
    }

    if (active && this.selectedSelections.has(selectionId(active))) {
      this.selection = cloneSelection(active);
    } else {
      this.selection = this.selectedSelections.values().next().value ?? null;
    }

    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private toggleSelection(selection: Selection): void {
    const groupSelections = this.getGroupedSelections(selection);
    const allSelected = groupSelections.every((entry) =>
      this.selectedSelections.has(selectionId(entry)),
    );

    if (allSelected) {
      for (const entry of groupSelections) this.selectedSelections.delete(selectionId(entry));
      if (this.selection && groupSelections.some((entry) => selectionsEqual(this.selection, entry))) {
        const remaining = [...this.selectedSelections.values()];
        this.selection = remaining.at(-1) ? cloneSelection(remaining.at(-1)!) : null;
      }
    } else {
      for (const entry of groupSelections) {
        const current = cloneSelection(entry);
        this.selectedSelections.set(selectionId(current), current);
      }
      this.selection = cloneSelection(selection);
    }

    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private captureLinkedMoveStarts(active: Selection): LinkedMoveStart[] | undefined {
    const linked = this.getSelectedSelections().flatMap((selection) => {
      if (selectionsEqual(selection, active)) return [];
      if (this.isSelectionLocked(selection)) return [];
      const startTransform = this.captureTransform(selection);
      return startTransform ? [{ selection: cloneSelection(selection), startTransform }] : [];
    });
    return linked.length > 0 ? linked : undefined;
  }

  private getGroupedSelections(selection: Selection): Selection[] {
    const groupId = this.getMutableTransform(selection)?.groupId;
    if (!groupId) return [cloneSelection(selection)];

    const members = this
      .getAllSelections({ includeHidden: true })
      .filter((entry) => this.getMutableTransform(entry)?.groupId === groupId);
    return members.length > 0 ? members.map(cloneSelection) : [cloneSelection(selection)];
  }

  private isSelectionSelected(selection: Selection): boolean {
    return this.selectedSelections.has(selectionId(selection));
  }

  private getSelectedSelections(): Selection[] {
    return [...this.selectedSelections.values()].filter((selection) => this.hasSelection(selection));
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
    return selections;
  }

  private getSelectionLabel(selection: Selection): string {
    const transform = this.getMutableTransform(selection);
    if (selection.kind === "instance") {
      return transform?.name ?? selection.assetId;
    }
    const character = transform as LayoutCharacter | null;
    return character?.name ?? character?.assetId ?? "object";
  }

  private getSelectionWorldBox(selection: Selection): Box3 | null {
    if (selection.kind === "instance") {
      const bounds = this.localBounds.get(selection.assetId);
      const transform = this.getMutableTransform(selection);
      if (!bounds || !transform) return null;
      return bounds.clone().applyMatrix4(composePlacementMatrix(transform));
    }
    const object = this.characterObjects[selection.index];
    return object ? new Box3().setFromObject(object) : null;
  }

  private updateSelectionBox(): void {
    this.removeSelectionBox();
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
    if (!selected || this.activeTool === "select") return;
    if (this.selection && this.isSelectionLocked(this.selection)) return;

    this.gizmoGroup.visible = true;
    this.gizmoGroup.position.set(...selected.position);
    if (this.transformSpace === "local") {
      applyEulerDegrees(this.gizmoGroup, selected.rotation);
    } else {
      this.gizmoGroup.rotation.set(0, 0, 0);
    }

    if (this.activeTool === "move") {
      this.addMoveGizmo();
    } else if (this.activeTool === "rotate") {
      this.addRotateGizmo();
    } else if (this.activeTool === "scale") {
      this.addScaleGizmo();
    }
    this.updateGizmoScreenScale();
  }

  private updateGizmoScreenScale(): void {
    if (!this.gizmoGroup.visible) return;
    const viewportHeight = this.renderer.domElement.clientHeight || window.innerHeight || 1;
    const distance = Math.max(0.01, this.camera.position.distanceTo(this.gizmoGroup.position));
    const viewHeight = 2 * Math.tan(degreesToRadians(this.camera.fov) / 2) * distance;
    const worldUnitsPerPixel = viewHeight / viewportHeight;
    const scale = clamp(worldUnitsPerPixel * GIZMO_SCREEN_SIZE_PX, 0.35, 4);
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
    const active = this.isActiveGizmoHandle(tool, axis);
    return gizmoMaterial(
      active ? GIZMO_ACTIVE_COLOR : color,
      active ? GIZMO_ACTIVE_OPACITY : GIZMO_OPACITY,
    );
  }

  private isActiveGizmoHandle(tool: EditorTool, axis: GizmoAxis): boolean {
    return this.activeGizmoHandle?.tool === tool && this.activeGizmoHandle.axis === axis;
  }

  private registerGizmoHandle(object: Object3D, handle: GizmoHandle): void {
    object.userData.gizmoHandle = handle;
    object.traverse((child) => {
      child.userData.gizmoHandle = handle;
      child.renderOrder = GIZMO_RENDER_ORDER;
      if (child instanceof Mesh) this.gizmoPickables.push(child);
    });
  }

  private getMutableTransform(
    selection: Selection,
  ): (LayoutPlacement | LayoutCharacter) | null {
    if (!this.layout) return null;
    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      return instance?.placements[selection.placementIndex] ?? null;
    }
    return this.layout.characters[selection.index] ?? null;
  }

  private captureTransform(selection: Selection): EditableTransform | null {
    const transform = this.getMutableTransform(selection);
    if (!transform) return null;
    return {
      position: [...transform.position],
      rotation: readRotation(transform),
      scale: readScale(transform),
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

  private commitLinkedMoveChange(drag: {
    selection: Selection;
    startTransform: EditableTransform;
    linkedTransforms?: LinkedMoveStart[] | undefined;
  }): void {
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
      label: `Move ${changes.length} objects`,
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
    command.redo();
    this.undoStack.push(command);
    this.redoStack.length = 0;
    this.emitHistoryChanged();
    this.onStatus?.(command.label, "success");
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

  private hasSelection(selection: Selection): boolean {
    if (!this.layout) return false;
    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      return Boolean(instance?.placements[selection.placementIndex]);
    }
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
    const portrait = height >= width;

    this.camera.aspect = width / height;
    this.camera.fov = portrait ? 42 : 46;
    if (!this.cameraNavigationTouched) {
      this.camera.position.set(
        portrait ? 4.5 : 5.4,
        portrait ? 6.3 : 5.2,
        portrait ? 7.2 : 5.7,
      );
      this.camera.lookAt(CAMERA_TARGET);
      this.syncCameraAnglesFromCurrentView();
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
}

const HIDDEN_INSTANCE_MATRIX = new Matrix4().makeScale(0, 0, 0);

function composePlacementMatrix(placement: LayoutPlacement | LayoutCharacter): Matrix4 {
  const position = new Vector3(...placement.position);
  const rotation = new Quaternion().setFromEuler(eulerDegrees(readRotation(placement)));
  const scale = new Vector3(...readScale(placement));
  return new Matrix4().compose(position, rotation, scale);
}

/** Builds an XYZ-order Euler from a degrees vector. */
function eulerDegrees(rotation: Vec3): Euler {
  return new Euler(
    degreesToRadians(rotation[0]),
    degreesToRadians(rotation[1]),
    degreesToRadians(rotation[2]),
    "XYZ",
  );
}

/** Applies a degrees rotation vector to an Object3D's Euler (XYZ order). */
function applyEulerDegrees(object: Object3D, rotation: Vec3): void {
  object.rotation.copy(eulerDegrees(rotation));
}

/** Maps a gizmo axis to its rotation/scale vector index (defaults to Y). */
function axisToIndex(axis: GizmoAxis): 0 | 1 | 2 {
  if (axis === "x") return 0;
  if (axis === "z") return 2;
  return 1;
}

/**
 * Writes a rotation vector back to a placement. Y-only rotations stay in the
 * legacy `rotationYDeg` field (runtime-compatible); X/Z components promote to
 * the full `rotation` array, keeping `rotationYDeg` as a graceful fallback.
 */
function writeRotation(target: LayoutPlacement | LayoutCharacter, rotation: Vec3): void {
  const [x, y, z] = [round(rotation[0]), round(rotation[1]), round(rotation[2])];
  target.rotationYDeg = y;
  if (x === 0 && z === 0) {
    delete target.rotation;
  } else {
    target.rotation = [x, y, z];
  }
}

/** Writes a scale vector back to a placement (scalar when uniform, else array). */
function writeScale(target: LayoutPlacement | LayoutCharacter, scale: Vec3): void {
  const [x, y, z] = [round(scale[0]), round(scale[1]), round(scale[2])];
  target.scale = x === y && y === z ? x : [x, y, z];
}

function cloneSelection(selection: Selection): Selection {
  return selection.kind === "instance"
    ? {
        kind: "instance",
        assetId: selection.assetId,
        placementIndex: selection.placementIndex,
      }
    : { kind: "character", index: selection.index };
}

function selectionId(selection: Selection): string {
  if (selection.kind === "character") return `character:${selection.index}`;
  return `instance:${encodeURIComponent(selection.assetId)}:${selection.placementIndex}`;
}

function parseSelectionId(id: string): Selection | null {
  const [kind, encodedAssetId, rawIndex] = id.split(":");
  if (kind === "character") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "character", index } : null;
  }
  if (kind !== "instance" || rawIndex === undefined) return null;
  const placementIndex = Number(rawIndex);
  if (!Number.isInteger(placementIndex)) return null;
  return {
    kind: "instance",
    assetId: decodeURIComponent(encodedAssetId ?? ""),
    placementIndex,
  };
}

function selectionsEqual(left: Selection | null, right: Selection | null): boolean {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "character" && right.kind === "character") {
    return left.index === right.index;
  }
  if (left.kind !== "instance" || right.kind !== "instance") return false;
  return left.assetId === right.assetId && left.placementIndex === right.placementIndex;
}

function compareInstanceDeletes(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "instance" || right.selection.kind !== "instance") return 0;
  const assetSort = right.selection.assetId.localeCompare(left.selection.assetId);
  if (assetSort !== 0) return assetSort;
  return right.selection.placementIndex - left.selection.placementIndex;
}

function compareInstanceRestores(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "instance" || right.selection.kind !== "instance") return 0;
  const assetSort = left.selection.assetId.localeCompare(right.selection.assetId);
  if (assetSort !== 0) return assetSort;
  return left.selection.placementIndex - right.selection.placementIndex;
}

function compareCharacterDeletes(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "character" || right.selection.kind !== "character") return 0;
  return right.selection.index - left.selection.index;
}

function compareCharacterRestores(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "character" || right.selection.kind !== "character") return 0;
  return left.selection.index - right.selection.index;
}

function selectionToTransform(selection: EditableSelection): EditableTransform {
  return {
    position: [...selection.position],
    rotation: [...selection.rotation],
    scale: [...selection.scale],
  };
}

function cloneScale(scale: number | Vec3): number | Vec3 {
  return Array.isArray(scale) ? [scale[0], scale[1], scale[2]] : scale;
}

function clonePlacement(placement: LayoutPlacement): LayoutPlacement {
  const clone: LayoutPlacement = {
    position: [...placement.position],
  };
  if (placement.name !== undefined) clone.name = placement.name;
  if (placement.hidden !== undefined) clone.hidden = placement.hidden;
  if (placement.locked !== undefined) clone.locked = placement.locked;
  if (placement.groupId !== undefined) clone.groupId = placement.groupId;
  if (placement.rotationYDeg !== undefined) clone.rotationYDeg = placement.rotationYDeg;
  if (placement.rotation !== undefined) clone.rotation = [...placement.rotation];
  if (placement.scale !== undefined) clone.scale = cloneScale(placement.scale);
  if (placement.scaleLocked !== undefined) clone.scaleLocked = placement.scaleLocked;
  return clone;
}

function cloneUngroupedPlacement(placement: LayoutPlacement): LayoutPlacement {
  const clone = clonePlacement(placement);
  delete clone.groupId;
  return clone;
}

function cloneCharacter(character: LayoutCharacter): LayoutCharacter {
  const clone: LayoutCharacter = {
    assetId: character.assetId,
    position: [...character.position],
  };
  if (character.name !== undefined) clone.name = character.name;
  if (character.hidden !== undefined) clone.hidden = character.hidden;
  if (character.locked !== undefined) clone.locked = character.locked;
  if (character.groupId !== undefined) clone.groupId = character.groupId;
  if (character.rotationYDeg !== undefined) clone.rotationYDeg = character.rotationYDeg;
  if (character.rotation !== undefined) clone.rotation = [...character.rotation];
  if (character.scale !== undefined) clone.scale = cloneScale(character.scale);
  if (character.scaleLocked !== undefined) clone.scaleLocked = character.scaleLocked;
  if (character.animation !== undefined) clone.animation = character.animation;
  return clone;
}

function cloneUngroupedCharacter(character: LayoutCharacter): LayoutCharacter {
  const clone = cloneCharacter(character);
  delete clone.groupId;
  return clone;
}

function transformsEqual(left: EditableTransform, right: EditableTransform): boolean {
  return (
    vecEqual(left.position, right.position) &&
    vecEqual(left.rotation, right.rotation) &&
    vecEqual(left.scale, right.scale)
  );
}

function vecEqual(left: Vec3, right: Vec3): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

function isRenderableMesh(
  object: Object3D,
): object is Mesh & { material: Material | Material[] } {
  return object instanceof Mesh;
}

function collectMaterialStats(models: Map<string, GLTF>): MaterialStats {
  const seen = new Set<Material>();
  for (const gltf of models.values()) {
    gltf.scene.traverse((object) => {
      if (!isRenderableMesh(object)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) seen.add(material);
    });
  }

  let basic = 0;
  let lit = 0;
  for (const material of seen) {
    if (material.type === "MeshBasicMaterial") basic += 1;
    else lit += 1;
  }

  return { basic, lit, total: seen.size };
}

function findParentInstancedMesh(object: Object3D): InstancedMesh | null {
  let current: Object3D | null = object;
  while (current) {
    if (current instanceof InstancedMesh) return current;
    current = current.parent;
  }
  return null;
}

function findParentCharacter(object: Object3D): Object3D | null {
  let current: Object3D | null = object;
  while (current) {
    if (current.userData.characterIndex !== undefined) return current;
    current = current.parent;
  }
  return null;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function dirnameProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

function snapValue(value: number, step: number, enabled = true): number {
  if (!enabled || !Number.isFinite(step) || step <= 0) return round(value);
  return round(Math.round(value / step) * step);
}

function snapStatus(enabled: boolean, step: number): string {
  return enabled ? String(step) : "off";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isCameraNavigationKey(code: string): boolean {
  return (
    code === "KeyW" ||
    code === "KeyA" ||
    code === "KeyS" ||
    code === "KeyD" ||
    code === "KeyQ" ||
    code === "KeyE"
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function gizmoMaterial(color: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity,
    side: DoubleSide,
  });
}
