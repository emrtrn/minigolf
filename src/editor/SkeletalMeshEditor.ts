/**
 * Persona-style skeletal mesh editor shell. Opened from the Content Browser for
 * `skeletalMesh` assets and kept behind a dynamic editor import.
 */
import {
  AmbientLight,
  AnimationAction,
  AnimationClip,
  Bone,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  SkinnedMesh,
  SphereGeometry,
  SRGBColorSpace,
  Spherical,
  Vector3,
  WebGLRenderer,
  type AnimationMixer,
  type Material,
} from "three";
import { MeshoptDecoder } from "meshoptimizer";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VertexNormalsHelper } from "three/examples/jsm/helpers/VertexNormalsHelper.js";
import { CrossfadeAnimator } from "@engine/render-three/characterAnimator";
import { projectFileUrl } from "@/project/ProjectSystem";
import {
  ANIMATION_SET_ROLES,
  defaultAssetSkeleton,
  loadAssetSkeleton,
  saveAssetSkeleton,
  type AnimationSetRole,
  type AssetSkeletonDef,
} from "@/editor/assetSkeletonStore";

export interface SkeletalMeshEditorOptions {
  /** Public-relative path to the model file (e.g. `assets/characters/hero.glb`). */
  modelPath: string;
  /** Manifest asset id for the opened mesh. */
  assetId?: string;
  /** Display name shown in the editor header / tab. */
  label: string;
  /** Optional status sink (surfaces to the host editor's status bar). */
  onStatus?: (message: string, tone?: "info" | "warning" | "error") => void;
}

type PersonaMode = "skeleton" | "animation";

interface BoneNode {
  bone: Bone;
  children: BoneNode[];
}

interface MeshStats {
  meshCount: number;
  skinnedMeshCount: number;
  sectionCount: number;
  materialCount: number;
  vertexCount: number;
  triangleCount: number;
}

interface MeshSectionInfo {
  meshName: string;
  materialName: string;
  vertexCount: number;
  triangleCount: number;
  skinned: boolean;
}

export class SkeletalMeshEditor {
  private static active: SkeletalMeshEditor | null = null;

