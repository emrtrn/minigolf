// Editor-only styles. Importing here (rather than statically in index.html)
// keeps them in the dev-only editor chunk, out of the production game build.
import "./editorUi.css";
import {
  ASSET_TYPES,
  assetPath,
  assetType,
  inferAssetTypeFromPath,
  isModelAssetType,
  type AssetType,
  type EditableAsset,
} from "@engine/assets/manifest";
import type {
  EditableSceneObject,
  EditableSelection,
  EditorProjectInfo,
  EditorHistoryState,
  EditorSnapSettings,
  EditorWorldSettings,
  EditableTransform,
  EditableTransformSnapshot,
  SceneApp,
} from "@/scene/SceneApp";
import {
  isDefaultMetadataValue,
  metadataGroupsForTarget,
  type MetadataFieldDef,
  type MetadataSchema,
} from "@engine/scene/metadataSchema";
import type { LayoutInteraction, LayoutPhysics, MetadataValue } from "@engine/scene/layout";
import {
  isShapePrimitiveType,
  PLAYER_START_ASSET_ID,
  shapeAssetId,
  type ShapePrimitiveType,
} from "@engine/scene/shapes";
import { writePlayCameraPose } from "@/play/cameraHandoff";
import { ThumbnailRenderer } from "./ThumbnailRenderer";
import {
  fetchProjectDir,
  findProjectDir,
  flattenProjectFiles,
  normalizeProjectPath,
  type ProjectDirNode,
} from "@/project/ProjectAssetTree";
import { projectFileUrl } from "@/project/ProjectSystem";
import { GAME_MODE_OPTIONS } from "@/game/gameModes/catalog";
import { COLLISION_PRESET_IDS, type CollisionPresetId } from "@engine/scene/collision";
import {
  nextTransformTool,
  type EditorTool,
  type TransformSpace,
} from "@editor/core/tools";

type InspectorTab = "details" | "world";

const DEFAULT_LINEAR_DAMPING = 0.12;
const DEFAULT_ANGULAR_DAMPING = 0.45;
const PHYSICS_AXIS_LABELS = ["X", "Y", "Z"] as const;

const COLLISION_PRESET_LABELS: Record<CollisionPresetId, string> = {
  noCollision: "No Collision",
  blockAll: "Block All",
  overlapAll: "Overlap All",
  blockAllDynamic: "Block All Dynamic",
  overlapAllDynamic: "Overlap All Dynamic",
  pawn: "Pawn",
  physicsActor: "Physics Actor",
  trigger: "Trigger",
  custom: "Custom",
};

const TOOL_LABELS: Record<EditorTool, string> = {
  select: "Select",
  move: "Move",
  rotate: "Rotate",
  scale: "Scale",
};

interface BrowserAssetItem {
  key: string;
  label: string;
  category: string;
  path: string;
  ext: string;
  type: AssetType | "file";
  editable?: EditableAsset;
}

interface BrowserAssetIssue {
  code:
    | "loose-file"
    | "unsupported-file"
    | "missing-placement"
    | "missing-collision-setting"
    | "not-placeable";
  label: string;
}

const CONTENT_FILTER_ALL = "__all__";
type ContentTypeFilter = BrowserAssetItem["type"] | typeof CONTENT_FILTER_ALL;

export class EditorUi {
  private root: HTMLDivElement;
  private contentList: HTMLDivElement;
  private contentDrawer: HTMLElement;
  private contentToggle: HTMLButtonElement;
  private contentRootLabel: HTMLElement;
  private contentPathLabel: HTMLElement;
  private contentStatus: HTMLElement;
  private contentSearch: HTMLInputElement;
  private contentTypeFilter: HTMLSelectElement;
  private folderTree: HTMLElement;
  private outlinerList: HTMLDivElement;
  private detailsBody: HTMLDivElement;
  private worldSettingsBody: HTMLDivElement;
  private statusText: HTMLElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  private toolButtons = new Map<EditorTool, HTMLButtonElement>();
  private readonly thumbnailRenderer = new ThumbnailRenderer();
  private activeTool: EditorTool = "move";
  private projectInfo: EditorProjectInfo | null = null;
  private metadataSchema: MetadataSchema | null = null;
  private editableAssets: EditableAsset[] = [];
  private assetTreeRoot: ProjectDirNode | null = null;
  private selectedFolder = "";
  private collapsedFolderPaths = new Set<string>();
  /** Content Browser asset card highlighted as selected (orange). */
  private selectedAssetId: string | null = null;
  /** Cached 1x1 transparent image used to suppress the native drag thumbnail. */
  private emptyDragImage: HTMLImageElement | null = null;
  private contentQuery = "";
  private contentType: ContentTypeFilter = CONTENT_FILTER_ALL;
  private contentDrawerOpen = false;
  private contentRefreshTimer = 0;
  private outlinerObjects: EditableSceneObject[] = [];
  private outlinerFilter = "";
  private selected: EditableSelection | null = null;
  private worldSettings: EditorWorldSettings | null = null;
  private detailsBaseline: EditableTransformSnapshot[] | null = null;
  private detailsScale: [number, number, number] | null = null;
  private transformClipboard: EditableTransform | null = null;
  private contextMenu: HTMLElement | null = null;
  private contextMenuCleanup: (() => void) | null = null;
  /** Scene-object ids being dragged in the outliner (for drag-to-parent). */
  private outlinerDragIds: string[] = [];

  constructor(private readonly app: SceneApp) {
    document.body.classList.add("editor-mode");
    // Preload the transparent drag image so setDragImage works on the first drag.
    this.getEmptyDragImage();

    this.root = document.createElement("div");
    this.root.id = "editor-ui";
    this.root.className = "editor-shell";
    this.root.addEventListener("contextmenu", (event) => event.preventDefault());
    this.root.innerHTML = `
      <header class="editor-topbar">
        <div class="editor-brand">
          <strong>Forge Editor</strong>
          <span data-project-name>loading project</span>
        </div>
        <div class="editor-tools" data-tools></div>
        <div class="editor-snaps">
          <label class="snap-toggle">
            <input type="checkbox" data-snap-toggle="move" checked />
            <span>Grid</span>
          </label>
          <label>
            <span>Move</span>
            <select data-snap="move">
              <option value="0.25">0.25</option>
              <option value="0.5">0.5</option>
              <option value="1" selected>1</option>
            </select>
          </label>
          <label class="snap-toggle">
            <input type="checkbox" data-snap-toggle="rotate" checked />
            <span>Rot</span>
          </label>
          <label>
            <span>Rotate</span>
            <select data-snap="rotate">
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="15" selected>15</option>
              <option value="30">30</option>
              <option value="45">45</option>
              <option value="90">90</option>
            </select>
          </label>
          <label class="snap-toggle">
            <input type="checkbox" data-snap-toggle="scale" checked />
            <span>Scale</span>
          </label>
          <label>
            <span>Scale</span>
            <select data-snap="scale">
              <option value="0.05">0.05</option>
              <option value="0.1" selected>0.1</option>
              <option value="0.25">0.25</option>
              <option value="0.5">0.5</option>
              <option value="1">1</option>
            </select>
          </label>
        </div>
        <div class="editor-actions">
          <div class="add-actor-menu">
            <button type="button" data-add-actor-button title="Add actor">+ Add Actor</button>
            <div class="add-actor-popover" data-add-actor-popover>
              <div class="add-actor-section-title">Lights</div>
              <button type="button" data-add-actor="directional">Directional Light</button>
              <button type="button" data-add-actor="point">Point Light</button>
              <button type="button" data-add-actor="spot">Spot Light</button>
              <div class="add-actor-section-title">Shapes</div>
              <button type="button" data-add-shape="cube">Cube</button>
              <button type="button" data-add-shape="sphere">Sphere</button>
              <button type="button" data-add-shape="cylinder">Cylinder</button>
              <button type="button" data-add-shape="cone">Cone</button>
              <button type="button" data-add-shape="plane">Plane</button>
              <div class="add-actor-section-title">Gameplay</div>
              <button type="button" data-add-player-start>Player Start</button>
            </div>
          </div>
          <div class="show-menu">
            <button type="button" data-show-button title="Show flags">Show</button>
            <div class="show-popover" data-show-popover>
              <div class="add-actor-section-title">Show Flags</div>
              <label>
                <input type="checkbox" data-show-flag="collision" />
                Collision
              </label>
            </div>
          </div>
          <button type="button" data-action="undo" title="Undo">Undo</button>
          <button type="button" data-action="redo" title="Redo">Redo</button>
          <button type="button" data-action="delete">Delete</button>
          <button type="button" data-action="play" title="Save & open runtime (P)">Play</button>
          <button type="button" data-action="save" class="primary">Save Layout</button>
        </div>
      </header>
      <aside class="editor-panel editor-outliner">
        <div class="panel-title">Scene Outliner</div>
        <input
          class="outliner-search"
          type="search"
          data-outliner-search
          placeholder="Search"
        />
        <div class="outliner-list" data-outliner-list></div>
      </aside>
      <aside class="editor-panel editor-details">
        <div class="inspector-tabs" role="tablist" aria-label="Inspector">
          <button
            type="button"
            class="inspector-tab active"
            data-inspector-tab="details"
            role="tab"
            aria-selected="true"
          >Details</button>
          <button
            type="button"
            class="inspector-tab"
            data-inspector-tab="world"
            role="tab"
            aria-selected="false"
          >World Settings</button>
        </div>
        <div class="inspector-pane" data-inspector-pane="details">
          <div class="details-body" data-details-body></div>
        </div>
        <div class="inspector-pane" data-inspector-pane="world" hidden>
          <div class="details-body world-settings-body" data-world-settings-body></div>
        </div>
      </aside>
      <section class="editor-content-drawer" data-content-drawer aria-hidden="true">
        <div class="content-drawer-top">
          <div class="content-drawer-title">
            <strong>Content Drawer</strong>
            <span data-content-root>assets</span>
          </div>
          <input
            class="content-search"
            type="search"
            data-content-search
            placeholder="Search assets"
          />
          <div class="content-filters" data-content-filters>
            <select class="content-filter" data-content-type-filter aria-label="Asset type">
              <option value="${CONTENT_FILTER_ALL}">All types</option>
            </select>
          </div>
          <button type="button" data-content-refresh>Refresh</button>
        </div>
        <div class="content-drawer-body">
          <nav class="folder-tree" data-folder-tree aria-label="Asset folders"></nav>
          <section class="content-assets">
            <div class="content-path" data-content-path>assets</div>
            <div class="content-list" data-content-list></div>
          </section>
        </div>
        <div class="content-drawer-status" data-content-status>Loading assets</div>
      </section>
      <footer class="editor-status">
        <button type="button" class="content-drawer-toggle" data-content-toggle aria-expanded="false">
          Content Drawer
        </button>
        <span data-status>Ready</span>
      </footer>
    `;

    const overlay = document.getElementById("ui-overlay");
    if (!overlay) throw new Error("Missing #ui-overlay");
    overlay.append(this.root);

    this.contentList = requireElement(this.root, "[data-content-list]");
    this.contentDrawer = requireElement(this.root, "[data-content-drawer]");
    this.contentToggle = requireElement(this.root, "[data-content-toggle]");
    this.contentRootLabel = requireElement(this.root, "[data-content-root]");
    this.contentPathLabel = requireElement(this.root, "[data-content-path]");
    this.contentStatus = requireElement(this.root, "[data-content-status]");
    this.contentSearch = requireElement(this.root, "[data-content-search]");
    this.contentTypeFilter = requireElement(this.root, "[data-content-type-filter]");
    this.folderTree = requireElement(this.root, "[data-folder-tree]");
    this.outlinerList = requireElement(this.root, "[data-outliner-list]");
    this.detailsBody = requireElement(this.root, "[data-details-body]");
    this.worldSettingsBody = requireElement(this.root, "[data-world-settings-body]");
    this.statusText = requireElement(this.root, "[data-status]");
    this.undoButton = requireElement(this.root, '[data-action="undo"]');
    this.redoButton = requireElement(this.root, '[data-action="redo"]');
    const projectName = requireElement(this.root, "[data-project-name]");

    this.buildToolbar();
    this.bindActions();
    this.renderDetails(null);
    this.renderWorldSettings(this.app.getWorldSettings());

    this.app.onSelectionChanged = (selection) => {
      this.selected = selection;
      this.detailsBaseline = null;
      this.renderDetails(selection);
    };
    this.app.onSceneObjectsChanged = (objects) => this.renderOutliner(objects);
    this.app.onHistoryChanged = (state) => this.renderHistory(state);
    this.app.onWorldSettingsChanged = (settings) => this.renderWorldSettings(settings);
    this.app.onPivotEditModeChanged = () => this.renderDetails(this.selected);
    this.app.onStatus = (message, tone) => this.setStatus(message, tone);

    this.renderOutliner(this.app.getSceneObjects());
    this.renderHistory(this.app.getHistoryState());
    void this.loadContent(projectName);
  }

