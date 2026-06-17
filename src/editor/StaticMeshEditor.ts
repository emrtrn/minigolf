/**
 * Static Mesh editor — an Unreal-style asset editor opened from the Content
 * Browser (double-click a model). It renders the model on a grid with an orbit
 * camera, exposes a top "Collision" toolbar, and a Details panel with the
 * asset-level Collision section (presets, complexity, simple collision
 * primitives). Collision setup is persisted to a `*.collision.json` sidecar.
 *
 * Editor-only: this module lives behind the dynamic `?editor` import so it never
 * ships in the game build.
 */
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from "three";
import { MeshoptDecoder } from "meshoptimizer";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  COLLISION_COMPLEXITY_VALUES,
  COLLISION_PRESET_IDS,
  PHYSICAL_MATERIAL_IDS,
  defaultAssetCollisionDef,
  type AssetCollisionDef,
  type CollisionComplexity,
  type CollisionPresetId,
  type CollisionPrimitive,
  type CollisionPrimitiveShape,
} from "@engine/scene/collision";
import type { Vec3 } from "@engine/scene/layout";
import { projectFileUrl } from "@/project/ProjectSystem";
import { loadAssetCollision, saveAssetCollision } from "@/editor/assetCollisionStore";

export interface StaticMeshEditorOptions {
  /** Public-relative path to the model file (e.g. `assets/props/chair.glb`). */
  modelPath: string;
  /** Display name shown in the editor header / tab. */
  label: string;
  /** Optional status sink (surfaces to the host editor's status bar). */
  onStatus?: (message: string, tone?: "info" | "warning" | "error") => void;
}

const PRESET_LABELS: Record<CollisionPresetId, string> = {
  noCollision: "No Collision",
  blockAll: "Block All",
  overlapAll: "Overlap All",
  blockAllDynamic: "Block All Dynamic",
  overlapAllDynamic: "Overlap All Dynamic",
  pawn: "Pawn",
  physicsActor: "Physics Actor",
  trigger: "Trigger",
  custom: "Custom…",
};

const COMPLEXITY_LABELS: Record<CollisionComplexity, string> = {
  projectDefault: "Project Default",
  simpleAndComplex: "Simple And Complex",
  simpleAsComplex: "Use Simple Collision As Complex",
  complexAsSimple: "Use Complex Collision As Simple",
};

const WIRE_COLOR = 0x49e6a2;
const WIRE_SELECTED_COLOR = 0xffb648;

type GizmoMode = "select" | "translate" | "rotate" | "scale";

/**
 * A collision-primitive overlay. The geometry is built at unit size so the
 * `root` group's transform maps 1:1 to the primitive (position=center,
 * rotation=rotation, scale=size) — which lets the transform gizmo drive it
 * directly. `pickMesh` is an invisible solid used for viewport raycast picking.
 */
interface PrimitiveOverlay {
  root: Group;
  wire: LineSegments;
  pickMesh: Mesh;
  solidGeometry: BufferGeometry;
  wireGeometry: BufferGeometry;
  wireMaterial: LineBasicMaterial;
  pickMaterial: MeshBasicMaterial;
}

export class StaticMeshEditor {
  private static active: StaticMeshEditor | null = null;

