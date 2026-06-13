import type { EditableAsset } from "@/scene/assetLoader";
import type {
  EditableSceneObject,
  EditableSelection,
  EditorProjectInfo,
  EditorHistoryState,
  EditorSnapSettings,
  EditableTransform,
  SceneApp,
} from "@/scene/SceneApp";
import { ThumbnailRenderer } from "./ThumbnailRenderer";
import {
  fetchProjectDir,
  findProjectDir,
  flattenProjectFiles,
  isModelFile,
  normalizeProjectPath,
  type ProjectDirNode,
} from "@/project/ProjectAssetTree";
import { projectFileUrl } from "@/project/ProjectSystem";

type Tool = "select" | "move" | "rotate" | "scale";

const TOOL_LABELS: Record<Tool, string> = {
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
  type: "model" | "file";
  editable?: EditableAsset;
}

export class EditorUi {
  private root: HTMLDivElement;
  private contentList: HTMLDivElement;
  private contentDrawer: HTMLElement;
  private contentToggle: HTMLButtonElement;
  private contentRootLabel: HTMLElement;
  private contentPathLabel: HTMLElement;
  private contentStatus: HTMLElement;
  private contentSearch: HTMLInputElement;
  private folderTree: HTMLElement;
  private outlinerList: HTMLDivElement;
  private detailsBody: HTMLDivElement;
  private statusText: HTMLElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly thumbnailRenderer = new ThumbnailRenderer();
  private activeTool: Tool = "move";
  private projectInfo: EditorProjectInfo | null = null;
  private editableAssets: EditableAsset[] = [];
  private assetTreeRoot: ProjectDirNode | null = null;
  private selectedFolder = "";
  private contentQuery = "";
  private contentDrawerOpen = false;
  private contentRefreshTimer = 0;
  private outlinerObjects: EditableSceneObject[] = [];
  private outlinerFilter = "";
  private selected: EditableSelection | null = null;
  private detailsBaseline: EditableTransform | null = null;
  private detailsScale: [number, number, number] | null = null;