  static open(options: SkeletalMeshEditorOptions): SkeletalMeshEditor {
    SkeletalMeshEditor.active?.close();
    const editor = new SkeletalMeshEditor(options);
    SkeletalMeshEditor.active = editor;
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
  private readonly helperGroup = new Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly clock = new Clock();

  private readonly target = new Vector3();
  private readonly spherical = new Spherical(4, Math.PI / 3, Math.PI / 4);
  private modelRadius = 1;

  private mode: PersonaMode = "skeleton";
  private rafId = 0;
  private disposed = false;
  private skeletonHelper: SkeletonHelper | null = null;
  private readonly normalHelpers: VertexNormalsHelper[] = [];
  private selectedBone: Bone | null = null;
  private readonly boneMarker = new Mesh(
    new SphereGeometry(0.045, 16, 10),
    new MeshBasicMaterial({ color: 0xffb648, depthTest: false }),
  );

  private stats: MeshStats = emptyStats();
  private readonly skinnedMeshes: SkinnedMesh[] = [];
  private readonly materials = new Set<Material>();
  private readonly meshSections: MeshSectionInfo[] = [];
  private boneRoots: BoneNode[] = [];
  private bones: Bone[] = [];
  private clips: AnimationClip[] = [];
  private skeleton: AssetSkeletonDef = defaultAssetSkeleton();

  private animator: CrossfadeAnimator | null = null;
  private mixer: AnimationMixer | null = null;
  private action: AnimationAction | null = null;
  private selectedClipName = "";
  private playing = false;
  private loop = true;
  private playRate = 1;
  private crossfadeDuration = 0.2;
  private showSkeleton = true;
  private showNormals = false;
  private wireframe = false;

  private constructor(private readonly options: SkeletalMeshEditorOptions) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.boneMarker.visible = false;
    this.boneMarker.renderOrder = 5;

    this.overlay = document.createElement("div");
    this.overlay.className = "sm-editor-overlay";
    this.overlay.innerHTML = `
      <div class="sm-editor-window">
        <header class="sm-editor-header">
          <span class="sm-editor-tab">
            <span class="sm-editor-tab-icon">♙</span>
            <strong data-sm-title></strong>
          </span>
          <div class="sm-editor-header-actions">
            <button type="button" class="sm-editor-save" data-sm-save title="Save skeleton metadata (Ctrl+S)">Save</button>
            <button type="button" class="sm-editor-close" data-sm-close title="Close (Esc)">✕</button>
          </div>
        </header>
        <div class="sm-editor-toolbar" data-sm-toolbar></div>
        <div class="sm-editor-body">
          <div class="sm-editor-viewport" data-sm-viewport></div>
          <aside class="sm-editor-details" data-sm-details></aside>
        </div>
        <footer class="sm-editor-status" data-sm-status>Loading...</footer>
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
  }

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
    this.scene.add(grid);
    this.scene.add(this.modelGroup);
    this.scene.add(this.helperGroup);
    this.helperGroup.add(this.boneMarker);
    this.updateCamera();
  }

  private async loadModel(): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(projectFileUrl(this.options.modelPath));
      if (this.disposed) return;
      this.clips = gltf.animations;
      this.modelGroup.add(gltf.scene);
      this.collectModelInfo(gltf.scene);
      this.frameModel(gltf.scene);
      this.buildSkeletonHelper(gltf.scene);
      this.buildNormalHelpers(gltf.scene);
      this.animator = new CrossfadeAnimator(gltf.scene, this.clips);
      this.mixer = this.animator.mixer;
      await this.loadSkeleton();
      this.selectedClipName = this.resolveInitialClip();
      if (this.selectedClipName) this.selectClip(this.selectedClipName, { autoplay: false, crossfade: false });
      this.renderToolbar();
      this.renderDetails();
      this.setStatus(
        this.skinnedMeshes.length > 0
          ? `Ready. ${this.bones.length} bones, ${this.clips.length} animation clips.`
          : "Loaded, but no SkinnedMesh was found.",
        this.skinnedMeshes.length > 0 ? "info" : "warning",
      );
    } catch (error) {
      this.setStatus(`Failed to load skeletal mesh: ${describeError(error)}`, "error");
    }
  }

  private async loadSkeleton(): Promise<void> {
    this.skeleton = await loadAssetSkeleton(this.options.modelPath);
    this.sanitizeAnimationSet();
  }

  private resolveInitialClip(): string {
    const preferred = this.skeleton.preview.selectedClip;
    if (preferred && this.clips.some((clip) => clip.name === preferred)) return preferred;
    const firstMapped = ANIMATION_SET_ROLES
      .map((role) => this.skeleton.animationSet[role])
      .find((clipName): clipName is string =>
        Boolean(clipName && this.clips.some((clip) => clip.name === clipName)),
      );
    return firstMapped ?? this.clips[0]?.name ?? "";
  }

  private sanitizeAnimationSet(): void {
    const available = new Set(this.clips.map((clip) => clip.name));
    const animationSet: Partial<Record<AnimationSetRole, string>> = {};
    for (const role of ANIMATION_SET_ROLES) {
      const clip = this.skeleton.animationSet[role];
      if (clip && available.has(clip)) animationSet[role] = clip;
    }
    this.skeleton = { ...this.skeleton, animationSet };
  }

  private collectModelInfo(root: Object3D): void {
    this.skinnedMeshes.length = 0;
    this.materials.clear();
    this.meshSections.length = 0;
    const boneSet = new Set<Bone>();
    const stats = emptyStats();

    root.traverse((object) => {
      if (object instanceof Bone) boneSet.add(object);
      if (!(object instanceof Mesh)) return;
      stats.meshCount += 1;
      const geometry = object.geometry;
      const position = geometry.getAttribute("position");
      stats.vertexCount += position?.count ?? 0;
      stats.triangleCount += geometry.index
        ? Math.floor(geometry.index.count / 3)
        : Math.floor((position?.count ?? 0) / 3);
      const materials = materialList(object.material);
      for (const material of materials) this.materials.add(material);
      const groups = geometry.groups.length > 0
        ? geometry.groups
        : [{ start: 0, count: geometry.index?.count ?? position?.count ?? 0, materialIndex: 0 }];
      stats.sectionCount += groups.length;
      for (const [index, group] of groups.entries()) {
        const material = materials[group.materialIndex ?? 0] ?? materials[0];
        this.meshSections.push({
          meshName: object.name || `Mesh ${stats.meshCount}`,
          materialName: material?.name || material?.type || `Material ${group.materialIndex ?? index}`,
          vertexCount: group.count,
          triangleCount: Math.floor(group.count / 3),
          skinned: object instanceof SkinnedMesh,
        });
      }
      if (object instanceof SkinnedMesh) {
        stats.skinnedMeshCount += 1;
        this.skinnedMeshes.push(object);
        for (const bone of object.skeleton.bones) boneSet.add(bone);
      }
    });

    stats.materialCount = this.materials.size;
    this.stats = stats;
    this.bones = [...boneSet];
    this.boneRoots = buildBoneTree(this.bones);
  }

  private frameModel(root: Object3D): void {
    const bounds = new Box3().setFromObject(root);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    this.modelRadius = Math.max(size.length() / 2, 0.5);
    this.target.copy(center);
    this.spherical.radius = this.modelRadius * 2.6;
    this.updateCamera();
  }

  private buildSkeletonHelper(root: Object3D): void {
    this.skeletonHelper?.dispose();
    this.skeletonHelper?.removeFromParent();
    this.skeletonHelper = null;
    if (this.bones.length === 0) return;
    const helper = new SkeletonHelper(root);
    helper.visible = this.showSkeleton;
    this.helperGroup.add(helper);
    this.skeletonHelper = helper;
  }

  private buildNormalHelpers(root: Object3D): void {
    this.disposeNormalHelpers();
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (!object.geometry.getAttribute("normal")) return;
      const helper = new VertexNormalsHelper(object, this.modelRadius * 0.025, 0x7ac7ff);
      helper.visible = this.showNormals;
      this.helperGroup.add(helper);
      this.normalHelpers.push(helper);
    });
  }

  private startRenderLoop(): void {
    const tick = (): void => {
      if (this.disposed) return;
      const delta = this.clock.getDelta();
      if (this.playing) {
        this.mixer?.update(delta * this.playRate);
        this.updateTimelineFromAction();
      }
      this.updateBoneMarker();
      this.updateNormalHelpers();
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

  private updateCamera(): void {
    const offset = new Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  private bindCameraControls(): void {
    const el = this.renderer.domElement;
    let mode: "orbit" | "pan" | null = null;
    let lastX = 0;
    let lastY = 0;

    el.addEventListener("contextmenu", (event) => event.preventDefault());
    el.addEventListener("pointerdown", (event) => {
      lastX = event.clientX;
      lastY = event.clientY;
      mode = event.button === 1 || event.shiftKey || event.button === 2 ? "pan" : "orbit";
      el.setPointerCapture(event.pointerId);
    });
    el.addEventListener("pointermove", (event) => {
      if (!mode) return;
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
      mode = null;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
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
      if (event.key === " ") {
        event.preventDefault();
        this.togglePlayback();
      }
    });
    this.overlay.tabIndex = -1;
    this.overlay.focus();
  }

  private renderToolbar(): void {
    this.toolbarHost.innerHTML = `
      <div class="sm-tool-group sm-tool-modes" aria-label="Persona mode">
        <button type="button" class="sm-tool-btn ${this.mode === "skeleton" ? "is-active" : ""}" data-skel-mode="skeleton">Skeleton</button>
        <button type="button" class="sm-tool-btn ${this.mode === "animation" ? "is-active" : ""}" data-skel-mode="animation">Animation</button>
        <button type="button" class="sm-tool-btn" disabled title="Physics mode is planned for PhAT-lite">Physics</button>
      </div>
      <div class="sm-tool-sep"></div>
      <div class="sm-tool-group sm-tool-visibility">
        <label class="sm-tool-check">
          <input type="checkbox" data-skel-show-skeleton ${this.showSkeleton ? "checked" : ""} />
          <span>Skeleton</span>
        </label>
        <label class="sm-tool-check">
          <input type="checkbox" data-skel-wireframe ${this.wireframe ? "checked" : ""} />
          <span>Wireframe</span>
        </label>
        <label class="sm-tool-check">
          <input type="checkbox" data-skel-show-normals ${this.showNormals ? "checked" : ""} />
          <span>Normals</span>
        </label>
      </div>
      <div class="sm-tool-sep"></div>
      <div class="sm-tool-group">
        <button type="button" class="sm-tool-btn" data-skel-bind-pose>Bind Pose</button>
      </div>
    `;
    this.toolbarHost.querySelectorAll<HTMLButtonElement>("[data-skel-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        this.mode = button.dataset.skelMode === "animation" ? "animation" : "skeleton";
        this.renderToolbar();
        this.renderDetails();
      });
    });
    this.toolbarHost
      .querySelector<HTMLInputElement>("[data-skel-show-skeleton]")
      ?.addEventListener("change", (event) => {
        this.showSkeleton = (event.target as HTMLInputElement).checked;
        if (this.skeletonHelper) this.skeletonHelper.visible = this.showSkeleton;
      });
    this.toolbarHost
      .querySelector<HTMLInputElement>("[data-skel-wireframe]")
      ?.addEventListener("change", (event) => {
        this.wireframe = (event.target as HTMLInputElement).checked;
        this.applyWireframe();
      });
    this.toolbarHost
      .querySelector<HTMLInputElement>("[data-skel-show-normals]")
      ?.addEventListener("change", (event) => {
        this.showNormals = (event.target as HTMLInputElement).checked;
        this.updateNormalVisibility();
      });
    this.toolbarHost.querySelector<HTMLButtonElement>("[data-skel-bind-pose]")?.addEventListener("click", () => {
      this.showBindPose();
    });
  }

  private renderDetails(): void {
    const modeBody = this.mode === "animation" ? this.renderAnimationDetails() : this.renderSkeletonDetails();
    this.detailsHost.innerHTML = `
      <div class="sm-details-heading">Details</div>
      ${modeBody}
      ${this.renderMeshDetails()}
    `;
    this.bindDetails();
  }

  private renderSkeletonDetails(): string {
    return `
      <div class="sm-section">
        <div class="sm-section-title">Skeleton Tree <span class="sm-count">${this.bones.length}</span></div>
        <div class="sm-bone-tree">
          ${
            this.boneRoots.length
              ? this.boneRoots.map((node) => this.renderBoneNode(node, 0)).join("")
              : `<div class="sm-empty">No bones found in this asset.</div>`
          }
        </div>
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Selected Bone</div>
        ${
          this.selectedBone
            ? `
              <div class="sm-row"><span>Name</span><strong>${escapeHtml(this.selectedBone.name || "(unnamed)")}</strong></div>
              <div class="sm-row"><span>Children</span><strong>${this.selectedBone.children.filter((child) => child instanceof Bone).length}</strong></div>
              <div class="sm-row"><span>World Position</span><strong>${formatVec3(this.selectedBone.getWorldPosition(new Vector3()))}</strong></div>
            `
            : `<div class="sm-empty">Select a bone to inspect it in the viewport.</div>`
        }
      </div>
    `;
  }

  private renderBoneNode(node: BoneNode, depth: number): string {
    const selected = this.selectedBone === node.bone;
    const index = this.bones.indexOf(node.bone);
    const name = node.bone.name || "(unnamed)";
    return `
      <button type="button" class="sm-bone-row ${selected ? "is-selected" : ""}" data-skel-bone-index="${index}" style="--bone-depth:${depth}">
        <span>${escapeHtml(name)}</span>
        <small>${node.children.length}</small>
      </button>
      ${node.children.map((child) => this.renderBoneNode(child, depth + 1)).join("")}
    `;
  }

  private renderAnimationDetails(): string {
    const clip = this.clips.find((item) => item.name === this.selectedClipName) ?? null;
    return `
      <div class="sm-section">
        <div class="sm-section-title">Animation Clips <span class="sm-count">${this.clips.length}</span></div>
        <div class="sm-prim-list">
          ${
            this.clips.length
              ? this.clips
                  .map(
                    (item) => `
                      <button type="button" class="sm-clip-row ${item.name === this.selectedClipName ? "is-selected" : ""}" data-skel-clip="${escapeHtml(item.name)}">
                        <span>${escapeHtml(item.name || "(unnamed)")}</span>
                        <small>${item.duration.toFixed(2)}s</small>
                      </button>
                    `,
                  )
                  .join("")
              : `<div class="sm-empty">No animation clips embedded in this GLTF.</div>`
          }
        </div>
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Timeline</div>
        ${
          clip
            ? `
              <div class="sm-anim-controls">
                <button type="button" class="sm-tool-btn" data-skel-play>${this.playing ? "Pause" : "Play"}</button>
                <label class="sm-tool-check"><input type="checkbox" data-skel-loop ${this.loop ? "checked" : ""} /><span>Loop</span></label>
              </div>
              <input class="sm-timeline" type="range" min="0" max="${clip.duration}" step="0.001" value="${this.action?.time ?? 0}" data-skel-time />
              <div class="sm-row">
                <span>Time</span>
                <strong data-skel-time-label>${(this.action?.time ?? 0).toFixed(2)} / ${clip.duration.toFixed(2)}s</strong>
              </div>
              <label class="sm-row">
                <span>Play Rate</span>
                <input type="text" data-skel-rate value="${this.playRate.toFixed(2)}" />
              </label>
              <label class="sm-row">
                <span>Crossfade</span>
                <input type="text" data-skel-crossfade value="${this.crossfadeDuration.toFixed(2)}" />
              </label>
            `
            : `<div class="sm-empty">Select a clip to preview animation.</div>`
        }
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Animation Set</div>
        ${
          this.clips.length
            ? ANIMATION_SET_ROLES.map(
                (role) => `
                  <label class="sm-row">
                    <span>${formatRoleLabel(role)}</span>
                    <select data-skel-role="${role}">
                      ${this.clipOptions(this.skeleton.animationSet[role] ?? "")}
                    </select>
                  </label>
                `,
              ).join("")
            : `<div class="sm-empty">No clips available for role mapping.</div>`
        }
      </div>
    `;
  }

  private renderMeshDetails(): string {
    return `
      <div class="sm-section">
        <div class="sm-section-title">Mesh Stats</div>
        <div class="sm-row"><span>Meshes</span><strong>${this.stats.meshCount}</strong></div>
        <div class="sm-row"><span>Skinned Meshes</span><strong>${this.stats.skinnedMeshCount}</strong></div>
        <div class="sm-row"><span>Sections</span><strong>${this.stats.sectionCount}</strong></div>
        <div class="sm-row"><span>Vertices</span><strong>${this.stats.vertexCount.toLocaleString()}</strong></div>
        <div class="sm-row"><span>Triangles</span><strong>${this.stats.triangleCount.toLocaleString()}</strong></div>
        <div class="sm-row"><span>Materials</span><strong>${this.stats.materialCount}</strong></div>
        <div class="sm-row"><span>Bones</span><strong>${this.bones.length}</strong></div>
        <div class="sm-row"><span>Clips</span><strong>${this.clips.length}</strong></div>
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Materials</div>
        ${
          this.materials.size
            ? [...this.materials]
                .map(
                  (material, index) => `
                    <div class="sm-row">
                      <span>Element ${index}</span>
                      <strong>${escapeHtml(material.name || material.type || "Material")}</strong>
                    </div>
                  `,
                )
                .join("")
            : `<div class="sm-empty">No materials found.</div>`
        }
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Sections <span class="sm-count">${this.meshSections.length}</span></div>
        <div class="sm-prim-list">
          ${
            this.meshSections.length
              ? this.meshSections
                  .map(
                    (section) => `
                      <div class="sm-section-row">
                        <strong>${escapeHtml(section.meshName)}</strong>
                        <small>${escapeHtml(section.materialName)} · ${section.triangleCount.toLocaleString()} tris · ${section.vertexCount.toLocaleString()} verts${section.skinned ? " · skinned" : ""}</small>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="sm-empty">No mesh sections found.</div>`
          }
        </div>
      </div>
    `;
  }

  private bindDetails(): void {
    this.detailsHost.querySelectorAll<HTMLButtonElement>("[data-skel-bone-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.skelBoneIndex);
        this.selectedBone = this.bones[index] ?? null;
        this.renderDetails();
      });
    });
    this.detailsHost.querySelectorAll<HTMLButtonElement>("[data-skel-clip]").forEach((button) => {
      button.addEventListener("click", () =>
        this.selectClip(button.dataset.skelClip ?? "", { autoplay: true, crossfade: true }),
      );
    });
    this.detailsHost.querySelector<HTMLButtonElement>("[data-skel-play]")?.addEventListener("click", () => {
      this.togglePlayback();
    });
    this.detailsHost.querySelector<HTMLInputElement>("[data-skel-loop]")?.addEventListener("change", (event) => {
      this.loop = (event.target as HTMLInputElement).checked;
      this.applyLoopMode();
    });
    this.detailsHost.querySelector<HTMLInputElement>("[data-skel-time]")?.addEventListener("input", (event) => {
      this.scrubTo(Number((event.target as HTMLInputElement).value));
    });
    this.detailsHost.querySelector<HTMLInputElement>("[data-skel-rate]")?.addEventListener("change", (event) => {
      const next = Number((event.target as HTMLInputElement).value);
      this.playRate = Number.isFinite(next) ? clamp(next, 0.05, 4) : 1;
      this.renderDetails();
    });
    this.detailsHost.querySelector<HTMLInputElement>("[data-skel-crossfade]")?.addEventListener("change", (event) => {
      const next = Number((event.target as HTMLInputElement).value);
      this.crossfadeDuration = Number.isFinite(next) ? clamp(next, 0, 2) : 0.2;
      this.renderDetails();
    });
    this.detailsHost.querySelectorAll<HTMLSelectElement>("[data-skel-role]").forEach((select) => {
      select.addEventListener("change", () => {
        this.setAnimationRole(select.dataset.skelRole as AnimationSetRole, select.value);
      });
    });
  }

  private clipOptions(selected: string): string {
    return [`<option value="" ${selected ? "" : "selected"}>None</option>`]
      .concat(
        this.clips.map(
          (clip) =>
            `<option value="${escapeHtml(clip.name)}" ${
              clip.name === selected ? "selected" : ""
            }>${escapeHtml(clip.name)}</option>`,
        ),
      )
      .join("");
  }

  private setAnimationRole(role: AnimationSetRole, clipName: string): void {
    if (!ANIMATION_SET_ROLES.includes(role)) return;
    const animationSet: Partial<Record<AnimationSetRole, string>> = { ...this.skeleton.animationSet };
    if (clipName) animationSet[role] = clipName;
    else delete animationSet[role];
    this.skeleton = { ...this.skeleton, animationSet };
    this.markDirty();
    this.renderDetails();
  }

  private selectClip(name: string, options: { autoplay: boolean; crossfade: boolean }): void {
    const clip = this.clips.find((item) => item.name === name);
    if (!clip || !this.mixer) return;
    const previousClipName = this.selectedClipName;
    this.selectedClipName = clip.name;
    this.skeleton = {
      ...this.skeleton,
      preview: { ...this.skeleton.preview, selectedClip: clip.name },
    };
    const duration = options.crossfade && previousClipName && previousClipName !== clip.name
      ? this.crossfadeDuration
      : 0;
    if (this.animator) {
      this.animator.play(clip.name, duration);
    } else {
      this.mixer.stopAllAction();
      this.mixer.clipAction(clip).reset().play();
    }
    this.action = this.mixer.clipAction(clip);
    this.applyLoopMode();
    this.action.paused = !options.autoplay;
    this.playing = options.autoplay;
    this.mixer.update(0);
    this.renderToolbar();
    this.renderDetails();
    this.setStatus(
      duration > 0
        ? `Crossfading to ${clip.name} (${duration.toFixed(2)}s).`
        : `Previewing ${clip.name}.`,
    );
  }

  private togglePlayback(): void {
    if (!this.action && this.selectedClipName) {
      this.selectClip(this.selectedClipName, { autoplay: false, crossfade: false });
    }
    if (!this.action) return;
    this.playing = !this.playing;
    this.action.paused = !this.playing;
    this.clock.getDelta();
    this.renderDetails();
  }

  private scrubTo(time: number): void {
    if (!this.action || !this.mixer) return;
    this.playing = false;
    const clip = this.action.getClip();
    this.mixer.stopAllAction();
    this.action = this.mixer.clipAction(clip);
    this.action.reset();
    this.applyLoopMode();
    this.action.play();
    this.action.paused = true;
    this.action.time = clamp(time, 0, this.action.getClip().duration);
    this.mixer.update(0);
    this.updateTimelineFromAction();
  }

  private applyLoopMode(): void {
    if (!this.action) return;
    this.action.setLoop(this.loop ? LoopRepeat : LoopOnce, this.loop ? Infinity : 1);
    this.action.clampWhenFinished = !this.loop;
  }

  private showBindPose(): void {
    this.playing = false;
    this.action?.stop();
    this.action = null;
    this.mixer?.stopAllAction();
    for (const mesh of this.skinnedMeshes) mesh.skeleton.pose();
    this.setStatus("Bind pose restored.");
    this.renderDetails();
  }

  private updateTimelineFromAction(): void {
    const action = this.action;
    if (!action) return;
    const input = this.detailsHost.querySelector<HTMLInputElement>("[data-skel-time]");
    const label = this.detailsHost.querySelector<HTMLElement>("[data-skel-time-label]");
    if (input) input.value = String(action.time);
    if (label) label.textContent = `${action.time.toFixed(2)} / ${action.getClip().duration.toFixed(2)}s`;
  }

  private updateBoneMarker(): void {
    if (!this.selectedBone) {
      this.boneMarker.visible = false;
      return;
    }
    this.selectedBone.getWorldPosition(this.boneMarker.position);
    this.boneMarker.scale.setScalar(this.modelRadius * 0.08);
    this.boneMarker.visible = true;
  }

  private updateNormalHelpers(): void {
    if (!this.showNormals) return;
    for (const helper of this.normalHelpers) helper.update();
  }

  private updateNormalVisibility(): void {
    for (const helper of this.normalHelpers) helper.visible = this.showNormals;
  }

  private applyWireframe(): void {
    for (const material of this.materials) {
      if ("wireframe" in material) {
        (material as Material & { wireframe: boolean }).wireframe = this.wireframe;
        material.needsUpdate = true;
      }
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

  private markDirty(): void {
    this.overlay.querySelector<HTMLButtonElement>("[data-sm-save]")?.classList.add("is-dirty");
  }

  private async save(): Promise<void> {
    try {
      const result = await saveAssetSkeleton(this.options.modelPath, this.skeleton);
      this.overlay.querySelector<HTMLButtonElement>("[data-sm-save]")?.classList.remove("is-dirty");
      this.setStatus(result.changed ? `Saved ${result.path}` : "No skeleton metadata changes to save.");
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.action?.stop();
    this.mixer?.stopAllAction();
    this.skeletonHelper?.dispose();
    this.disposeNormalHelpers();
    this.boneMarker.geometry.dispose();
    if (Array.isArray(this.boneMarker.material)) {
      for (const material of this.boneMarker.material) material.dispose();
    } else {
      this.boneMarker.material.dispose();
    }
    this.renderer.dispose();
    this.overlay.remove();
    if (SkeletalMeshEditor.active === this) SkeletalMeshEditor.active = null;
  }

  private requireEl<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`SkeletalMeshEditor: missing ${selector}`);
    return el;
  }

  private disposeNormalHelpers(): void {
    for (const helper of this.normalHelpers) {
      helper.removeFromParent();
      helper.dispose();
    }
    this.normalHelpers.length = 0;
  }
}

function buildBoneTree(bones: readonly Bone[]): BoneNode[] {
  const boneSet = new Set(bones);
  const byBone = new Map<Bone, BoneNode>();
  for (const bone of bones) byBone.set(bone, { bone, children: [] });
  const roots: BoneNode[] = [];
  for (const bone of bones) {
    const node = byBone.get(bone);
    if (!node) continue;
    if (bone.parent instanceof Bone && boneSet.has(bone.parent)) {
      byBone.get(bone.parent)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function materialList(material: Mesh["material"]): Material[] {
  return Array.isArray(material) ? material : [material];
}

function emptyStats(): MeshStats {
  return {
    meshCount: 0,
    skinnedMeshCount: 0,
    sectionCount: 0,
    materialCount: 0,
    vertexCount: 0,
    triangleCount: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatVec3(value: Vector3): string {
  return [value.x, value.y, value.z].map((axis) => axis.toFixed(2)).join(", ");
}

function formatRoleLabel(role: AnimationSetRole): string {
  return role.length > 0 ? role[0]!.toUpperCase() + role.slice(1) : role;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