  static open(options: StaticMeshEditorOptions): StaticMeshEditor {
    StaticMeshEditor.active?.close();
    const editor = new StaticMeshEditor(options);
    StaticMeshEditor.active = editor;
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly viewportHost: HTMLDivElement;
  private readonly detailsHost: HTMLDivElement;
  private readonly toolbarHost: HTMLDivElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  private readonly loader = new GLTFLoader();
  private readonly modelGroup = new Group();
  private readonly overlayGroup = new Group();
  private readonly resizeObserver: ResizeObserver;

  private readonly target = new Vector3();
  private readonly spherical = new Spherical(4, Math.PI / 3, Math.PI / 4);
  private modelRadius = 1;

  private rafId = 0;
  private disposed = false;
  private menuOpen = false;

  private collision: AssetCollisionDef = defaultAssetCollisionDef();
  private modelBounds = new Box3();
  private selectedPrimitive = -1;
  private readonly overlays: PrimitiveOverlay[] = [];

  private transformControls: TransformControls | null = null;
  private gizmoMode: GizmoMode = "translate";
  private gizmoDragging = false;
  private altDown = false;
  private readonly raycaster = new Raycaster();

  private constructor(private readonly options: StaticMeshEditorOptions) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    this.overlay = document.createElement("div");
    this.overlay.className = "sm-editor-overlay";
    this.overlay.innerHTML = `
      <div class="sm-editor-window">
        <header class="sm-editor-header">
          <span class="sm-editor-tab">
            <span class="sm-editor-tab-icon">◰</span>
            <strong data-sm-title></strong>
          </span>
          <div class="sm-editor-header-actions">
            <button type="button" class="sm-editor-save" data-sm-save title="Save collision (Ctrl+S)">Save</button>
            <button type="button" class="sm-editor-close" data-sm-close title="Close (Esc)">✕</button>
          </div>
        </header>
        <div class="sm-editor-toolbar" data-sm-toolbar></div>
        <div class="sm-editor-body">
          <div class="sm-editor-viewport" data-sm-viewport></div>
          <aside class="sm-editor-details" data-sm-details></aside>
        </div>
        <footer class="sm-editor-status" data-sm-status>Loading…</footer>
      </div>
    `;
    document.body.append(this.overlay);

    this.toolbarHost = this.requireEl("[data-sm-toolbar]");
    this.viewportHost = this.requireEl("[data-sm-viewport]");
    this.detailsHost = this.requireEl("[data-sm-details]");
    this.requireEl("[data-sm-title]").textContent = options.label;

    this.requireEl<HTMLButtonElement>("[data-sm-close]").addEventListener("click", () =>
      this.close(),
    );
    this.requireEl<HTMLButtonElement>("[data-sm-save]").addEventListener("click", () =>
      void this.save(),
    );

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.viewportHost.append(this.renderer.domElement);

    this.buildScene();
    this.bindCameraControls();
    this.bindKeyboard();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.viewportHost);
    this.resize();

    this.renderToolbar();
    this.renderDetails();
    this.startRenderLoop();