  constructor(private readonly app: SceneApp) {
    document.body.classList.add("editor-mode");

    this.root = document.createElement("div");
    this.root.id = "editor-ui";
    this.root.className = "editor-shell";
    this.root.addEventListener("contextmenu", (event) => event.preventDefault());
    this.root.innerHTML = `
      <header class="editor-topbar">
        <div class="editor-brand">
          <strong>3DGameDev Editor</strong>
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
          <button type="button" data-action="undo" title="Undo">Undo</button>
          <button type="button" data-action="redo" title="Redo">Redo</button>
          <button type="button" data-action="delete">Delete</button>
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
        <div class="panel-title">Details</div>
        <div class="details-body" data-details-body></div>
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
    this.folderTree = requireElement(this.root, "[data-folder-tree]");
    this.outlinerList = requireElement(this.root, "[data-outliner-list]");
    this.detailsBody = requireElement(this.root, "[data-details-body]");
    this.statusText = requireElement(this.root, "[data-status]");
    this.undoButton = requireElement(this.root, '[data-action="undo"]');
    this.redoButton = requireElement(this.root, '[data-action="redo"]');
    const projectName = requireElement(this.root, "[data-project-name]");

    this.buildToolbar();
    this.bindActions();
    this.renderDetails(null);

    this.app.onSelectionChanged = (selection) => {
      this.selected = selection;
      this.detailsBaseline = null;
      this.renderDetails(selection);
    };
    this.app.onSceneObjectsChanged = (objects) => this.renderOutliner(objects);
    this.app.onHistoryChanged = (state) => this.renderHistory(state);
    this.app.onStatus = (message, tone) => this.setStatus(message, tone);

    this.renderOutliner(this.app.getSceneObjects());
    this.renderHistory(this.app.getHistoryState());
    void this.loadContent(projectName);
  }

  private buildToolbar(): void {
    const tools = requireElement(this.root, "[data-tools]");
    (["select", "move", "rotate", "scale"] as Tool[]).forEach((tool) => {
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

  private setActiveTool(tool: Tool): void {
    this.activeTool = tool;
    for (const [itemTool, item] of this.toolButtons) {
      item.classList.toggle("active", itemTool === tool);
    }
    this.app.setEditorTool(tool);
  }

  private updateSpaceButton(space: "world" | "local"): void {
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
    this.root.querySelector('[data-action="save"]')?.addEventListener("click", () => {
      void this.save();
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
    } else if (event.code === "End") {
      event.preventDefault();
      this.app.snapSelected();
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
      this.renderFolderTree();
      this.renderContentAssets();
      this.contentStatus.textContent = `${flattenProjectFiles([this.assetTreeRoot]).length} files`;
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

    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-row";
    button.style.setProperty("--depth", String(depth));
    button.classList.toggle("active", node.path === this.selectedFolder);
    button.title = node.path;
    button.innerHTML = `
      <span class="folder-caret">${node.children?.some((child) => child.type === "dir") ? "v" : ""}</span>
      <span class="folder-name">${escapeHtml(node.name)}</span>
    `;
    button.addEventListener("click", () => {
      this.selectedFolder = node.path;
      this.renderFolderTree();
      this.renderContentAssets();
    });
    wrapper.append(button);

    const childDirs = node.children?.filter((child) => child.type === "dir") ?? [];
    for (const child of childDirs) {
      wrapper.append(this.createFolderRow(child, depth + 1));
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
      .filter((item) => {
        if (!this.contentQuery) return true;
        return `${item.label} ${item.category} ${item.path}`.toLocaleLowerCase().includes(
          this.contentQuery,
        );
      });

    this.contentPathLabel.textContent = this.selectedFolder || this.assetTreeRoot.path;
    this.contentStatus.textContent = `${items.length} shown / ${files.length} files`;

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
      type: isModelFile(file) ? "model" : "file",
    } satisfies Omit<BrowserAssetItem, "editable">;
    return editable ? { ...base, editable } : base;
  }

  private editableAssetByProjectPath(): Map<string, EditableAsset> {
    const publicDir = this.projectInfo?.manifest.publicDir ?? "public";
    return new Map(
      this.editableAssets.map((asset) => [
        normalizeProjectPath(`${publicDir}/${asset.file}`),
        asset,
      ]),
    );
  }

  private createAssetCard(item: BrowserAssetItem): HTMLElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "asset-card";
    card.classList.toggle("is-unregistered", !item.editable);
    card.draggable = Boolean(item.editable);
    card.dataset.assetPath = item.path;
    if (item.editable) card.dataset.assetId = item.editable.id;
    card.innerHTML = `
      <span class="asset-thumb" data-asset-thumb>${escapeHtml(item.ext.toUpperCase())}</span>
      <span class="asset-meta">
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(item.category)}${item.editable ? "" : " / file only"}</small>
      </span>
    `;
    card.addEventListener("dragstart", (event) => {
      if (!item.editable) return;
      event.dataTransfer?.setData("application/x-3dgamedev-asset", item.editable.id);
      event.dataTransfer!.effectAllowed = "copy";
      this.setStatus(`Dragging ${item.editable.id}.`);
    });
    card.addEventListener("click", () => {
      if (!item.editable) {
        this.setStatus(`${item.path} is visible but not registered in the asset manifest.`, "warning");
        return;
      }
      this.app.beginAssetPlacement(item.editable.id);
    });
    const thumb = card.querySelector<HTMLElement>("[data-asset-thumb]");
    if (thumb && item.type === "model") void this.renderAssetThumbnail(item, thumb);
    return card;
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

  private renderOutliner(objects: EditableSceneObject[]): void {
    this.outlinerObjects = objects;
    const visibleObjects = this.outlinerFilter
      ? objects.filter((object) => {
          const haystack = `${object.label} ${object.assetId} ${object.kind}`.toLocaleLowerCase();
          return haystack.includes(this.outlinerFilter);
        })
      : objects;

    if (visibleObjects.length === 0) {
      this.outlinerList.innerHTML = `
        <div class="empty-details">
          <strong>${objects.length === 0 ? "No objects" : "No matches"}</strong>
          <span>Scene</span>
        </div>
      `;
      return;
    }

    this.outlinerList.replaceChildren(
      ...visibleObjects.map((object) => {
        const row = document.createElement("div");
        row.className = "outliner-row";
        row.dataset.objectId = object.id;
        if (object.selected) row.classList.add("active");
        if (object.hidden) row.classList.add("is-hidden");
        row.innerHTML = `
          <span class="outliner-kind">${object.kind === "character" ? "C" : "I"}</span>
          <span class="outliner-meta">
            <strong>${object.label}</strong>
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
        return row;
      }),
    );
  }

  private renderHistory(state: EditorHistoryState): void {
    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.undoButton.title = state.undoLabel ? `Undo ${state.undoLabel}` : "Undo";
    this.redoButton.title = state.redoLabel ? `Redo ${state.redoLabel}` : "Redo";
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

    this.detailsScale = [...selection.scale];

    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>${selection.kind} / ${escapeHtml(selection.assetId)}</span>
      </div>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      <div class="detail-actions">
        <button type="button" data-detail-action="snap" ${selection.locked ? "disabled" : ""}
          title="${
            this.app.isSelectionWallAsset()
              ? "Snap flush against the nearest wall (End)"
              : "Snap onto the surface below (End)"
          }">${this.app.isSelectionWallAsset() ? "Snap to Wall" : "Snap to Surface"}</button>
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
      .querySelector<HTMLButtonElement>('[data-detail-action="snap"]')
      ?.addEventListener("click", () => this.app.snapSelected());
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
    this.detailsBaseline ??= this.app.captureSelectedTransform();
  }

  private commitDetailsEdit(): void {
    this.beginDetailsEdit();
    this.applyDetails();
    this.app.commitSelectedTransform(this.detailsBaseline);
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
    this.app.updateSelectedTransform(
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nextTransformTool(tool: Tool): Tool {
  if (tool === "move") return "rotate";
  if (tool === "rotate") return "scale";
  return "move";
}

function formatPosition(position: [number, number, number]): string {
  return position.map((value) => Number(value.toFixed(2))).join(", ");
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