  private buildToolbar(): void {
    const tools = requireElement(this.root, "[data-tools]");
    (["select", "move", "rotate", "scale"] as EditorTool[]).forEach((tool) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = TOOL_LABELS[tool];
      button.dataset.tool = tool;
      if (tool === "move") button.classList.add("active");
      button.addEventListener("click", () => {
        this.setActiveTool(tool);
      });
      tools.append(button);
      this.toolButtons.set(tool, button);
    });

    const spaceButton = document.createElement("button");
    spaceButton.type = "button";
    spaceButton.className = "space-toggle";
    spaceButton.dataset.spaceToggle = "";
    spaceButton.title = "Toggle transform space (X)";
    spaceButton.addEventListener("click", () => {
      this.updateSpaceButton(this.app.toggleTransformSpace());
    });
    tools.append(spaceButton);
  }

  private setActiveTool(tool: EditorTool): void {
    this.activeTool = tool;
    for (const [itemTool, item] of this.toolButtons) {
      item.classList.toggle("active", itemTool === tool);
    }
    this.app.setEditorTool(tool);
  }

  private updateSpaceButton(space: TransformSpace): void {
    const button = this.root.querySelector<HTMLButtonElement>("[data-space-toggle]");
    if (!button) return;
    button.textContent = space === "local" ? "Local" : "World";
    button.classList.toggle("active", space === "local");
  }

  private bindActions(): void {
    this.root.querySelector('[data-action="undo"]')?.addEventListener("click", () => {
      this.app.undo();
    });
    this.root.querySelector('[data-action="redo"]')?.addEventListener("click", () => {
      this.app.redo();
    });
    this.root.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
      this.app.deleteSelected();
    });
    this.root.querySelector('[data-action="play"]')?.addEventListener("click", () => {
      void this.playTest();
    });
    const collisionToggle = this.root.querySelector<HTMLInputElement>(
      '[data-show-flag="collision"]',
    );
    if (collisionToggle) {
      collisionToggle.checked = this.app.getShowCollision();
      collisionToggle.addEventListener("change", () => {
        this.app.setShowCollision(collisionToggle.checked);
      });
    }
    this.root.querySelector('[data-action="save"]')?.addEventListener("click", () => {
      void this.save();
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-add-actor]").forEach((button) => {
      const type = button.dataset.addActor;
      if (type === "directional" || type === "point" || type === "spot") {
        button.draggable = true;
        button.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("application/x-forge-light-actor", type);
          event.dataTransfer!.effectAllowed = "copy";
          event.dataTransfer?.setDragImage(this.getEmptyDragImage(), 0, 0);
          this.app.beginLightDragPreview(type);
          this.setStatus(`Dragging ${formatLightTypeLabel(type)} - drop in the viewport to place.`);
        });
        button.addEventListener("dragend", () => {
          this.app.endAssetDragPreview();
        });
      }
      button.addEventListener("click", () => {
        this.setStatus("Drag the actor into the viewport to place it.", "info");
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-add-shape]").forEach((button) => {
      const type = button.dataset.addShape;
      if (isShapePrimitiveType(type)) {
        const assetId = shapeAssetId(type);
        button.draggable = true;
        button.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("application/x-3dgamedev-asset", assetId);
          event.dataTransfer!.effectAllowed = "copy";
          event.dataTransfer?.setDragImage(this.getEmptyDragImage(), 0, 0);
          this.app.beginAssetDragPreview(assetId);
          this.setStatus(`Dragging ${formatShapeTypeLabel(type)} - drop in the viewport to place.`);
        });
        button.addEventListener("dragend", () => {
          this.app.endAssetDragPreview();
        });
      }
      button.addEventListener("click", () => {
        this.setStatus("Drag the actor into the viewport to place it.", "info");
      });
    });

    const playerStartButton = this.root.querySelector<HTMLButtonElement>("[data-add-player-start]");
    if (playerStartButton) {
      playerStartButton.draggable = true;
      playerStartButton.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("application/x-3dgamedev-asset", PLAYER_START_ASSET_ID);
        event.dataTransfer!.effectAllowed = "copy";
        event.dataTransfer?.setDragImage(this.getEmptyDragImage(), 0, 0);
        this.app.beginAssetDragPreview(PLAYER_START_ASSET_ID);
        this.setStatus("Dragging Player Start - drop in the viewport to place.");
      });
      playerStartButton.addEventListener("dragend", () => {
        this.app.endAssetDragPreview();
      });
      playerStartButton.addEventListener("click", () => {
        this.setStatus("Drag the actor into the viewport to place it.", "info");
      });
    }

    this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.inspectorTab;
        if (tab === "details" || tab === "world") this.setInspectorTab(tab);
      });
    });

    this.updateSpaceButton(this.app.getTransformSpace());

    this.contentToggle.addEventListener("click", () => {
      this.setContentDrawerOpen(!this.contentDrawerOpen);
    });

    this.root.querySelector("[data-content-refresh]")?.addEventListener("click", () => {
      void this.refreshAssetTree();
    });

    this.contentSearch.addEventListener("input", () => {
      this.contentQuery = this.contentSearch.value.trim().toLocaleLowerCase();
      this.renderContentAssets();
    });

    this.contentTypeFilter.addEventListener("change", () => {
      const value = this.contentTypeFilter.value;
      this.contentType = isContentTypeFilter(value) ? value : CONTENT_FILTER_ALL;
      this.renderContentAssets();
    });

    this.root.querySelectorAll<HTMLSelectElement>("[data-snap]").forEach((select) => {
      select.addEventListener("change", () => {
        const value = Number(select.value);
        if (!Number.isFinite(value)) return;
        if (select.dataset.snap === "move") this.app.setSnapSettings({ move: value });
        if (select.dataset.snap === "rotate") this.app.setSnapSettings({ rotate: value });
        if (select.dataset.snap === "scale") this.app.setSnapSettings({ scale: value });
      });
    });

    this.root.querySelectorAll<HTMLInputElement>("[data-snap-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.dataset.snapToggle === "move") {
          this.app.setSnapSettings({ moveEnabled: input.checked });
        }
        if (input.dataset.snapToggle === "rotate") {
          this.app.setSnapSettings({ rotateEnabled: input.checked });
        }
        if (input.dataset.snapToggle === "scale") {
          this.app.setSnapSettings({ scaleEnabled: input.checked });
        }
      });
    });

    this.root.querySelector<HTMLInputElement>("[data-outliner-search]")?.addEventListener(
      "input",
      (event) => {
        const input = event.currentTarget as HTMLInputElement;
        this.outlinerFilter = input.value.trim().toLocaleLowerCase();
        this.renderOutliner(this.outlinerObjects);
      },
    );

    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.app.isCameraNavigating()) return;
    if (event.metaKey || event.altKey || isEditableTarget(event.target)) return;

    if (event.ctrlKey) {
      if (event.code === "KeyZ" && !event.shiftKey) {
        event.preventDefault();
        this.app.undo();
      } else if (event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey)) {
        event.preventDefault();
        this.app.redo();
      } else if (event.code === "KeyS") {
        event.preventDefault();
        void this.save();
      } else if (event.code === "KeyD") {
        event.preventDefault();
        this.app.duplicateSelected();
      } else if (event.code === "KeyG") {
        event.preventDefault();
        this.app.groupSelected();
      } else if (event.code === "KeyA") {
        event.preventDefault();
        this.app.selectAllObjects();
      }
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      this.app.clearSelection();
    } else if (event.code === "KeyQ") {
      event.preventDefault();
      this.setActiveTool("select");
    } else if (event.code === "KeyW") {
      event.preventDefault();
      this.setActiveTool("move");
    } else if (event.code === "KeyE") {
      event.preventDefault();
      this.setActiveTool("rotate");
    } else if (event.code === "KeyR") {
      event.preventDefault();
      this.setActiveTool("scale");
    } else if (event.code === "Space") {
      event.preventDefault();
      this.setActiveTool(nextTransformTool(this.activeTool));
    } else if (event.code === "Delete") {
      event.preventDefault();
      this.app.deleteSelected();
    } else if (event.code === "KeyF") {
      event.preventDefault();
      this.app.focusSelected();
    } else if (event.code === "Digit1") {
      event.preventDefault();
      this.app.setTechnicalView("top");
    } else if (event.code === "Digit2") {
      event.preventDefault();
      this.app.setTechnicalView("front");
    } else if (event.code === "Digit3") {
      event.preventDefault();
      this.app.setTechnicalView("side");
    } else if (event.code === "KeyH" && event.shiftKey) {
      event.preventDefault();
      this.app.showHiddenObjects();
    } else if (event.code === "KeyH") {
      event.preventDefault();
      this.app.hideSelected();
    } else if (event.code === "KeyX") {
      event.preventDefault();
      this.updateSpaceButton(this.app.toggleTransformSpace());
    } else if (event.code === "KeyP") {
      event.preventDefault();
      void this.playTest();
    } else if (event.code === "End") {
      event.preventDefault();
      this.app.snapSelected();
    }
  }

  /**
   * Play/Test: saves the layout, then opens the game in a new tab. Single
   * codebase — the game is this same app's default route (`/`), so Play just
   * opens it; a project may still override with an external `editor.previewUrl`.
   */
  private async playTest(): Promise<void> {
    try {
      await this.app.saveLayout();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    // Hand the current viewport camera pose to the runtime (default camera mode
    // starts there). Temporary session override — not written to the layout.
    writePlayCameraPose(this.app.getPlayCameraPose());
    const previewUrl = this.projectInfo?.manifest.editor.previewUrl ?? "/";
    const opened = window.open(previewUrl, "_blank", "noopener");
    if (opened) {
      this.setStatus(`Saved. Opening game: ${previewUrl}`, "success");
    } else {
      this.setStatus(`Saved. Popup blocked — open ${previewUrl} manually.`, "warning");
    }
  }

  private async loadContent(projectName: HTMLElement): Promise<void> {
    try {
      const [projectInfo, assets] = await Promise.all([
        this.app.getEditorProjectInfo(),
        this.app.getEditableAssets(),
      ]);
      this.syncSnapControls(this.app.getSnapSettings());
      this.projectInfo = projectInfo;
      this.metadataSchema = this.app.getMetadataSchema();
      this.editableAssets = assets;
      this.selectedFolder = normalizeProjectPath(projectInfo.assetRoot);
      projectName.textContent = projectInfo.rootName;
      this.contentRootLabel.textContent = this.selectedFolder;
      await this.refreshAssetTree({ quiet: true });
    } catch (error) {
      this.contentStatus.textContent = error instanceof Error ? error.message : String(error);
      this.setStatus(this.contentStatus.textContent, "error");
    }
  }

  private setContentDrawerOpen(open: boolean): void {
    this.contentDrawerOpen = open;
    this.contentDrawer.classList.toggle("open", open);
    this.contentDrawer.setAttribute("aria-hidden", String(!open));
    this.contentToggle.classList.toggle("active", open);
    this.contentToggle.setAttribute("aria-expanded", String(open));

    window.clearInterval(this.contentRefreshTimer);
    this.contentRefreshTimer = 0;
    if (open) {
      void this.refreshAssetTree({ quiet: true });
      this.contentRefreshTimer = window.setInterval(() => {
        void this.refreshAssetTree({ quiet: true });
      }, 7000);
    }
  }

  private async refreshAssetTree(options: { quiet?: boolean } = {}): Promise<void> {
    if (!this.projectInfo) return;
    try {
      const assetRoot = normalizeProjectPath(this.projectInfo.assetRoot);
      if (!options.quiet) this.contentStatus.textContent = "Refreshing assets";
      const tree = await fetchProjectDir(assetRoot);
      const rootName = tree.root.split("/").at(-1) ?? "assets";
      this.assetTreeRoot = {
        name: rootName,
        path: tree.root,
        type: "dir",
        children: tree.children,
      };
      if (!this.selectedFolder) this.selectedFolder = tree.root;
      if (this.selectedFolder !== tree.root && !findProjectDir(tree.children, this.selectedFolder)) {
        this.selectedFolder = tree.root;
      }
      this.contentRootLabel.textContent = `${this.projectInfo.rootName} / ${tree.root}`;
      this.contentStatus.textContent = `${flattenProjectFiles([this.assetTreeRoot]).length} files`;
      this.renderFolderTree();
      this.renderContentFilters();
      this.renderContentAssets();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.contentStatus.textContent = message;
      if (!options.quiet) this.setStatus(message, "error");
    }
  }

  private renderFolderTree(): void {
    if (!this.assetTreeRoot) {
      this.folderTree.innerHTML = `<div class="empty-details">No asset folders</div>`;
      return;
    }
    this.folderTree.replaceChildren(this.createFolderRow(this.assetTreeRoot, 0));
  }

  private createFolderRow(node: ProjectDirNode, depth: number): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "folder-node";
    const childDirs = node.children?.filter((child) => child.type === "dir") ?? [];
    const hasChildDirs = childDirs.length > 0;
    const isCollapsed = hasChildDirs && this.collapsedFolderPaths.has(node.path);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-row";
    button.classList.toggle("has-children", hasChildDirs);
    button.style.setProperty("--depth", String(depth));
    button.classList.toggle("active", node.path === this.selectedFolder);
    button.title = node.path;
    if (hasChildDirs) button.setAttribute("aria-expanded", String(!isCollapsed));
    button.innerHTML = `
      <span class="folder-caret">${hasChildDirs ? (isCollapsed ? ">" : "v") : ""}</span>
      <span class="folder-name">${escapeHtml(node.name)}</span>
    `;
    button.addEventListener("click", () => {
      this.selectedFolder = node.path;
      if (hasChildDirs) {
        if (isCollapsed) {
          this.collapsedFolderPaths.delete(node.path);
        } else {
          this.collapsedFolderPaths.add(node.path);
        }
      }
      this.renderFolderTree();
      this.renderContentAssets();
    });
    wrapper.append(button);

    if (!isCollapsed) {
      for (const child of childDirs) {
        wrapper.append(this.createFolderRow(child, depth + 1));
      }
    }
    return wrapper;
  }

  private renderContentAssets(): void {
    if (!this.assetTreeRoot || !this.projectInfo) {
      this.contentList.innerHTML = `
        <div class="empty-details">
          <strong>No assets</strong>
          <span>Project folder is not loaded.</span>
        </div>
      `;
      return;
    }

    const selected =
      this.selectedFolder === this.assetTreeRoot.path
        ? this.assetTreeRoot
        : findProjectDir(this.assetTreeRoot.children ?? [], this.selectedFolder);
    const files = selected ? flattenProjectFiles([selected]) : [];
    const items = files
      .filter((file) => this.shouldDisplayAssetFile(file))
      .map((file) => this.toBrowserAssetItem(file))
      .filter((item) => this.contentType === CONTENT_FILTER_ALL || item.type === this.contentType)
      .filter((item) => {
        if (!this.contentQuery) return true;
        return `${item.label} ${item.type} ${item.path}`
          .toLocaleLowerCase()
          .includes(this.contentQuery);
      });
    const issueCount = items.filter((item) => contentAssetIssues(item).length > 0).length;
    const missingManifestAssetCount = this.countMissingManifestAssetFiles();

    this.contentPathLabel.textContent = this.selectedFolder || this.assetTreeRoot.path;
    this.contentStatus.textContent = formatContentListStatus(
      items.length,
      files.length,
      issueCount,
      missingManifestAssetCount,
    );

    if (items.length === 0) {
      this.contentList.innerHTML = `
        <div class="empty-details">
          <strong>No matching assets</strong>
          <span>${escapeHtml(this.selectedFolder)}</span>
        </div>
      `;
      return;
    }

    this.contentList.replaceChildren(
      ...items.map((item) => this.createAssetCard(item)),
    );
  }

  private renderContentFilters(): void {
    const allItems = this.assetTreeRoot
      ? flattenProjectFiles([this.assetTreeRoot])
          .filter((file) => this.shouldDisplayAssetFile(file))
          .map((file) => this.toBrowserAssetItem(file))
      : [];
    const types: BrowserAssetItem["type"][] = [...ASSET_TYPES];
    if (allItems.some((item) => item.type === "file")) types.push("file");

    this.contentType = this.replaceContentFilterOptions(
      this.contentTypeFilter,
      "All types",
      types,
      this.contentType,
      formatContentTypeLabel,
    ) as ContentTypeFilter;
  }

  private replaceContentFilterOptions(
    select: HTMLSelectElement,
    allLabel: string,
    values: string[],
    selected: string,
    labelForValue: (value: string) => string,
  ): string {
    const validValues = new Set([CONTENT_FILTER_ALL, ...values]);
    const nextValue = validValues.has(selected) ? selected : CONTENT_FILTER_ALL;
    const options = [
      new Option(allLabel, CONTENT_FILTER_ALL),
      ...values.map((value) => new Option(labelForValue(value), value)),
    ];
    select.replaceChildren(...options);
    select.value = nextValue;
    select.disabled = values.length === 0;
    return nextValue;
  }

  private shouldDisplayAssetFile(file: ProjectDirNode): boolean {
    if (file.type !== "file") return false;
    const name = file.name.toLocaleLowerCase();
    return !(name === "manifest.json" || name === "catalog.json");
  }

  private toBrowserAssetItem(file: ProjectDirNode): BrowserAssetItem {
    const editable = this.editableAssetByProjectPath().get(file.path);
    const base = {
      key: file.path,
      label: editable?.displayName ?? file.name,
      category: editable?.catalogCategory ?? file.ext ?? "file",
      path: file.path,
      ext: file.ext ?? "file",
      type: editable ? assetType(editable) : (inferAssetTypeFromPath(file.path) ?? "file"),
    } satisfies Omit<BrowserAssetItem, "editable">;
    return editable ? { ...base, editable } : base;
  }

  private editableAssetByProjectPath(): Map<string, EditableAsset> {
    // The Content Browser directory tree (`/__project-dir`) is public-scoped, so
    // its file paths are "assets/...". Manifest `asset.path` is also public-root
    // relative. Index both the bare "assets/..." key and the legacy
    // "public/assets/..." form so a manifest-registered file is matched instead
    // of being treated as "not registered" (which blocks drag-to-place).
    const publicDir = this.projectInfo?.manifest.publicDir ?? "public";
    const byPath = new Map<string, EditableAsset>();
    for (const asset of this.editableAssets) {
      const path = normalizeProjectPath(assetPath(asset));
      byPath.set(path, asset);
      const publicPrefixedPath = normalizeProjectPath(`${publicDir}/${path}`);
      if (publicPrefixedPath !== path) byPath.set(publicPrefixedPath, asset);
    }
    return byPath;
  }

  private countMissingManifestAssetFiles(): number {
    if (!this.assetTreeRoot || !this.projectInfo) return 0;
    const publicDir = this.projectInfo.manifest.publicDir ?? "public";
    const filePaths = new Set(
      flattenProjectFiles([this.assetTreeRoot]).map((file) => normalizeProjectPath(file.path)),
    );
    return this.editableAssets.filter((asset) => {
      const path = normalizeProjectPath(assetPath(asset));
      if (filePaths.has(path)) return false;
      return !filePaths.has(normalizeProjectPath(`${publicDir}/${path}`));
    }).length;
  }

  /** A preloaded 1x1 transparent image used as the drag image so the browser
   *  doesn't render its default card snapshot during a drag. */
  private getEmptyDragImage(): HTMLImageElement {
    if (!this.emptyDragImage) {
      const image = new Image();
      image.src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      this.emptyDragImage = image;
    }
    return this.emptyDragImage;
  }

  /** Highlight a single Content Browser asset card without re-rendering the
   *  whole grid (re-renders re-apply the class from `selectedAssetId`). */
  private setSelectedAsset(assetId: string | null): void {
    this.selectedAssetId = assetId;
    for (const card of this.contentList.querySelectorAll<HTMLElement>(".asset-card")) {
      card.classList.toggle("is-selected", card.dataset.assetId === assetId);
    }
  }

  private createAssetCard(item: BrowserAssetItem): HTMLElement {
    const canPlace = Boolean(item.editable?.placeable);
    const issues = contentAssetIssues(item);
    const issueTooltip = contentAssetIssueTooltip(issues);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "asset-card";
    card.classList.toggle("is-unregistered", !item.editable);
    card.classList.toggle("has-issues", issues.length > 0);
    card.classList.toggle(
      "is-selected",
      Boolean(item.editable && item.editable.id === this.selectedAssetId),
    );
    card.draggable = canPlace;
    card.dataset.assetPath = item.path;
    if (item.editable) card.dataset.assetId = item.editable.id;
    card.innerHTML = `
      ${
        issues.length > 0
          ? `<span class="asset-issue-dot" title="${escapeHtml(issueTooltip)}" aria-label="${escapeHtml(issueTooltip)}"></span>`
          : ""
      }
      <span class="asset-thumb" data-asset-thumb>${escapeHtml(item.ext.toUpperCase())}</span>
      <span class="asset-meta">
        <strong title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</strong>
        <span class="asset-type-line">${escapeHtml(formatContentTypeBadge(item.type))}</span>
      </span>
    `;
    card.addEventListener("dragstart", (event) => {
      if (!item.editable || !canPlace) return;
      event.dataTransfer?.setData("application/x-3dgamedev-asset", item.editable.id);
      event.dataTransfer!.effectAllowed = "copy";
      // Hide the browser's default drag image (a snapshot of the card) so only
      // the 3D placement ghost in the viewport tracks the cursor.
      event.dataTransfer?.setDragImage(this.getEmptyDragImage(), 0, 0);
      this.setSelectedAsset(item.editable.id);
      // Spawn the live placement ghost so the viewport shows where it will land.
      this.app.beginAssetDragPreview(item.editable.id);
      this.setStatus(`Dragging ${item.editable.id} — drop in the viewport to place.`);
    });
    card.addEventListener("dragend", () => {
      this.app.endAssetDragPreview();
    });
    card.addEventListener("click", () => {
      if (!item.editable) {
        this.showContentAssetDetails(item, issues);
        return;
      }
      // Click only selects; placement is drag-and-drop into the viewport.
      this.setSelectedAsset(item.editable.id);
      this.showContentAssetDetails(item, issues);
    });
    if (item.type !== "file" && isModelAssetType(item.type)) {
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        void this.openStaticMeshEditor(item);
      });
    }
    const thumb = card.querySelector<HTMLElement>("[data-asset-thumb]");
    if (thumb && item.type !== "file" && isModelAssetType(item.type)) {
      void this.renderAssetThumbnail(item, thumb);
    }
    return card;
  }

  private showContentAssetDetails(item: BrowserAssetItem, issues: BrowserAssetIssue[]): void {
    const prefix = `${item.label} · ${formatContentTypeBadge(item.type)}`;
    this.contentStatus.textContent =
      issues.length > 0 ? `${prefix} · ${contentAssetIssueTooltip(issues)}` : `${prefix} · No issues`;
  }

  private async renderAssetThumbnail(
    item: BrowserAssetItem,
    thumb: HTMLElement,
  ): Promise<void> {
    try {
      const imageUrl = await this.thumbnailRenderer.renderModel(projectFileUrl(item.path));
      if (!thumb.isConnected) return;
      thumb.replaceChildren();
      const image = document.createElement("img");
      image.alt = "";
      image.src = imageUrl;
      thumb.append(image);
    } catch {
      if (thumb.isConnected) thumb.textContent = item.ext.toUpperCase();
    }
  }

  /**
   * Opens the Static Mesh editor for a model asset (Content Browser
   * double-click). Dynamically imported so its Three.js geometry helpers stay
   * out of the editor entry until a model is actually opened.
   */
  private async openStaticMeshEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { StaticMeshEditor } = await import("@/editor/StaticMeshEditor");
      StaticMeshEditor.open({
        modelPath: item.path,
        label: item.label,
        onStatus: (message, tone) => this.setStatus(message, tone),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Static Mesh editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  private renderOutliner(objects: EditableSceneObject[]): void {
    this.outlinerObjects = objects;

    if (this.outlinerFilter) {
      const matches = objects.filter((object) => {
        const haystack = `${object.label} ${object.assetId} ${object.kind}`.toLocaleLowerCase();
        return haystack.includes(this.outlinerFilter);
      });
      this.replaceOutlinerRows(matches.map((object) => ({ object, depth: 0 })), objects.length);
      return;
    }

    this.replaceOutlinerRows(this.orderOutlinerTree(objects), objects.length);
  }

  /** Depth-first order so children render indented under their parent. */
  private orderOutlinerTree(
    objects: EditableSceneObject[],
  ): Array<{ object: EditableSceneObject; depth: number }> {
    const byNodeId = new Map<string, EditableSceneObject>();
    for (const object of objects) {
      if (object.nodeId) byNodeId.set(object.nodeId, object);
    }
    const childrenByParent = new Map<string, EditableSceneObject[]>();
    for (const object of objects) {
      if (!object.parentId || !byNodeId.has(object.parentId)) continue;
      const list = childrenByParent.get(object.parentId) ?? [];
      list.push(object);
      childrenByParent.set(object.parentId, list);
    }

    const ordered: Array<{ object: EditableSceneObject; depth: number }> = [];
    const visited = new Set<string>();
    const walk = (object: EditableSceneObject, depth: number): void => {
      if (visited.has(object.id)) return;
      visited.add(object.id);
      ordered.push({ object, depth });
      if (object.nodeId) {
        for (const child of childrenByParent.get(object.nodeId) ?? []) walk(child, depth + 1);
      }
    };
    for (const object of objects) {
      if (!object.parentId || !byNodeId.has(object.parentId)) walk(object, 0);
    }
    // Any leftover (cycle) objects get appended at root depth.
    for (const object of objects) if (!visited.has(object.id)) walk(object, 0);
    return ordered;
  }

  private replaceOutlinerRows(
    entries: Array<{ object: EditableSceneObject; depth: number }>,
    totalCount: number,
  ): void {
    if (entries.length === 0) {
      this.outlinerList.innerHTML = `
        <div class="empty-details">
          <strong>${totalCount === 0 ? "No objects" : "No matches"}</strong>
          <span>Scene</span>
        </div>
      `;
      return;
    }
    this.outlinerList.replaceChildren(
      ...entries.map((entry) => this.buildOutlinerRow(entry.object, entry.depth)),
    );
  }

  private buildOutlinerRow(object: EditableSceneObject, depth: number): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "outliner-row";
    row.dataset.objectId = object.id;
    row.draggable = true;
    if (object.selected) row.classList.add("active");
    if (object.hidden) row.classList.add("is-hidden");
    if (object.groupId) row.classList.add("is-grouped");
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.innerHTML = `
      <span class="outliner-kind">${outlinerKindLabel(object.kind)}</span>
      <span class="outliner-meta">
        <strong>${object.groupId ? "⛓ " : ""}${object.label}</strong>
        <small>${object.assetId} - ${formatPosition(object.position)}</small>
      </span>
      <span class="outliner-actions">
        <button type="button" class="outliner-toggle${object.hidden ? " on" : ""}"
          data-action="hidden" title="${object.hidden ? "Show object" : "Hide object"}">${object.hidden ? "🙈" : "👁"}</button>
        <button type="button" class="outliner-toggle${object.locked ? " on" : ""}"
          data-action="locked" title="${object.locked ? "Unlock object" : "Lock object"}">${object.locked ? "🔒" : "🔓"}</button>
      </span>
    `;
    row.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".outliner-actions")) return;
      this.app.selectSceneObject(object.id, {
        additive: event.ctrlKey || event.shiftKey,
      });
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openOutlinerContextMenu(event, object);
    });
    row.addEventListener("dblclick", (event) => {
      if ((event.target as HTMLElement).closest(".outliner-actions")) return;
      const nextName = window.prompt("Rename object", object.label);
      if (nextName === null) return;
      this.app.renameSceneObject(object.id, nextName);
    });
    row
      .querySelector<HTMLButtonElement>('[data-action="hidden"]')
      ?.addEventListener("click", () => {
        this.app.setSceneObjectHidden(object.id, !object.hidden);
      });
    row
      .querySelector<HTMLButtonElement>('[data-action="locked"]')
      ?.addEventListener("click", () => {
        this.app.setSceneObjectLocked(object.id, !object.locked);
      });

    // Drag-and-drop parenting: drag a row (or the whole multi-selection if the
    // dragged row is part of it) onto another row to parent it there.
    row.addEventListener("dragstart", (event) => {
      const selectedIds = this.outlinerObjects
        .filter((entry) => entry.selected)
        .map((entry) => entry.id);
      this.outlinerDragIds =
        object.selected && selectedIds.length > 1 ? selectedIds : [object.id];
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", this.outlinerDragIds.join(","));
      }
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => {
      this.outlinerDragIds = [];
      row.classList.remove("is-dragging");
      for (const el of this.outlinerList.querySelectorAll(".drop-target")) {
        el.classList.remove("drop-target");
      }
    });
    row.addEventListener("dragover", (event) => {
      if (this.outlinerDragIds.length === 0) return;
      if (this.outlinerDragIds.includes(object.id)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drop-target");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("drop-target");
      const childIds = this.outlinerDragIds.filter((id) => id !== object.id);
      this.outlinerDragIds = [];
      if (childIds.length > 0) this.app.parentObjectsTo(childIds, object.id);
    });
    return row;
  }

  /** Right-click menu for outliner rows: rename / duplicate / group / delete. */
  private openOutlinerContextMenu(event: MouseEvent, object: EditableSceneObject): void {
    this.closeContextMenu();

    const selectedCount = this.outlinerObjects.filter((entry) => entry.selected).length;
    const inGroup =
      object.groupId !== undefined ||
      this.outlinerObjects.some((entry) => entry.selected && entry.groupId);

    const ensureSelected = (): void => {
      if (!object.selected) this.app.selectSceneObject(object.id);
    };

    const items: Array<{ label: string; enabled: boolean; danger?: boolean; run: () => void }> = [
      {
        label: "Rename",
        enabled: true,
        run: () => {
          const next = window.prompt("Rename object", object.label);
          if (next !== null) this.app.renameSceneObject(object.id, next);
        },
      },
      {
        label: "Duplicate",
        enabled: true,
        run: () => {
          ensureSelected();
          this.app.duplicateSelected();
        },
      },
      {
        label: "Group Selected",
        enabled: selectedCount >= 2,
        run: () => this.app.groupSelected(),
      },
      {
        label: "Ungroup",
        enabled: inGroup,
        run: () => {
          ensureSelected();
          this.app.ungroupSelected();
        },
      },
      {
        label: "Parent to active",
        enabled: selectedCount >= 2,
        run: () => this.app.parentSelectionToActive(),
      },
      {
        label: "Unparent",
        enabled:
          object.parentId !== undefined ||
          this.outlinerObjects.some((entry) => entry.selected && entry.parentId),
        run: () => {
          ensureSelected();
          this.app.unparentSelected();
        },
      },
      {
        label: "Delete",
        enabled: true,
        danger: true,
        run: () => {
          ensureSelected();
          this.app.deleteSelected();
        },
      },
    ];

    const menu = document.createElement("div");
    menu.className = "context-menu";
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `context-menu-item${item.danger ? " danger" : ""}`;
      button.textContent = item.label;
      button.disabled = !item.enabled;
      button.addEventListener("click", () => {
        this.closeContextMenu();
        item.run();
      });
      menu.appendChild(button);
    }
    document.body.appendChild(menu);

    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - margin);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - margin);
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;
    this.contextMenu = menu;

    const onPointerDown = (pointerEvent: Event): void => {
      if (!menu.contains(pointerEvent.target as Node)) this.closeContextMenu();
    };
    const onKeyDown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.code === "Escape") this.closeContextMenu();
    };
    // Defer so the opening event doesn't immediately dismiss the menu.
    window.setTimeout(() => document.addEventListener("pointerdown", onPointerDown), 0);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", this.closeContextMenu);
    this.contextMenuCleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", this.closeContextMenu);
    };
  }

  private closeContextMenu = (): void => {
    this.contextMenuCleanup?.();
    this.contextMenuCleanup = null;
    this.contextMenu?.remove();
    this.contextMenu = null;
  };

  private renderHistory(state: EditorHistoryState): void {
    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.undoButton.title = state.undoLabel ? `Undo ${state.undoLabel}` : "Undo";
    this.redoButton.title = state.redoLabel ? `Redo ${state.redoLabel}` : "Redo";
  }

  private setInspectorTab(tab: InspectorTab): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
      const active = button.dataset.inspectorTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    this.root.querySelectorAll<HTMLElement>("[data-inspector-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.inspectorPane !== tab;
    });
    if (tab === "world") this.renderWorldSettings(this.worldSettings ?? this.app.getWorldSettings());
  }

  private renderWorldSettings(settings: EditorWorldSettings): void {
    this.worldSettings = settings;
    const gameModeOptions = GAME_MODE_OPTIONS.map(
      (option) =>
        `<option value="${escapeHtml(option.id)}" ${
          option.id === settings.gameMode ? "selected" : ""
        }>${escapeHtml(option.displayName)}</option>`,
    ).join("");
    const gameModeDescription =
      GAME_MODE_OPTIONS.find((option) => option.id === settings.gameMode)?.description ?? "";
    this.worldSettingsBody.innerHTML = `
      <div class="detail-heading">
        <strong>World Settings</strong>
        <span>Scene rendering</span>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Game Mode</div>
        <label class="detail-row">
          <span>Mode</span>
          <select data-world-game-mode>${gameModeOptions}</select>
        </label>
        <div class="detail-hint">${escapeHtml(gameModeDescription)}</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Lighting</div>
        <div class="detail-row">
          <span>Lighting Mode</span>
          <span class="detail-value">${settings.lightingMode}</span>
        </div>
        <div class="detail-row">
          <span>Shadow Filter</span>
          <span class="detail-value">${settings.shadowFilter}</span>
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Environment</div>
        <label class="detail-row">
          <span>Background</span>
          <input type="color" data-world-color="backgroundColor"
            value="${escapeHtml(settings.backgroundColor)}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Ambient Light</div>
        <label class="detail-row">
          <span>Color</span>
          <input type="color" data-world-color="ambientColor"
            value="${escapeHtml(settings.ambientColor)}" />
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input type="number" data-world-number="ambientIntensity" min="0" max="20" step="0.05"
            value="${escapeHtml(String(settings.ambientIntensity))}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Static Objects</div>
        <label class="detail-toggle">
          <input type="checkbox" data-world-toggle="staticObjectsCastShadow" ${
            settings.staticObjectsCastShadow ? "checked" : ""
          } />
          <span>Cast Shadow</span>
        </label>
        <label class="detail-toggle">
          <input type="checkbox" data-world-toggle="staticObjectsReceiveShadow" ${
            settings.staticObjectsReceiveShadow ? "checked" : ""
          } />
          <span>Receive Shadow</span>
        </label>
      </div>
    `;

    this.worldSettingsBody
      .querySelectorAll<HTMLInputElement>("[data-world-toggle]")
      .forEach((toggle) => {
        toggle.addEventListener("change", () => {
          const key = toggle.dataset.worldToggle;
          if (key === "staticObjectsCastShadow") {
            this.app.setWorldSettings({ staticObjectsCastShadow: toggle.checked });
          }
          if (key === "staticObjectsReceiveShadow") {
            this.app.setWorldSettings({ staticObjectsReceiveShadow: toggle.checked });
          }
        });
      });

    this.worldSettingsBody
      .querySelectorAll<HTMLInputElement>("[data-world-color]")
      .forEach((input) => {
        const key = input.dataset.worldColor as "backgroundColor" | "ambientColor";
        // "change" fires when the picker closes -> one command + one auto-save.
        input.addEventListener("change", () => this.app.setWorldSettings({ [key]: input.value }));
      });

    this.worldSettingsBody
      .querySelector<HTMLInputElement>('[data-world-number="ambientIntensity"]')
      ?.addEventListener("change", (event) => {
        const value = Number((event.currentTarget as HTMLInputElement).value);
        if (Number.isFinite(value)) this.app.setWorldSettings({ ambientIntensity: value });
      });

    this.worldSettingsBody
      .querySelector<HTMLSelectElement>("[data-world-game-mode]")
      ?.addEventListener("change", (event) => {
        this.app.setWorldSettings({ gameMode: (event.currentTarget as HTMLSelectElement).value });
      });
  }

  private renderDetails(selection: EditableSelection | null): void {
    if (!selection) {
      this.detailsScale = null;
      this.detailsBody.innerHTML = `
        <div class="empty-details">
          <strong>No selection</strong>
          <span>Viewport</span>
        </div>
      `;
      return;
    }
    if (selection.kind === "light") {
      this.renderLightDetails(selection);
      return;
    }

    this.detailsScale = [...selection.scale];

    const lockedAttr = selection.locked ? "disabled" : "";
    const wallDisabled = selection.locked || selection.kind === "character" ? "disabled" : "";
    const castShadowToggle =
      selection.kind === "character"
        ? `<label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="castShadow" ${
            selection.castShadow ? "checked" : ""
          } />
          <span>Cast Shadow</span>
        </label>`
        : "";
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>${selection.kind} / ${escapeHtml(selection.assetId)}</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="${escapeHtml(selection.assetId)}" />
      </label>
      <div class="detail-row">
        <span>Category</span>
        <span class="detail-value">${
          selection.category ? escapeHtml(selection.category) : "—"
        }</span>
      </div>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      ${pivotRow(selection.pivot, selection.locked, this.app.isPivotEditMode())}
      <div class="detail-section">
        <div class="detail-actions-row">
          <button type="button" data-detail-action="reset" ${lockedAttr}
            title="Reset rotation to 0 and scale to 1">Reset</button>
          <button type="button" data-detail-action="copy"
            title="Copy this transform">Copy</button>
          <button type="button" data-detail-action="paste" ${lockedAttr}
            title="Paste the copied transform">Paste</button>
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Placement</div>
        <div class="detail-actions-row">
          <button type="button" data-detail-action="snap-floor" ${lockedAttr}
            title="Drop onto the surface below (End)">Snap to Floor</button>
          <button type="button" data-detail-action="snap-wall" ${wallDisabled}
            title="Snap flush against the nearest wall">Snap to Wall</button>
        </div>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="locked" ${selection.locked ? "checked" : ""} />
          <span>Lock Movement</span>
        </label>
        ${castShadowToggle}
      </div>
      ${this.renderCollisionSection(selection)}
      ${this.renderPhysicsSection(selection, selection.locked)}
      ${this.renderInteractionSection(selection)}
      ${this.renderMetadataSections(selection)}
    `;

    this.detailsBody
      .querySelectorAll<HTMLInputElement>('input[data-detail="pr"]')
      .forEach((input) => {
        input.addEventListener("focus", () => this.beginDetailsEdit());
        input.addEventListener("input", () => {
          this.beginDetailsEdit();
          this.applyDetails();
        });
        input.addEventListener("change", () => this.commitDetailsEdit());
      });

    this.detailsBody
      .querySelectorAll<HTMLInputElement>('input[data-detail="scale"]')
      .forEach((input) => {
        input.addEventListener("focus", () => this.beginDetailsEdit());
        input.addEventListener("input", () => {
          this.beginDetailsEdit();
          this.applyScaleInput(input);
          this.applyDetails();
        });
        input.addEventListener("change", () => this.commitDetailsEdit());
      });

    this.detailsBody
      .querySelector<HTMLButtonElement>("[data-scale-lock]")
      ?.addEventListener("click", () => {
        this.app.setSelectionScaleLocked(!selection.scaleLocked);
      });

    this.detailsBody
      .querySelectorAll<HTMLInputElement>("input[data-pivot]")
      .forEach((input) => {
        input.addEventListener("change", () => this.commitPivotInput());
      });

    this.detailsBody
      .querySelectorAll<HTMLButtonElement>("[data-pivot-preset]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const preset = button.dataset.pivotPreset;
          if (preset === "reset" || preset === "center" || preset === "base") {
            this.app.applySelectionPivotPreset(preset);
          }
        });
      });

    this.detailsBody
      .querySelector<HTMLButtonElement>("[data-pivot-drag]")
      ?.addEventListener("click", () => this.app.togglePivotEditMode());

    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-detail-name]");
    nameInput?.addEventListener("change", () => {
      this.app.renameSceneObject(selection.id, nameInput.value);
    });

    this.detailsBody
      .querySelectorAll<HTMLButtonElement>("[data-detail-action]")
      .forEach((button) => {
        button.addEventListener("click", () =>
          this.handleDetailAction(button.dataset.detailAction ?? ""),
        );
      });

    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-detail-toggle]")
      .forEach((toggle) => {
        toggle.addEventListener("change", () =>
          this.handleDetailToggle(toggle.dataset.detailToggle ?? "", toggle.checked),
        );
      });

    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-collision-preset]")
      ?.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        this.app.setSelectionCollisionPreset(value ? (value as CollisionPresetId) : undefined);
      });

    this.bindPhysicsInputs();
    this.bindInteractionInputs();
    this.bindMetadataInputs();
  }

  /**
   * Per-object Collision section. Mirrors Unreal's component-level collision:
   * the Collision toggle plus a preset override that defaults to the asset's
   * collision definition ("inherit") until the user picks one.
   */
  private renderCollisionSection(selection: EditableSelection): string {
    const presetOptions = [
      `<option value="" ${selection.collisionPreset ? "" : "selected"}>Inherit (asset default)</option>`,
    ]
      .concat(
        COLLISION_PRESET_IDS.map(
          (id) =>
            `<option value="${id}" ${
              selection.collisionPreset === id ? "selected" : ""
            }>${COLLISION_PRESET_LABELS[id]}</option>`,
        ),
      )
      .join("");
    return `
      <div class="detail-section">
        <div class="detail-section-title">Collision</div>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="collision" ${
            selection.collision ? "checked" : ""
          } />
          <span>Collision</span>
        </label>
        <label class="detail-row">
          <span>Collision Presets</span>
          <select data-collision-preset>${presetOptions}</select>
        </label>
      </div>
    `;
  }

  private renderPhysicsSection(selection: EditableSelection, locked: boolean): string {
    const physics = selection.physics;
    const disabled = locked ? "disabled" : "";
    const linearDamping = physics.linearDamping ?? DEFAULT_LINEAR_DAMPING;
    const angularDamping = physics.angularDamping ?? DEFAULT_ANGULAR_DAMPING;
    const enableGravity = physics.enableGravity ?? true;
    const lockPosition = physics.lockPosition ?? [false, false, false];
    const lockRotation = physics.lockRotation ?? [false, false, false];

    return `
      <div class="detail-section detail-physics-section">
        <div class="detail-section-title">Physics</div>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="simulatePhysics" ${
            selection.simulatePhysics ? "checked" : ""
          } ${disabled} />
          <span>Simulate Physics</span>
        </label>
        <label class="detail-row">
          <span>Mass (kg)</span>
          <input data-physics-number="massKg" type="number" step="0.1" min="0.001"
            max="1000000" value="${physics.massKg ?? ""}" placeholder="Auto" ${disabled} />
        </label>
        <label class="detail-row">
          <span>Linear Damping</span>
          <input data-physics-number="linearDamping" type="number" step="0.01" min="0"
            max="100" value="${linearDamping}" ${disabled} />
        </label>
        <label class="detail-row">
          <span>Angular Damping</span>
          <input data-physics-number="angularDamping" type="number" step="0.01" min="0"
            max="100" value="${angularDamping}" ${disabled} />
        </label>
        <label class="detail-toggle">
          <input type="checkbox" data-physics-toggle="enableGravity" ${
            enableGravity ? "checked" : ""
          } ${disabled} />
          <span>Enable Gravity</span>
        </label>
        <div class="detail-subsection-title">Constraints</div>
        ${physicsLockRow("Lock Position", "position", lockPosition, locked)}
        ${physicsLockRow("Lock Rotation", "rotation", lockRotation, locked)}
      </div>
    `;
  }

  /**
   * Per-object Interaction component (§3). Absent → an "Add Interaction" button;
   * present → editable fields (action/prompt/enabled/cooldown) plus Remove. Each
   * change routes through `setSelectionInteraction`, so add/remove/edit are
   * single undo/redo commands. The required Transform component has no remove.
   */
  private renderInteractionSection(selection: EditableSelection): string {
    const interaction = selection.interaction;
    if (!interaction) {
      return `
      <div class="detail-section">
        <div class="detail-section-title">Interaction</div>
        <div class="detail-actions-row">
          <button type="button" data-interaction-add
            title="Add an Interaction component">Add Interaction</button>
        </div>
      </div>`;
    }
    return `
      <div class="detail-section">
        <div class="detail-section-title detail-component-title">
          <span>Interaction</span>
          <button type="button" data-interaction-remove
            title="Remove the Interaction component">Remove</button>
        </div>
        <label class="detail-row">
          <span>Action</span>
          <input type="text" data-interaction="action"
            value="${escapeHtml(interaction.action)}" placeholder="interact" />
        </label>
        <label class="detail-row">
          <span>Prompt</span>
          <input type="text" data-interaction="prompt"
            value="${escapeHtml(interaction.prompt ?? "")}" placeholder="(none)" />
        </label>
        <label class="detail-toggle">
          <input type="checkbox" data-interaction="enabled" ${
            interaction.enabled !== false ? "checked" : ""
          } />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Cooldown (s)</span>
          <input type="number" data-interaction="cooldown" min="0" max="3600" step="0.1"
            value="${interaction.cooldown ?? ""}" placeholder="0" />
        </label>
      </div>`;
  }

  private bindInteractionInputs(): void {
    this.detailsBody
      .querySelector<HTMLButtonElement>("[data-interaction-add]")
      ?.addEventListener("click", () => this.app.setSelectionInteraction({ action: "interact" }));
    this.detailsBody
      .querySelector<HTMLButtonElement>("[data-interaction-remove]")
      ?.addEventListener("click", () => this.app.setSelectionInteraction(undefined));
    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-interaction]")
      .forEach((input) => {
        input.addEventListener("change", () => this.commitInteractionInput());
      });
  }

  /** Rebuilds the Interaction component from the current inputs and commits it. */
  private commitInteractionInput(): void {
    const actionInput = this.detailsBody.querySelector<HTMLInputElement>('[data-interaction="action"]');
    if (!actionInput) return;
    const interaction: LayoutInteraction = { action: actionInput.value.trim() || "interact" };
    const prompt = this.detailsBody
      .querySelector<HTMLInputElement>('[data-interaction="prompt"]')
      ?.value.trim();
    if (prompt) interaction.prompt = prompt;
    const enabled = this.detailsBody.querySelector<HTMLInputElement>('[data-interaction="enabled"]');
    if (enabled && !enabled.checked) interaction.enabled = false;
    const cooldownRaw = this.detailsBody
      .querySelector<HTMLInputElement>('[data-interaction="cooldown"]')
      ?.value.trim();
    if (cooldownRaw) {
      const cooldown = Number(cooldownRaw);
      if (Number.isFinite(cooldown) && cooldown > 0) interaction.cooldown = cooldown;
    }
    this.app.setSelectionInteraction(interaction);
  }

  /**
   * Renders schema-driven gameplay metadata groups for the selection. The editor
   * core stays generic: groups/fields come from the project's metadata schema.
   */
  private renderMetadataSections(selection: EditableSelection): string {
    const groups = metadataGroupsForTarget(this.metadataSchema, {
      kind: selection.kind,
      category: selection.category,
    });
    if (groups.length === 0) return "";
    return groups
      .map(
        (group) => `
      <div class="detail-section">
        <div class="detail-section-title">${escapeHtml(group.title)}</div>
        ${group.fields.map((field) => this.renderMetadataField(field, selection)).join("")}
      </div>`,
      )
      .join("");
  }

  private renderMetadataField(field: MetadataFieldDef, selection: EditableSelection): string {
    const raw = selection.metadata[field.key] ?? field.default;
    const attr = `data-meta-key="${escapeHtml(field.key)}" data-meta-type="${field.type}"`;
    const label = escapeHtml(field.label);

    if (field.type === "boolean") {
      const checked = raw === true ? "checked" : "";
      return `<label class="detail-toggle">
        <input type="checkbox" ${attr} ${checked} />
        <span>${label}</span>
      </label>`;
    }

    if (field.type === "select") {
      const current = typeof raw === "string" ? raw : "";
      const options = [`<option value="">—</option>`]
        .concat(
          (field.options ?? []).map(
            (option) =>
              `<option value="${escapeHtml(option)}" ${
                option === current ? "selected" : ""
              }>${escapeHtml(option)}</option>`,
          ),
        )
        .join("");
      return `<label class="detail-row">
        <span>${label}</span>
        <select ${attr}>${options}</select>
      </label>`;
    }

    if (field.type === "number") {
      const value = typeof raw === "number" ? String(raw) : "";
      const min = field.min !== undefined ? `min="${field.min}"` : "";
      const max = field.max !== undefined ? `max="${field.max}"` : "";
      const step = field.step !== undefined ? `step="${field.step}"` : "";
      return `<label class="detail-row">
        <span>${label}</span>
        <input type="number" ${attr} ${min} ${max} ${step}
          value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder ?? "")}" />
      </label>`;
    }

    // text + tags share a free-text input; tags is comma-separated.
    const value =
      field.type === "tags"
        ? (Array.isArray(raw) ? raw : []).join(", ")
        : typeof raw === "string"
          ? raw
          : "";
    const placeholder =
      field.placeholder ?? (field.type === "tags" ? "comma, separated, tags" : "");
    const listAttr = field.suggestions?.length
      ? `list="meta-list-${escapeHtml(field.key)}"`
      : "";
    const datalist = field.suggestions?.length
      ? `<datalist id="meta-list-${escapeHtml(field.key)}">${field.suggestions
          .map((option) => `<option value="${escapeHtml(option)}"></option>`)
          .join("")}</datalist>`
      : "";
    return `<label class="detail-row">
      <span>${label}</span>
      <input type="text" ${attr} ${listAttr} value="${escapeHtml(value)}"
        placeholder="${escapeHtml(placeholder)}" />
      ${datalist}
    </label>`;
  }

  private bindMetadataInputs(): void {
    this.detailsBody
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-meta-key]")
      .forEach((input) => {
        input.addEventListener("change", () => this.commitMetadataInput(input));
      });
  }

  private bindPhysicsInputs(): void {
    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-physics-number]")
      .forEach((input) => {
        input.addEventListener("change", () => this.commitPhysicsNumber(input));
      });

    this.detailsBody
      .querySelector<HTMLInputElement>('[data-physics-toggle="enableGravity"]')
      ?.addEventListener("change", (event) => {
        this.app.setSelectionPhysics({
          enableGravity: (event.currentTarget as HTMLInputElement).checked,
        });
      });

    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-physics-lock]")
      .forEach((input) => {
        input.addEventListener("change", () => this.commitPhysicsLocks());
      });
  }

  private commitPhysicsNumber(input: HTMLInputElement): void {
    const key = input.dataset.physicsNumber as keyof Pick<
      LayoutPhysics,
      "massKg" | "linearDamping" | "angularDamping"
    > | undefined;
    if (!key) return;
    const trimmed = input.value.trim();
    if (trimmed === "") {
      this.app.setSelectionPhysics({ [key]: undefined });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return;
    this.app.setSelectionPhysics({ [key]: value });
  }

  private commitPhysicsLocks(): void {
    const readLocks = (kind: "position" | "rotation"): [boolean, boolean, boolean] => {
      return [0, 1, 2].map((axis) => {
        const input = this.detailsBody.querySelector<HTMLInputElement>(
          `input[data-physics-lock="${kind}"][data-axis="${axis}"]`,
        );
        return input?.checked ?? false;
      }) as [boolean, boolean, boolean];
    };
    this.app.setSelectionPhysics({
      lockPosition: readLocks("position"),
      lockRotation: readLocks("rotation"),
    });
  }

  private commitMetadataInput(input: HTMLInputElement | HTMLSelectElement): void {
    const key = input.dataset.metaKey;
    const type = input.dataset.metaType as MetadataFieldDef["type"] | undefined;
    if (!key || !type) return;
    const field = this.metadataFieldFor(key);
    if (!field) return;

    let value: MetadataValue | undefined;
    if (type === "boolean") {
      value = (input as HTMLInputElement).checked;
    } else if (type === "number") {
      const num = Number(input.value);
      value = input.value.trim() === "" || Number.isNaN(num) ? undefined : num;
    } else if (type === "tags") {
      value = input.value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    } else {
      value = input.value;
    }

    if (value !== undefined && isDefaultMetadataValue(field, value)) value = undefined;
    this.app.setSelectionMetadata(key, value, `Set ${field.label}`);
  }

  private metadataFieldFor(key: string): MetadataFieldDef | null {
    if (!this.selected) return null;
    const groups = metadataGroupsForTarget(this.metadataSchema, {
      kind: this.selected.kind,
      category: this.selected.category,
    });
    for (const group of groups) {
      const field = group.fields.find((entry) => entry.key === key);
      if (field) return field;
    }
    return null;
  }

  private renderLightDetails(selection: EditableSelection): void {
    this.detailsScale = [1, 1, 1];
    const lockedAttr = selection.locked ? "disabled" : "";
    const isPoint = selection.lightType === "point";
    const isSpot = selection.lightType === "spot";
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>light / ${escapeHtml(selection.lightType ?? selection.assetId)}</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="${escapeHtml(selection.assetId)}" />
      </label>
      <div class="detail-row">
        <span>Type</span>
        <span class="detail-value">${escapeHtml(selection.lightType ?? "light")}</span>
      </div>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${!isPoint ? vectorRow("Rotation", "r", selection.rotation, 1, selection.locked) : ""}
      <div class="detail-section">
        <div class="detail-section-title">Light</div>
        <label class="detail-row">
          <span>Color</span>
          <input data-light-color type="color" value="${escapeHtml(selection.color ?? "#ffffff")}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-light-number="intensity" type="number" step="0.1" min="0" max="20"
            value="${selection.intensity ?? 1}" ${lockedAttr} />
        </label>
        ${
          isPoint || isSpot
            ? `<label class="detail-row">
              <span>Distance</span>
              <input data-light-number="distance" type="number" step="0.1" min="0" max="100"
                value="${selection.distance ?? (isPoint ? 8 : 10)}" ${lockedAttr} />
            </label>
            <label class="detail-row">
              <span>Decay</span>
              <input data-light-number="decay" type="number" step="0.1" min="0" max="8"
                value="${selection.decay ?? 2}" ${lockedAttr} />
            </label>`
            : ""
        }
        ${
          isSpot
            ? `<label class="detail-row">
              <span>Angle</span>
              <input data-light-number="angle" type="number" step="1" min="1" max="90"
                value="${selection.angle ?? 30}" ${lockedAttr} />
            </label>
            <label class="detail-row">
              <span>Penumbra</span>
              <input data-light-number="penumbra" type="number" step="0.05" min="0" max="1"
                value="${selection.penumbra ?? 0.35}" ${lockedAttr} />
            </label>`
            : ""
        }
        <label class="detail-toggle">
          <input type="checkbox" data-light-toggle="castShadow" ${
            selection.castShadow ? "checked" : ""
          } ${lockedAttr} />
          <span>Cast Shadow</span>
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Actor</div>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="locked" ${selection.locked ? "checked" : ""} />
          <span>Lock Movement</span>
        </label>
      </div>
    `;

    this.detailsBody
      .querySelectorAll<HTMLInputElement>('input[data-detail="pr"]')
      .forEach((input) => {
        input.addEventListener("focus", () => this.beginDetailsEdit());
        input.addEventListener("input", () => {
          this.beginDetailsEdit();
          this.applyDetails();
        });
        input.addEventListener("change", () => this.commitDetailsEdit());
      });

    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-detail-name]");
    nameInput?.addEventListener("change", () => {
      this.app.renameSceneObject(selection.id, nameInput.value);
    });

    this.detailsBody.querySelector<HTMLInputElement>("[data-light-color]")?.addEventListener(
      "change",
      (event) => {
        this.app.setSelectedLightSettings({ color: (event.currentTarget as HTMLInputElement).value });
      },
    );

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-light-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.lightNumber;
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        if (key === "intensity") this.app.setSelectedLightSettings({ intensity: value });
        if (key === "distance") this.app.setSelectedLightSettings({ distance: value });
        if (key === "decay") this.app.setSelectedLightSettings({ decay: value });
        if (key === "angle") this.app.setSelectedLightSettings({ angle: value });
        if (key === "penumbra") this.app.setSelectedLightSettings({ penumbra: value });
      });
    });

    this.detailsBody.querySelector<HTMLInputElement>("[data-light-toggle]")?.addEventListener(
      "change",
      (event) => {
        this.app.setSelectedLightSettings({
          castShadow: (event.currentTarget as HTMLInputElement).checked,
        });
      },
    );

    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-detail-toggle]")
      .forEach((toggle) => {
        toggle.addEventListener("change", () =>
          this.handleDetailToggle(toggle.dataset.detailToggle ?? "", toggle.checked),
        );
      });
  }

  private handleDetailAction(action: string): void {
    switch (action) {
      case "reset":
        this.resetSelectedTransform();
        break;
      case "copy":
        this.copySelectedTransform();
        break;
      case "paste":
        this.pasteSelectedTransform();
        break;
      case "snap-floor":
        this.app.snapSelectedToFloor();
        break;
      case "snap-wall":
        this.app.snapSelectedToWall();
        break;
    }
  }

  private handleDetailToggle(toggle: string, checked: boolean): void {
    if (!this.selected) return;
    switch (toggle) {
      case "locked":
        this.app.setSceneObjectLocked(this.selected.id, checked);
        break;
      case "castShadow":
        this.app.setSelectionCastShadow(checked);
        break;
      case "collision":
        this.app.setSelectionCollision(checked);
        break;
      case "simulatePhysics":
        this.app.setSelectionSimulatePhysics(checked);
        break;
    }
  }

  /** Resets rotation to 0 and scale to 1, leaving position untouched. */
  private resetSelectedTransform(): void {
    const before = this.app.captureSelectedTransforms();
    if (before.length === 0) return;
    this.app.updateSelectedTransforms({ rotation: [0, 0, 0], scale: [1, 1, 1] });
    this.app.commitSelectedTransforms(before, "Reset transform");
  }

  private copySelectedTransform(): void {
    const transform = this.app.captureSelectedTransform();
    if (!transform) return;
    this.transformClipboard = transform;
    this.setStatus("Transform copied.", "info");
  }

  private pasteSelectedTransform(): void {
    const clip = this.transformClipboard;
    if (!clip) {
      this.setStatus("Transform clipboard is empty.", "warning");
      return;
    }
    const before = this.app.captureSelectedTransforms();
    if (before.length === 0) return;
    this.app.updateSelectedTransforms({
      position: [...clip.position],
      rotation: [...clip.rotation],
      scale: [...clip.scale],
    });
    this.app.commitSelectedTransforms(before, "Paste transform");
  }

  /**
   * Keeps the scale inputs consistent before applying: with the lock on, editing
   * one axis scales the others by the same ratio (Unreal-style proportional lock).
   */
  private applyScaleInput(input: HTMLInputElement): void {
    if (!this.detailsScale) return;
    const index = Number(input.dataset.axis);
    if (!Number.isInteger(index) || index < 0 || index > 2) return;

    const next = Math.max(0.01, Number(input.value) || 0);
    const previous = this.detailsScale;

    if (this.selected?.scaleLocked) {
      const prevAxis = previous[index] ?? 0;
      const ratio = prevAxis !== 0 ? next / prevAxis : 0;
      this.detailsScale =
        ratio > 0
          ? [previous[0] * ratio, previous[1] * ratio, previous[2] * ratio]
          : [next, next, next];
    } else {
      const updated: [number, number, number] = [...previous];
      updated[index] = next;
      this.detailsScale = updated;
    }

    this.detailsScale = this.detailsScale.map((value) =>
      Number(value.toFixed(3)),
    ) as [number, number, number];

    // Reflect the recomputed siblings back into the fields the user is not typing in.
    this.detailsBody
      .querySelectorAll<HTMLInputElement>('input[data-detail="scale"]')
      .forEach((field) => {
        const fieldIndex = Number(field.dataset.axis);
        if (fieldIndex !== index && this.detailsScale) {
          field.value = String(this.detailsScale[fieldIndex]);
        }
      });
  }

  private beginDetailsEdit(): void {
    this.detailsBaseline ??= this.app.captureSelectedTransforms();
  }

  private commitDetailsEdit(): void {
    this.beginDetailsEdit();
    this.applyDetails();
    this.app.commitSelectedTransforms(this.detailsBaseline ?? []);
    this.detailsBaseline = null;
  }

  private applyDetails(): void {
    if (!this.selected || !this.detailsScale) return;
    const value = (name: string): number => {
      const input = this.detailsBody.querySelector<HTMLInputElement>(
        `input[name="${name}"]`,
      );
      return Number(input?.value ?? 0);
    };
    this.app.updateSelectedTransforms(
      {
        position: [value("px"), value("py"), value("pz")],
        rotation: [value("rx"), value("ry"), value("rz")],
        scale: [
          Math.max(0.01, this.detailsScale[0]),
          Math.max(0.01, this.detailsScale[1]),
          Math.max(0.01, this.detailsScale[2]),
        ],
      },
      {
        notifySelection: false,
      },
    );
  }

  /** Reads the three pivot fields and applies them (own undo step, not the transform baseline). */
  private commitPivotInput(): void {
    const value = (axis: number): number => {
      const input = this.detailsBody.querySelector<HTMLInputElement>(
        `input[data-pivot][data-axis="${axis}"]`,
      );
      return Number(input?.value ?? 0);
    };
    this.app.setSelectionPivot([value(0), value(1), value(2)]);
  }

  private async save(): Promise<void> {
    try {
      await this.app.saveLayout();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  private syncSnapControls(settings: EditorSnapSettings): void {
    this.setSnapSelect("move", settings.move);
    this.setSnapSelect("rotate", settings.rotate);
    this.setSnapSelect("scale", settings.scale);
    this.setSnapToggle("move", settings.moveEnabled);
    this.setSnapToggle("rotate", settings.rotateEnabled);
    this.setSnapToggle("scale", settings.scaleEnabled);
  }

  private setSnapSelect(key: "move" | "rotate" | "scale", value: number): void {
    const select = this.root.querySelector<HTMLSelectElement>(`select[data-snap="${key}"]`);
    if (!select) return;
    const textValue = String(value);
    if (![...select.options].some((option) => option.value === textValue)) {
      const option = document.createElement("option");
      option.value = textValue;
      option.textContent = textValue;
      select.append(option);
    }
    select.value = textValue;
  }

  private setSnapToggle(key: "move" | "rotate" | "scale", checked: boolean): void {
    const input = this.root.querySelector<HTMLInputElement>(`input[data-snap-toggle="${key}"]`);
    if (input) input.checked = checked;
  }

  private setStatus(
    message: string,
    tone: "info" | "success" | "warning" | "error" = "info",
  ): void {
    this.statusText.textContent = message;
    this.statusText.dataset.tone = tone;
  }
}

function requireElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing editor element: ${selector}`);
  return element as T;
}

const AXES = ["X", "Y", "Z"] as const;

/** A Location/Rotation row: three labelled, colour-coded X/Y/Z fields side by side. */
function vectorRow(
  label: string,
  prefix: "p" | "r",
  values: readonly [number, number, number],
  step: number,
  disabled = false,
): string {
  const fields = AXES.map((axis, index) =>
    axisField(
      `${prefix}${axis.toLowerCase()}`,
      axis,
      index,
      values[index] ?? 0,
      step,
      "pr",
      disabled,
    ),
  ).join("");
  return `
    <div class="detail-vector">
      <span class="detail-vector-label">${label}</span>
      <div class="vector-fields">${fields}</div>
    </div>
  `;
}

/** The Scale row: three X/Y/Z fields plus a proportional-lock toggle. */
function scaleRow(
  values: readonly [number, number, number],
  locked: boolean,
  transformLocked = false,
): string {
  const fields = AXES.map((axis, index) =>
    axisField(
      `s${axis.toLowerCase()}`,
      axis,
      index,
      values[index] ?? 0,
      0.05,
      "scale",
      transformLocked,
    ),
  ).join("");
  return `
    <div class="detail-vector detail-vector-scale">
      <span class="detail-vector-label">
        <span>Scale</span>
        <button type="button" class="scale-lock${locked ? " on" : ""}"
          data-scale-lock title="${locked ? "Unlock scale ratio" : "Lock scale ratio"}"
          aria-pressed="${locked}">${locked ? "🔒" : "🔓"}</button>
      </span>
      <div class="vector-fields">${fields}</div>
    </div>
  `;
}

/** The Pivot row: three X/Y/Z fields (local model space), drag toggle, presets. */
function pivotRow(
  values: readonly [number, number, number],
  disabled = false,
  dragActive = false,
): string {
  const fields = AXES.map(
    (axis, index) => `
    <label class="axis-field axis-${axis.toLowerCase()}">
      <span class="axis-tag">${axis}</span>
      <input data-pivot data-axis="${index}" type="number" step="0.05"
        value="${Number((values[index] ?? 0).toFixed(3))}" ${disabled ? "disabled" : ""} />
    </label>`,
  ).join("");
  const off = disabled ? "disabled" : "";
  return `
    <div class="detail-vector">
      <span class="detail-vector-label">Pivot</span>
      <div class="vector-fields">${fields}</div>
    </div>
    <div class="detail-actions-row">
      <button type="button" class="pivot-drag-toggle${dragActive ? " on" : ""}"
        data-pivot-drag aria-pressed="${dragActive}" ${off}
        title="Drag the gizmo in the viewport to set the pivot">${
          dragActive ? "● Dragging pivot" : "Drag in viewport"
        }</button>
    </div>
    <div class="detail-actions-row">
      <button type="button" data-pivot-preset="reset" ${off}
        title="Pivot at the model origin">Reset</button>
      <button type="button" data-pivot-preset="center" ${off}
        title="Pivot at the bounds centre">Center</button>
      <button type="button" data-pivot-preset="base" ${off}
        title="Pivot at the bottom centre (e.g. a hinge resting on the floor)">Base</button>
    </div>
  `;
}

function axisField(
  name: string,
  axis: string,
  index: number,
  value: number,
  step: number,
  detail: "pr" | "scale",
  disabled = false,
): string {
  return `
    <label class="axis-field axis-${axis.toLowerCase()}">
      <span class="axis-tag">${axis}</span>
      <input name="${name}" data-detail="${detail}" data-axis="${index}"
        type="number" step="${step}" value="${Number(value.toFixed(3))}" ${disabled ? "disabled" : ""} />
    </label>
  `;
}

function physicsLockRow(
  label: string,
  kind: "position" | "rotation",
  locks: readonly [boolean, boolean, boolean],
  disabled = false,
): string {
  const fields = PHYSICS_AXIS_LABELS.map(
    (axis, index) => `
      <label class="physics-axis-lock">
        <span>${axis}</span>
        <input type="checkbox" data-physics-lock="${kind}" data-axis="${index}"
          ${locks[index] ? "checked" : ""} ${disabled ? "disabled" : ""} />
      </label>`,
  ).join("");
  return `
    <div class="detail-row detail-constraint-row">
      <span>${label}</span>
      <div class="physics-lock-fields">${fields}</div>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPosition(position: [number, number, number]): string {
  return position.map((value) => Number(value.toFixed(2))).join(", ");
}

function outlinerKindLabel(kind: EditableSceneObject["kind"]): string {
  if (kind === "character") return "C";
  if (kind === "light") return "L";
  return "I";
}

function isContentTypeFilter(value: string): value is ContentTypeFilter {
  return (
    value === CONTENT_FILTER_ALL ||
    value === "staticMesh" ||
    value === "skeletalMesh" ||
    value === "texture" ||
    value === "material" ||
    value === "sound" ||
    value === "animation" ||
    value === "prefab" ||
    value === "level" ||
    value === "file"
  );
}

function formatContentTypeLabel(value: string): string {
  if (value === "staticMesh") return "Static Meshes";
  if (value === "skeletalMesh") return "Skeletal Meshes";
  if (value === "texture") return "Textures";
  if (value === "material") return "Materials";
  if (value === "sound") return "Sounds";
  if (value === "animation") return "Animations";
  if (value === "prefab") return "Prefabs";
  if (value === "level") return "Levels";
  if (value === "file") return "Files";
  return formatAssetTypeFallbackLabel(value);
}

function formatContentTypeBadge(value: BrowserAssetItem["type"]): string {
  if (value === "staticMesh") return "Static Mesh";
  if (value === "skeletalMesh") return "Skeletal Mesh";
  if (value === "texture") return "Texture";
  if (value === "material") return "Material";
  if (value === "sound") return "Sound";
  if (value === "animation") return "Animation";
  if (value === "prefab") return "Prefab";
  if (value === "level") return "Level";
  return "File";
}

function contentAssetIssues(item: BrowserAssetItem): BrowserAssetIssue[] {
  const issues: BrowserAssetIssue[] = [];
  if (!item.editable) {
    issues.push({
      code: "loose-file",
      label: "File exists but is not registered in the manifest",
    });
    if (item.type === "file") {
      issues.push({ code: "unsupported-file", label: "Unsupported file type" });
    }
    return issues;
  }

  if (!item.editable.placement) {
    issues.push({ code: "missing-placement", label: "Missing placement rule" });
  }
  if (typeof item.editable.runtime?.collision !== "boolean") {
    issues.push({ code: "missing-collision-setting", label: "No collision setting" });
  }
  if (!item.editable.placeable) {
    issues.push({ code: "not-placeable", label: "Not placeable" });
  }
  if (item.type === "file") {
    issues.push({ code: "unsupported-file", label: "Unsupported file type" });
  }
  return issues;
}

function contentAssetIssueTooltip(issues: readonly BrowserAssetIssue[]): string {
  return issues.map((issue) => issue.label).join("; ");
}

function formatContentListStatus(
  shownCount: number,
  fileCount: number,
  issueCount: number,
  missingManifestAssetCount: number,
): string {
  const parts = [`${shownCount} shown / ${fileCount} files`];
  if (issueCount > 0) parts.push(`${issueCount} with issues`);
  if (missingManifestAssetCount > 0) {
    parts.push(`${missingManifestAssetCount} manifest asset file missing`);
  }
  return parts.join(" · ");
}

function formatAssetTypeFallbackLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatShapeTypeLabel(type: ShapePrimitiveType): string {
  switch (type) {
    case "cube":
      return "Cube";
    case "sphere":
      return "Sphere";
    case "cylinder":
      return "Cylinder";
    case "cone":
      return "Cone";
    case "plane":
      return "Plane";
  }
}

function formatLightTypeLabel(type: "directional" | "point" | "spot"): string {
  if (type === "directional") return "Directional Light";
  if (type === "point") return "Point Light";
  return "Spot Light";
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