    void this.loadModel();
    void this.loadCollision();
  }

  // --- scene setup -------------------------------------------------------

  private buildScene(): void {
    this.scene.background = new Color(0x23262b);
    this.scene.add(new AmbientLight(0xffffff, 1.1));

    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 2.5);
    this.scene.add(key);
    const fill = new DirectionalLight(0xb9d4ff, 1.0);
    fill.position.set(-3, 2.5, -2);
    this.scene.add(fill);

    const grid = new GridHelper(20, 40, 0x55585c, 0x33373d);
    grid.position.y = 0;
    this.scene.add(grid);
    this.scene.add(this.modelGroup);
    this.scene.add(this.overlayGroup);

    const controls = new TransformControls(this.camera, this.renderer.domElement);
    controls.setSize(0.85);
    controls.addEventListener("dragging-changed", (event) => {
      this.gizmoDragging = event.value === true;
      if (this.gizmoDragging) {
        // Alt + Move drag duplicates: leave a static copy at the drag-start
        // transform and keep dragging the original (Unreal-style Alt-drag copy).
        if (this.altDown && this.gizmoMode === "translate") this.duplicateForDrag();
        return;
      }
      // Commit the edit once the drag ends (live changes already wrote through).
      this.altDown = false;
      this.markDirty();
      this.renderDetails();
    });
    controls.addEventListener("objectChange", () => this.onGizmoChange());
    this.scene.add(controls.getHelper());
    this.transformControls = controls;

    this.updateCamera();
  }

  private updateCamera(): void {
    const offset = new Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  private startRenderLoop(): void {
    const tick = (): void => {
      if (this.disposed) return;
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private resize(): void {
    const width = this.viewportHost.clientWidth || 1;
    const height = this.viewportHost.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // --- camera controls (minimal orbit/pan/dolly) -------------------------

  private bindCameraControls(): void {
    const el = this.renderer.domElement;
    let mode: "orbit" | "pan" | null = null;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    // Capture phase so the Alt state is recorded before TransformControls reads
    // the pointerdown and dispatches its drag-start (which consumes altDown).
    el.addEventListener(
      "pointerdown",
      (event) => {
        this.altDown = event.altKey;
      },
      { capture: true },
    );

    el.addEventListener("contextmenu", (event) => event.preventDefault());
    el.addEventListener("pointerdown", (event) => {
      this.closeMenu();
      // Let the transform gizmo own the drag when the pointer is over a handle.
      if (this.transformControls?.axis) return;
      lastX = event.clientX;
      lastY = event.clientY;
      downX = event.clientX;
      downY = event.clientY;
      mode = event.button === 1 || event.shiftKey || event.button === 2 ? "pan" : "orbit";
      el.setPointerCapture(event.pointerId);
    });
    el.addEventListener("pointermove", (event) => {
      if (!mode || this.gizmoDragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (mode === "orbit") {
        this.spherical.theta -= dx * 0.01;
        this.spherical.phi = clamp(this.spherical.phi - dy * 0.01, 0.05, Math.PI - 0.05);
      } else {
        const panScale = this.spherical.radius * 0.0015;
        const right = new Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        this.target.addScaledVector(right, -dx * panScale);
        this.target.addScaledVector(up, dy * panScale);
      }
      this.updateCamera();
    });
    const end = (event: PointerEvent): void => {
      const wasOrbiting = mode !== null;
      mode = null;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      // A click (no meaningful drag, left button) selects a primitive under the
      // cursor — or clears the selection when clicking empty space.
      if (
        wasOrbiting &&
        event.button === 0 &&
        !this.gizmoDragging &&
        Math.hypot(event.clientX - downX, event.clientY - downY) < 4
      ) {
        this.pickPrimitiveAt(event);
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const factor = Math.exp(event.deltaY * 0.001);
        this.spherical.radius = clamp(this.spherical.radius * factor, this.modelRadius * 0.2, this.modelRadius * 12);
        this.updateCamera();
      },
      { passive: false },
    );
  }

  private bindKeyboard(): void {
    this.overlay.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      // Don't hijack typing in the details inputs.
      if (target.matches("input, select, textarea")) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        void this.save();
        return;
      }
      const modeKey: Record<string, GizmoMode> = { q: "select", w: "translate", e: "rotate", r: "scale" };
      const mode = modeKey[event.key.toLowerCase()];
      if (mode) {
        event.stopPropagation();
        this.setGizmoMode(mode);
      }
    });
    this.overlay.tabIndex = -1;
    this.overlay.focus();
  }

  // --- model + collision loading ----------------------------------------

  private async loadModel(): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(projectFileUrl(this.options.modelPath));
      if (this.disposed) return;
      const model = gltf.scene;
      this.modelGroup.add(model);
      this.modelBounds = new Box3().setFromObject(model);
      const center = this.modelBounds.getCenter(new Vector3());
      const size = this.modelBounds.getSize(new Vector3());
      this.modelRadius = Math.max(size.length() / 2, 0.5);
      this.target.copy(center);
      this.spherical.radius = this.modelRadius * 2.6;
      this.updateCamera();
      this.setStatus("Ready.");
    } catch (error) {
      this.setStatus(`Failed to load model: ${describeError(error)}`, "error");
    }
  }

  private async loadCollision(): Promise<void> {
    this.collision = await loadAssetCollision(this.options.modelPath);
    if (this.disposed) return;
    this.renderDetails();
    this.rebuildOverlays();
  }

  // --- toolbar -----------------------------------------------------------

  private renderToolbar(): void {
    this.toolbarHost.innerHTML = `
      <div class="sm-tool-group">
        <button type="button" class="sm-tool-btn" data-sm-menu="collision">
          <span class="sm-tool-icon">⬡</span> Collision <span class="sm-tool-caret">▾</span>
        </button>
        <div class="sm-tool-menu" data-sm-menu-panel hidden></div>
      </div>
      <div class="sm-tool-sep"></div>
      <div class="sm-tool-group sm-tool-modes">
        ${modeButton("select", "▦", "Select (Q)")}
        ${modeButton("translate", "✥", "Move (W)")}
        ${modeButton("rotate", "⟳", "Rotate (E)")}
        ${modeButton("scale", "⤢", "Scale (R)")}
      </div>
    `;
    const button = this.requireEl<HTMLButtonElement>('[data-sm-menu="collision"]');
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleMenu();
    });
    this.toolbarHost.querySelectorAll<HTMLButtonElement>("[data-sm-mode]").forEach((item) => {
      item.addEventListener("click", () => this.setGizmoMode(item.dataset.smMode as GizmoMode));
    });
    this.updateToolbarModes();
    document.addEventListener("pointerdown", this.onDocPointerDown);
  }

  private updateToolbarModes(): void {
    this.toolbarHost.querySelectorAll<HTMLButtonElement>("[data-sm-mode]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.smMode === this.gizmoMode);
    });
  }

  private readonly onDocPointerDown = (event: PointerEvent): void => {
    if (!this.menuOpen) return;
    if ((event.target as HTMLElement).closest(".sm-tool-group")) return;
    this.closeMenu();
  };

  private toggleMenu(): void {
    this.menuOpen ? this.closeMenu() : this.openMenu();
  }

  private openMenu(): void {
    const panel = this.requireEl("[data-sm-menu-panel]");
    const hasPrimitives = this.collision.primitives.length > 0;
    const hasSelection = this.selectedPrimitive >= 0;
    panel.innerHTML = `
      <div class="sm-menu-section">Edit Collision</div>
      ${menuItem("add-box", "Add Box Simplified Collision")}
      ${menuItem("add-sphere", "Add Sphere Simplified Collision")}
      ${menuItem("add-capsule", "Add Capsule Simplified Collision")}
      <div class="sm-menu-sep"></div>
      ${menuItem("kdop10", "Add 10DOP-X Simplified Collision", true)}
      ${menuItem("kdop18", "Add 18DOP Simplified Collision", true)}
      ${menuItem("kdop26", "Add 26DOP Simplified Collision", true)}
      ${menuItem("convex", "Auto Convex Collision", true)}
      <div class="sm-menu-sep"></div>
      ${menuItem("delete", "Delete Selected Collision", !hasSelection)}
      ${menuItem("duplicate", "Duplicate Selected Collision", !hasSelection)}
      ${menuItem("remove", "Remove Collision", !hasPrimitives)}
    `;
    panel.hidden = false;
    this.menuOpen = true;
    panel.querySelectorAll<HTMLButtonElement>("[data-sm-action]").forEach((item) => {
      item.addEventListener("click", () => {
        this.closeMenu();
        this.runMenuAction(item.dataset.smAction ?? "");
      });
    });
  }

  private closeMenu(): void {
    if (!this.menuOpen) return;
    const panel = this.overlay.querySelector<HTMLElement>("[data-sm-menu-panel]");
    if (panel) panel.hidden = true;
    this.menuOpen = false;
  }

  private runMenuAction(action: string): void {
    switch (action) {
      case "add-box":
        this.addPrimitive("box");
        break;
      case "add-sphere":
        this.addPrimitive("sphere");
        break;
      case "add-capsule":
        this.addPrimitive("capsule");
        break;
      case "delete":
        this.deleteSelected();
        break;
      case "duplicate":
        this.duplicateSelected();
        break;
      case "remove":
        this.removeAll();
        break;
      default:
        this.setStatus("That collision generator is not available yet.", "warning");
    }
  }

  // --- collision primitive editing --------------------------------------

  private addPrimitive(shape: CollisionPrimitiveShape): void {
    const size = this.modelBounds.getSize(new Vector3());
    const center = this.modelBounds.getCenter(new Vector3());
    const primitive: CollisionPrimitive = {
      shape,
      size: [round(size.x || 1), round(size.y || 1), round(size.z || 1)],
    };
    if (center.lengthSq() > 1e-6) primitive.center = [round(center.x), round(center.y), round(center.z)];
    this.collision.primitives.push(primitive);
    this.selectedPrimitive = this.collision.primitives.length - 1;
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
    this.setStatus(`Added ${shape} collision.`);
  }

  private deleteSelected(): void {
    if (this.selectedPrimitive < 0) return;
    this.collision.primitives.splice(this.selectedPrimitive, 1);
    this.selectedPrimitive = Math.min(this.selectedPrimitive, this.collision.primitives.length - 1);
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
  }

  private duplicateSelected(): void {
    const source = this.collision.primitives[this.selectedPrimitive];
    if (!source) return;
    this.collision.primitives.push(clonePrimitive(source));
    this.selectedPrimitive = this.collision.primitives.length - 1;
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
  }

  private removeAll(): void {
    this.collision.primitives = [];
    this.selectedPrimitive = -1;
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
  }

  private selectPrimitive(index: number): void {
    this.selectedPrimitive = index;
    this.renderDetails();
    this.refreshOverlayColors();
    this.attachGizmo();
  }

  // --- transform gizmo ---------------------------------------------------

  private setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.updateToolbarModes();
    this.attachGizmo();
  }

  /** Attaches the gizmo to the selected primitive (or detaches when none / Select mode). */
  private attachGizmo(): void {
    const controls = this.transformControls;
    if (!controls) return;
    const overlay = this.overlays[this.selectedPrimitive];
    if (!overlay || this.gizmoMode === "select") {
      controls.detach();
      return;
    }
    controls.setMode(this.gizmoMode);
    controls.attach(overlay.root);
  }

  /**
   * Alt-drag copy: clones the selected primitive at its current (drag-start)
   * transform and leaves the clone in place, while the gizmo keeps moving the
   * original. Appends the clone without rebuilding the dragged overlay so the
   * in-progress drag is undisturbed.
   */
  private duplicateForDrag(): void {
    const source = this.collision.primitives[this.selectedPrimitive];
    if (!source) return;
    const clone = clonePrimitive(source);
    const cloneIndex = this.collision.primitives.length;
    this.collision.primitives.push(clone);
    const overlay = buildPrimitiveOverlay(clone, false);
    overlay.pickMesh.userData.primitiveIndex = cloneIndex;
    this.overlays.push(overlay);
    this.overlayGroup.add(overlay.root);
    this.markDirty();
    this.setStatus("Duplicated collision (Alt-drag).");
  }

  /** Live write-back from the gizmo: root transform -> selected primitive data. */
  private onGizmoChange(): void {
    const overlay = this.overlays[this.selectedPrimitive];
    const primitive = this.collision.primitives[this.selectedPrimitive];
    if (!overlay || !primitive) return;
    const { position, rotation, scale } = overlay.root;
    primitive.size = [
      round(Math.max(scale.x, 0.001)),
      round(Math.max(scale.y, 0.001)),
      round(Math.max(scale.z, 0.001)),
    ];
    if (position.lengthSq() > 1e-8) {
      primitive.center = [round(position.x), round(position.y), round(position.z)];
    } else {
      delete primitive.center;
    }
    const rot: Vec3 = [
      roundDeg(MathUtils.radToDeg(rotation.x)),
      roundDeg(MathUtils.radToDeg(rotation.y)),
      roundDeg(MathUtils.radToDeg(rotation.z)),
    ];
    if (rot.some((axis) => Math.abs(axis) > 1e-3)) primitive.rotation = rot;
    else delete primitive.rotation;
    this.updateSelectedRowText();
  }

  /** Updates the size readout of the selected primitive row without a full re-render. */
  private updateSelectedRowText(): void {
    const primitive = this.collision.primitives[this.selectedPrimitive];
    if (!primitive) return;
    const small = this.detailsHost.querySelector<HTMLElement>(
      `[data-sm-prim="${this.selectedPrimitive}"] small`,
    );
    if (small) small.textContent = primitive.size.map((axis) => axis.toFixed(2)).join(" × ");
  }

  private pickPrimitiveAt(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.overlays.map((overlay) => overlay.pickMesh),
      false,
    );
    const index = hits.length > 0 ? Number(hits[0]!.object.userData.primitiveIndex) : -1;
    if (index !== this.selectedPrimitive) this.selectPrimitive(index);
  }

  // --- viewport overlays -------------------------------------------------

  private rebuildOverlays(): void {
    this.transformControls?.detach();
    for (const overlay of this.overlays) {
      this.overlayGroup.remove(overlay.root);
      disposeOverlay(overlay);
    }
    this.overlays.length = 0;
    this.collision.primitives.forEach((primitive, index) => {
      const overlay = buildPrimitiveOverlay(primitive, index === this.selectedPrimitive);
      overlay.pickMesh.userData.primitiveIndex = index;
      this.overlays.push(overlay);
      this.overlayGroup.add(overlay.root);
    });
    this.attachGizmo();
  }

  private refreshOverlayColors(): void {
    this.overlays.forEach((overlay, index) => {
      overlay.wireMaterial.color.setHex(
        index === this.selectedPrimitive ? WIRE_SELECTED_COLOR : WIRE_COLOR,
      );
    });
  }

  // --- details panel -----------------------------------------------------

  private renderDetails(): void {
    const presetOptions = COLLISION_PRESET_IDS.map(
      (id) =>
        `<option value="${id}" ${id === this.collision.preset ? "selected" : ""}>${PRESET_LABELS[id]}</option>`,
    ).join("");
    const complexityOptions = COLLISION_COMPLEXITY_VALUES.map(
      (id) =>
        `<option value="${id}" ${id === this.collision.complexity ? "selected" : ""}>${COMPLEXITY_LABELS[id]}</option>`,
    ).join("");
    const currentMaterial = this.collision.physicalMaterialId ?? "";
    const physMaterialOptions = [`<option value="" ${currentMaterial ? "" : "selected"}>None</option>`]
      .concat(
        PHYSICAL_MATERIAL_IDS.map(
          (id) =>
            `<option value="${id}" ${id === currentMaterial ? "selected" : ""}>${capitalize(id)}</option>`,
        ),
      )
      .join("");
    const primitiveRows = this.collision.primitives.length
      ? this.collision.primitives
          .map(
            (primitive, index) => `
        <div class="sm-prim-row ${index === this.selectedPrimitive ? "is-selected" : ""}" data-sm-prim="${index}">
          <span class="sm-prim-kind">${primitive.shape}</span>
          <small>${primitive.size.map((axis) => axis.toFixed(2)).join(" × ")}</small>
          <button type="button" class="sm-prim-del" data-sm-prim-del="${index}" title="Delete">✕</button>
        </div>`,
          )
          .join("")
      : `<div class="sm-empty">No simple collision. Use the Collision menu to add a shape.</div>`;

    this.detailsHost.innerHTML = `
      <div class="sm-details-heading">Details</div>
      <div class="sm-section">
        <div class="sm-section-title">Collision</div>
        <label class="sm-row">
          <span>Collision Presets</span>
          <select data-sm-field="preset">${presetOptions}</select>
        </label>
        <label class="sm-row">
          <span>Collision Complexity</span>
          <select data-sm-field="complexity">${complexityOptions}</select>
        </label>
        <label class="sm-row sm-toggle">
          <input type="checkbox" data-sm-field="doubleSided" ${this.collision.doubleSided ? "checked" : ""} />
          <span>Double Sided Geometry</span>
        </label>
        <label class="sm-row">
          <span>Simple Collision Physical Material</span>
          <select data-sm-field="physicalMaterialId">${physMaterialOptions}</select>
        </label>
        <label class="sm-row sm-toggle">
          <input type="checkbox" data-sm-field="generateOverlapEvents" ${
            this.collision.generateOverlapEvents !== false ? "checked" : ""
          } />
          <span>Generate Overlap Events</span>
        </label>
        <label class="sm-row sm-toggle">
          <input type="checkbox" data-sm-field="simulationGeneratesHitEvents" ${
            this.collision.simulationGeneratesHitEvents !== false ? "checked" : ""
          } />
          <span>Simulation Generates Hit Events</span>
        </label>
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Primitives <span class="sm-count">${this.collision.primitives.length}</span></div>
        <div class="sm-prim-list">${primitiveRows}</div>
      </div>
    `;

    this.detailsHost
      .querySelector<HTMLSelectElement>('[data-sm-field="preset"]')
      ?.addEventListener("change", (event) => {
        this.collision.preset = (event.target as HTMLSelectElement).value as CollisionPresetId;
        this.markDirty();
      });
    this.detailsHost
      .querySelector<HTMLSelectElement>('[data-sm-field="complexity"]')
      ?.addEventListener("change", (event) => {
        this.collision.complexity = (event.target as HTMLSelectElement).value as CollisionComplexity;
        this.markDirty();
      });
    this.detailsHost
      .querySelector<HTMLInputElement>('[data-sm-field="doubleSided"]')
      ?.addEventListener("change", (event) => {
        this.collision.doubleSided = (event.target as HTMLInputElement).checked;
        this.markDirty();
      });
    this.detailsHost
      .querySelector<HTMLSelectElement>('[data-sm-field="physicalMaterialId"]')
      ?.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        if (value) this.collision.physicalMaterialId = value;
        else delete this.collision.physicalMaterialId;
        this.markDirty();
      });
    this.bindEventFlagToggle("generateOverlapEvents");
    this.bindEventFlagToggle("simulationGeneratesHitEvents");
    this.detailsHost.querySelectorAll<HTMLElement>("[data-sm-prim]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-sm-prim-del]")) return;
        this.selectPrimitive(Number(row.dataset.smPrim));
      });
    });
    this.detailsHost.querySelectorAll<HTMLButtonElement>("[data-sm-prim-del]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedPrimitive = Number(button.dataset.smPrimDel);
        this.deleteSelected();
      });
    });
  }

  // --- save / status -----------------------------------------------------

  /** Wires a default-on event-flag checkbox (stores only an explicit opt-out). */
  private bindEventFlagToggle(
    field: "generateOverlapEvents" | "simulationGeneratesHitEvents",
  ): void {
    this.detailsHost
      .querySelector<HTMLInputElement>(`[data-sm-field="${field}"]`)
      ?.addEventListener("change", (event) => {
        if ((event.target as HTMLInputElement).checked) delete this.collision[field];
        else this.collision[field] = false;
        this.markDirty();
      });
  }

  private markDirty(): void {
    const save = this.overlay.querySelector<HTMLButtonElement>("[data-sm-save]");
    if (save) save.classList.add("is-dirty");
  }

  private async save(): Promise<void> {
    try {
      const result = await saveAssetCollision(this.options.modelPath, this.collision);
      this.overlay.querySelector<HTMLButtonElement>("[data-sm-save]")?.classList.remove("is-dirty");
      this.setStatus(result.changed ? `Saved ${result.path}` : "No changes to save.");
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private setStatus(message: string, tone: "info" | "warning" | "error" = "info"): void {
    const status = this.overlay.querySelector<HTMLElement>("[data-sm-status]");
    if (status) {
      status.textContent = message;
      status.dataset.tone = tone;
    }
    this.options.onStatus?.(message, tone);
  }

  // --- lifecycle ---------------------------------------------------------

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    document.removeEventListener("pointerdown", this.onDocPointerDown);
    this.resizeObserver.disconnect();
    this.transformControls?.detach();
    this.transformControls?.dispose();
    for (const overlay of this.overlays) disposeOverlay(overlay);
    this.renderer.dispose();
    this.overlay.remove();
    if (StaticMeshEditor.active === this) StaticMeshEditor.active = null;
  }

  private requireEl<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`StaticMeshEditor: missing ${selector}`);
    return el;
  }
}

function menuItem(action: string, label: string, disabled = false): string {
  return `<button type="button" class="sm-menu-item" data-sm-action="${action}" ${
    disabled ? "disabled" : ""
  }>${label}</button>`;
}

function modeButton(mode: GizmoMode, icon: string, title: string): string {
  return `<button type="button" class="sm-tool-btn sm-mode-btn" data-sm-mode="${mode}" title="${title}">${icon}</button>`;
}

/** Unit-sized solid geometry for a shape (its bounding box is 1×1×1). */
function unitGeometryForShape(shape: CollisionPrimitiveShape): BufferGeometry {
  if (shape === "sphere") return new SphereGeometry(0.5, 20, 14);
  if (shape === "capsule") return new CapsuleGeometry(0.5, 0.0001, 8, 16);
  return new BoxGeometry(1, 1, 1);
}

function buildPrimitiveOverlay(primitive: CollisionPrimitive, selected: boolean): PrimitiveOverlay {
  const solidGeometry = unitGeometryForShape(primitive.shape);
  const wireGeometry = new EdgesGeometry(solidGeometry);
  const wireMaterial = new LineBasicMaterial({
    color: selected ? WIRE_SELECTED_COLOR : WIRE_COLOR,
    depthTest: false,
    transparent: true,
  });
  const wire = new LineSegments(wireGeometry, wireMaterial);
  wire.renderOrder = 3;
  // Invisible but raycastable solid for viewport picking.
  const pickMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const pickMesh = new Mesh(solidGeometry, pickMaterial);

  const root = new Group();
  root.add(pickMesh);
  root.add(wire);
  applyPrimitiveToRoot(root, primitive);
  return { root, wire, pickMesh, solidGeometry, wireGeometry, wireMaterial, pickMaterial };
}

/** Drives a unit overlay's transform from the primitive (center/rotation/size). */
function applyPrimitiveToRoot(root: Group, primitive: CollisionPrimitive): void {
  const center = primitive.center ?? [0, 0, 0];
  root.position.set(center[0], center[1], center[2]);
  const rotation = primitive.rotation ?? [0, 0, 0];
  root.rotation.set(degToRad(rotation[0]), degToRad(rotation[1]), degToRad(rotation[2]));
  const [sx, sy, sz] = primitive.size;
  root.scale.set(Math.max(sx || 1, 0.001), Math.max(sy || 1, 0.001), Math.max(sz || 1, 0.001));
}

function disposeOverlay(overlay: PrimitiveOverlay): void {
  overlay.solidGeometry.dispose();
  overlay.wireGeometry.dispose();
  overlay.wireMaterial.dispose();
  overlay.pickMaterial.dispose();
}

function clonePrimitive(primitive: CollisionPrimitive): CollisionPrimitive {
  const clone: CollisionPrimitive = { shape: primitive.shape, size: [...primitive.size] as Vec3 };
  if (primitive.center) clone.center = [...primitive.center] as Vec3;
  if (primitive.rotation) clone.rotation = [...primitive.rotation] as Vec3;
  if (primitive.points) clone.points = primitive.points.map((point) => [...point] as Vec3);
  return clone;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundDeg(value: number): number {
  return Number(value.toFixed(2));
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
