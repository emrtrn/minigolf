/**
 * Actor Script editor — Forge's answer to the Unreal Actor Blueprint editor,
 * opened from the Content Browser (double-click a `*.actor.json`). It is a
 * full-screen overlay document arranged like the Blueprint editor: a Components
 * tree + My Blueprint (Variables) on the left, a Viewport placeholder and the
 * Event Bindings ("Event Graph") in the center, and a Details panel on the right,
 * with a Compile/Save/Browse/Play toolbar.
 *
 * Deliberately *not* a visual node graph: an event binding references a behavior
 * `scriptId` + JSON params, and the real logic is TypeScript authored elsewhere
 * (e.g. by AI in `src/game/`). The editor only authors data, persisted to the
 * `*.actor.json` class-asset via the dev `/__save-actor` endpoint.
 *
 * Editor-only: lives behind the dynamic `?editor` import so it never ships in the
 * game build.
 */
import {
  ACTOR_COMPONENT_KINDS,
  ACTOR_EVENT_KINDS,
  ACTOR_EVENT_LABELS,
  PARENT_CLASSES,
  PARENT_CLASS_LABELS,
  defaultActorScriptDef,
  type ActorComponentKind,
  type ActorEventKind,
  type ActorScriptDef,
  type ComponentTemplateNode,
  type EventBinding,
  type ParentClass,
} from "@engine/scene/actorScript";
import type { MetadataFieldDef, MetadataFieldType } from "@engine/scene/metadataSchema";
import type { SceneJsonValue } from "@engine/scene/entity";
import type { Vec3 } from "@engine/scene/layout";
import { isModelAssetType, type AssetType } from "@engine/assets/manifest";
import { loadActorScript, saveActorScript } from "@/editor/actorScriptStore";
import { ActorScriptViewport } from "@/editor/ActorScriptViewport";

type StatusTone = "info" | "success" | "warning" | "error";

export interface ActorScriptEditorOptions {
  /** Public-relative path of the `*.actor.json` file. */
  path: string;
  /** Display label (asset name). */
  label: string;
  /** Behavior script ids offered as Event Binding suggestions (free text still allowed). */
  behaviorScriptIds?: readonly string[];
  /** Manifest asset ids offered for MeshRenderer convenience. */
  assetIds?: readonly string[];
  /** Manifest assets (id/name/type/path): the MeshRenderer mesh picker + viewport previews. */
  assets?: ReadonlyArray<{ id: string; name: string; assetType: string; path: string }>;
  onStatus?: (message: string, tone?: StatusTone) => void;
  /** Reveal this asset in the Content Browser (Toolbar → Browse). */
  onBrowse?: () => void;
}

type Selection =
  | { kind: "class" }
  | { kind: "component"; id: string }
  | { kind: "variable"; index: number }
  | { kind: "event"; index: number };

const METADATA_FIELD_TYPES: readonly MetadataFieldType[] = [
  "text",
  "number",
  "boolean",
  "select",
  "tags",
];

const COMPONENT_ICONS: Record<ActorComponentKind, string> = {
  Transform: "✥",
  MeshRenderer: "◰",
  Collider: "▢",
  Audio: "♪",
  ParticleEmitter: "✺",
  Light: "☀",
  Interaction: "☞",
  Behavior: "⚙",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class ActorScriptEditor {
  private static activeInstance: ActorScriptEditor | null = null;

  static async open(options: ActorScriptEditorOptions): Promise<ActorScriptEditor> {
    ActorScriptEditor.activeInstance?.close();
    const editor = new ActorScriptEditor(options);
    ActorScriptEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly parentBadge: HTMLElement;
  private readonly componentsHost: HTMLElement;
  private readonly blueprintHost: HTMLElement;
  private readonly eventsHost: HTMLElement;
  private readonly detailsHost: HTMLElement;
  private readonly viewportHost: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly compileStatusEl: HTMLElement;

  private def: ActorScriptDef;
  private selection: Selection = { kind: "class" };
  private dirty = false;
  private disposed = false;
  private nodeSeq = 0;

  /** 3D preview of the component tree (lazily created on first render). */
  private viewport: ActorScriptViewport | null = null;
  /** Last component-tree signature built into the viewport (skips redundant rebuilds). */
  private lastBuildSignature = "";
  private viewportSyncTimer: number | undefined;
  private modelPathById: Map<string, string> | null = null;

  private constructor(private readonly options: ActorScriptEditorOptions) {
    this.def = defaultActorScriptDef(options.label);

    this.overlay = document.createElement("div");
    this.overlay.className = "as-editor-overlay";
    this.overlay.innerHTML = `
      <div class="as-editor-window">
        <header class="as-editor-header">
          <span class="as-editor-tab">
            <span class="as-editor-tab-icon">◈</span>
            <strong data-as-title></strong>
            <span class="as-editor-badge" data-as-parent></span>
          </span>
          <div class="as-editor-header-actions">
            <button type="button" class="as-editor-save" data-as-save title="Save (Ctrl+S)">Save</button>
            <button type="button" class="as-editor-close" data-as-close title="Close (Esc)">✕</button>
          </div>
        </header>
        <div class="as-editor-toolbar">
          <button type="button" data-as-compile title="Validate this class">▣ Compile</button>
          <button type="button" data-as-tb-save title="Save (Ctrl+S)">💾 Save</button>
          <button type="button" data-as-browse title="Reveal in Content Browser">🔎 Browse</button>
          <button type="button" data-as-play title="Play (coming soon)" disabled>▶ Play</button>
          <span class="as-editor-toolbar-spacer"></span>
          <span class="as-editor-compile-status" data-as-compile-status></span>
        </div>
        <div class="as-editor-body">
          <aside class="as-editor-left">
            <section class="as-editor-panel" data-as-components></section>
            <section class="as-editor-panel" data-as-myblueprint></section>
          </aside>
          <main class="as-editor-center">
            <div class="as-editor-viewport" data-as-viewport></div>
            <section class="as-editor-panel as-editor-graph" data-as-events></section>
          </main>
          <aside class="as-editor-details" data-as-details></aside>
        </div>
        <footer class="as-editor-status" data-as-status>Loading…</footer>
      </div>
    `;
    document.body.append(this.overlay);

    this.titleEl = this.requireEl("[data-as-title]");
    this.parentBadge = this.requireEl("[data-as-parent]");
    this.componentsHost = this.requireEl("[data-as-components]");
    this.blueprintHost = this.requireEl("[data-as-myblueprint]");
    this.eventsHost = this.requireEl("[data-as-events]");
    this.detailsHost = this.requireEl("[data-as-details]");
    this.viewportHost = this.requireEl("[data-as-viewport]");
    this.statusEl = this.requireEl("[data-as-status]");
    this.compileStatusEl = this.requireEl("[data-as-compile-status]");

    this.requireEl<HTMLButtonElement>("[data-as-close]").addEventListener("click", () =>
      this.close(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-save]").addEventListener("click", () =>
      void this.save(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-tb-save]").addEventListener("click", () =>
      void this.save(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-compile]").addEventListener("click", () =>
      this.compile(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-browse]").addEventListener("click", () =>
      this.options.onBrowse?.(),
    );

    this.overlay.tabIndex = -1;
    this.overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void this.save();
      }
    });
    this.overlay.focus();
  }

  private requireEl<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`ActorScriptEditor: missing element ${selector}`);
    return el;
  }

  private async load(): Promise<void> {
    try {
      this.def = await loadActorScript(this.options.path, this.options.label);
      this.dirty = false;
      this.selection = { kind: "class" };
      this.render();
      this.setStatus("Ready.");
    } catch (error) {
      this.render();
      this.setStatus(`Failed to load: ${describeError(error)}`, "error");
    }
  }

  // --- rendering ----------------------------------------------------------

  private render(): void {
    if (this.disposed) return;
    this.titleEl.textContent = this.def.name;
    this.parentBadge.textContent = PARENT_CLASS_LABELS[this.def.parentClass];
    this.renderComponents();
    this.renderBlueprint();
    this.renderEvents();
    this.renderViewport();
    this.renderDetails();
  }

  /** Rebuilds only the list panels (keeps Details inputs focused during typing). */
  private refreshLists(): void {
    if (this.disposed) return;
    this.titleEl.textContent = this.def.name;
    this.parentBadge.textContent = PARENT_CLASS_LABELS[this.def.parentClass];
    this.renderComponents();
    this.renderBlueprint();
    this.renderEvents();
    this.renderViewport();
  }

  private renderComponents(): void {
    const childrenOf = (parent: string | undefined): ComponentTemplateNode[] =>
      this.def.components.filter((node) => node.parent === parent);
    const renderNode = (node: ComponentTemplateNode, depth: number): string => {
      const selected =
        this.selection.kind === "component" && this.selection.id === node.id ? " is-selected" : "";
      const icon = COMPONENT_ICONS[node.component] ?? "▪";
      const isRoot = node.parent === undefined;
      const rows = [
        `<div class="as-tree-row${selected}" data-as-node="${escapeHtml(node.id)}" style="padding-left:${8 + depth * 14}px">
          <span class="as-tree-icon">${icon}</span>
          <span class="as-tree-label">${escapeHtml(node.id)}</span>
          <span class="as-tree-kind">${escapeHtml(node.component)}</span>
          ${isRoot ? "" : `<button type="button" class="as-tree-del" data-as-del-node="${escapeHtml(node.id)}" title="Delete">✕</button>`}
        </div>`,
      ];
      for (const child of childrenOf(node.id)) rows.push(renderNode(child, depth + 1));
      return rows.join("");
    };
    const tree = childrenOf(undefined).map((root) => renderNode(root, 0)).join("");
    const options = ACTOR_COMPONENT_KINDS.filter((kind) => kind !== "Transform")
      .map((kind) => `<option value="${kind}">${kind}</option>`)
      .join("");
    this.componentsHost.innerHTML = `
      <div class="as-panel-head">
        <span>Components</span>
        <select class="as-add-select" data-as-add-component title="Add Component">
          <option value="">+ Add</option>
          ${options}
        </select>
      </div>
      <div class="as-tree">${tree}</div>
    `;
    this.componentsHost.querySelectorAll<HTMLElement>("[data-as-node]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-as-del-node]")) return;
        this.select({ kind: "component", id: row.dataset.asNode ?? "" });
      });
    });
    this.componentsHost.querySelectorAll<HTMLElement>("[data-as-del-node]").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteComponent(btn.dataset.asDelNode ?? ""));
    });
    const addSelect = this.componentsHost.querySelector<HTMLSelectElement>("[data-as-add-component]");
    addSelect?.addEventListener("change", () => {
      const kind = addSelect.value as ActorComponentKind | "";
      addSelect.value = "";
      if (kind) this.addComponent(kind);
    });
  }

  private renderBlueprint(): void {
    const rows = this.def.variables
      .map((variable, index) => {
        const selected =
          this.selection.kind === "variable" && this.selection.index === index
            ? " is-selected"
            : "";
        return `<div class="as-list-row${selected}" data-as-var="${index}">
          <span class="as-list-icon">◆</span>
          <span class="as-list-label">${escapeHtml(variable.label || variable.key)}</span>
          <span class="as-list-kind">${escapeHtml(variable.type)}</span>
          <button type="button" class="as-list-del" data-as-del-var="${index}" title="Delete">✕</button>
        </div>`;
      })
      .join("");
    this.blueprintHost.innerHTML = `
      <div class="as-panel-head">
        <span>My Blueprint · Variables</span>
        <button type="button" class="as-add-btn" data-as-add-var title="Add Variable">+ Variable</button>
      </div>
      <div class="as-list">${rows || '<div class="as-empty">No variables.</div>'}</div>
    `;
    this.blueprintHost.querySelectorAll<HTMLElement>("[data-as-var]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-as-del-var]")) return;
        this.select({ kind: "variable", index: Number(row.dataset.asVar) });
      });
    });
    this.blueprintHost.querySelectorAll<HTMLElement>("[data-as-del-var]").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteVariable(Number(btn.dataset.asDelVar)));
    });
    this.blueprintHost
      .querySelector<HTMLButtonElement>("[data-as-add-var]")
      ?.addEventListener("click", () => this.addVariable());
  }

  private renderEvents(): void {
    const rows = this.def.eventBindings
      .map((binding, index) => {
        const selected =
          this.selection.kind === "event" && this.selection.index === index ? " is-selected" : "";
        return `<div class="as-list-row${selected}" data-as-event="${index}">
          <span class="as-list-icon">⏵</span>
          <span class="as-list-label">${escapeHtml(ACTOR_EVENT_LABELS[binding.event])}</span>
          <span class="as-list-kind">${escapeHtml(binding.scriptId || "(no script)")}</span>
          <button type="button" class="as-list-del" data-as-del-event="${index}" title="Delete">✕</button>
        </div>`;
      })
      .join("");
    this.eventsHost.innerHTML = `
      <div class="as-panel-head">
        <span>Event Graph · Bindings</span>
        <button type="button" class="as-add-btn" data-as-add-event title="Add Binding">+ Binding</button>
      </div>
      <div class="as-graph-hint">Each binding maps an event to a behavior script (TypeScript) + params.</div>
      <div class="as-list">${rows || '<div class="as-empty">No event bindings.</div>'}</div>
    `;
    this.eventsHost.querySelectorAll<HTMLElement>("[data-as-event]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-as-del-event]")) return;
        this.select({ kind: "event", index: Number(row.dataset.asEvent) });
      });
    });
    this.eventsHost.querySelectorAll<HTMLElement>("[data-as-del-event]").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteEvent(Number(btn.dataset.asDelEvent)));
    });
    this.eventsHost
      .querySelector<HTMLButtonElement>("[data-as-add-event]")
      ?.addEventListener("click", () => this.addEvent());
  }

  /** Ensures the 3D viewport exists, then syncs the tree + selection into it. */
  private renderViewport(): void {
    if (this.disposed) return;
    if (!this.viewport) {
      this.viewport = new ActorScriptViewport({
        host: this.viewportHost,
        resolveModelPath: (assetId) => this.resolveModelPath(assetId),
        onPickNode: (nodeId) => {
          if (nodeId) this.select({ kind: "component", id: nodeId });
        },
      });
      this.lastBuildSignature = "";
    }
    this.syncViewport();
  }

  /** Rebuilds the preview only when the component tree changed; always re-highlights. */
  private syncViewport(): void {
    if (!this.viewport) return;
    const signature = JSON.stringify(this.def.components);
    if (signature !== this.lastBuildSignature) {
      this.lastBuildSignature = signature;
      this.viewport.setDef(this.def);
    }
    this.viewport.setSelection(this.selection.kind === "component" ? this.selection.id : null);
  }

  /** Debounced viewport sync for live prop edits (avoids rebuilding per keystroke). */
  private scheduleViewportSync(): void {
    if (this.viewportSyncTimer !== undefined) return;
    this.viewportSyncTimer = window.setTimeout(() => {
      this.viewportSyncTimer = undefined;
      this.syncViewport();
    }, 150);
  }

  /** Maps a manifest asset id to its public-relative model path (mesh nodes only). */
  private resolveModelPath(assetId: string): string | undefined {
    if (!this.modelPathById) {
      this.modelPathById = new Map();
      for (const asset of this.options.assets ?? []) {
        if (isModelAssetType(asset.assetType as AssetType)) {
          this.modelPathById.set(asset.id, asset.path);
        }
      }
    }
    return this.modelPathById.get(assetId);
  }

  /** Model assets ({id,name}) offered by the MeshRenderer mesh picker, name-sorted. */
  private modelAssets(): Array<{ id: string; name: string }> {
    return (this.options.assets ?? [])
      .filter((asset) => isModelAssetType(asset.assetType as AssetType))
      .map((asset) => ({ id: asset.id, name: asset.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- details forms ------------------------------------------------------

  private renderDetails(): void {
    const host = this.detailsHost;
    switch (this.selection.kind) {
      case "class":
        host.innerHTML = this.detailsClass();
        this.bindClassDetails();
        break;
      case "component":
        host.innerHTML = this.detailsComponent();
        this.bindComponentDetails();
        break;
      case "variable":
        host.innerHTML = this.detailsVariable();
        this.bindVariableDetails();
        break;
      case "event":
        host.innerHTML = this.detailsEvent();
        this.bindEventDetails();
        break;
    }
  }

  private detailsClass(): string {
    const parentOptions = PARENT_CLASSES.map(
      (cls) =>
        `<option value="${cls}" ${cls === this.def.parentClass ? "selected" : ""}>${PARENT_CLASS_LABELS[cls]}</option>`,
    ).join("");
    return `
      <div class="as-details-head">Class Defaults</div>
      <label class="as-field">
        <span>Name</span>
        <input type="text" data-as-class-name value="${escapeHtml(this.def.name)}" />
      </label>
      <label class="as-field">
        <span>Parent Class</span>
        <select data-as-class-parent>${parentOptions}</select>
      </label>
      <p class="as-details-note">This class is saved to <code>${escapeHtml(this.options.path)}</code>.</p>
    `;
  }

  private bindClassDetails(): void {
    const name = this.detailsHost.querySelector<HTMLInputElement>("[data-as-class-name]");
    name?.addEventListener("input", () => {
      this.def.name = name.value;
      this.markDirty();
      this.titleEl.textContent = this.def.name;
    });
    name?.addEventListener("change", () => this.refreshLists());
    const parent = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-class-parent]");
    parent?.addEventListener("change", () => {
      this.def.parentClass = parent.value as ParentClass;
      this.markDirty();
      this.refreshLists();
    });
  }

  private selectedComponent(): ComponentTemplateNode | undefined {
    if (this.selection.kind !== "component") return undefined;
    const id = this.selection.id;
    return this.def.components.find((node) => node.id === id);
  }

  private detailsComponent(): string {
    const node = this.selectedComponent();
    if (!node) return `<div class="as-details-head">Component</div><p class="as-empty">Not found.</p>`;
    const isRoot = node.parent === undefined;
    const kindOptions = ACTOR_COMPONENT_KINDS.map(
      (kind) => `<option value="${kind}" ${kind === node.component ? "selected" : ""}>${kind}</option>`,
    ).join("");
    const parentOptions = [
      `<option value="" ${isRoot ? "selected" : ""}>— none (root)</option>`,
      ...this.def.components
        .filter((other) => other.id !== node.id)
        .map(
          (other) =>
            `<option value="${escapeHtml(other.id)}" ${other.id === node.parent ? "selected" : ""}>${escapeHtml(other.id)}</option>`,
        ),
    ].join("");
    const meshField = node.component === "MeshRenderer" ? this.meshPickerField(node) : "";
    const pos = readVec3Prop(node.props.position, [0, 0, 0]);
    const rot = readVec3Prop(node.props.rotation, [0, 0, 0]);
    const scl = readVec3Prop(node.props.scale, [1, 1, 1]);
    return `
      <div class="as-details-head">Component · ${escapeHtml(node.component)}</div>
      <label class="as-field">
        <span>Id</span>
        <input type="text" data-as-node-id value="${escapeHtml(node.id)}" />
      </label>
      <label class="as-field">
        <span>Component</span>
        <select data-as-node-kind ${isRoot ? "disabled" : ""}>${kindOptions}</select>
      </label>
      <label class="as-field">
        <span>Parent</span>
        <select data-as-node-parent ${isRoot ? "disabled" : ""}>${parentOptions}</select>
      </label>
      ${meshField}
      <div class="as-section-label">Transform <small>(preview)</small></div>
      ${vec3Row("position", "Position", pos)}
      ${vec3Row("rotation", "Rotation°", rot)}
      ${vec3Row("scale", "Scale", scl)}
      <details class="as-advanced">
        <summary>Advanced · raw props (JSON)</summary>
        <textarea data-as-node-props rows="7">${escapeHtml(JSON.stringify(node.props, null, 2))}</textarea>
        <div class="as-json-error" data-as-node-props-error></div>
      </details>
    `;
  }

  /** The MeshRenderer "Mesh" dropdown: model assets by name → sets props.assetId. */
  private meshPickerField(node: ComponentTemplateNode): string {
    const current = typeof node.props.assetId === "string" ? node.props.assetId : "";
    const assets = this.modelAssets();
    const known = assets.some((asset) => asset.id === current);
    const options = [
      `<option value="" ${current ? "" : "selected"}>— none —</option>`,
      ...assets.map(
        (asset) =>
          `<option value="${escapeHtml(asset.id)}" ${asset.id === current ? "selected" : ""}>${escapeHtml(asset.name)}</option>`,
      ),
      // Preserve an unknown/hand-typed id so the picker never silently drops it.
      ...(current && !known
        ? [`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (unknown)</option>`]
        : []),
    ].join("");
    return `
      <label class="as-field">
        <span>Mesh</span>
        <select data-as-node-mesh>${options}</select>
      </label>
    `;
  }

  private bindComponentDetails(): void {
    const node = this.selectedComponent();
    if (!node) return;
    const idInput = this.detailsHost.querySelector<HTMLInputElement>("[data-as-node-id]");
    idInput?.addEventListener("change", () => {
      const next = idInput.value.trim();
      if (!next || next === node.id) {
        idInput.value = node.id;
        return;
      }
      if (this.def.components.some((other) => other.id === next)) {
        this.setStatus(`Component id "${next}" already exists.`, "warning");
        idInput.value = node.id;
        return;
      }
      const old = node.id;
      // Re-parent children that referenced the old id.
      for (const child of this.def.components) {
        if (child.parent === old) child.parent = next;
      }
      node.id = next;
      this.selection = { kind: "component", id: next };
      this.markDirty();
      this.refreshLists();
    });
    const kind = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-node-kind]");
    kind?.addEventListener("change", () => {
      node.component = kind.value as ActorComponentKind;
      this.markDirty();
      this.refreshLists();
      this.renderDetails();
    });
    const parent = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-node-parent]");
    parent?.addEventListener("change", () => {
      const value = parent.value;
      if (value && this.wouldCycle(node.id, value)) {
        this.setStatus("That parent would create a cycle.", "warning");
        parent.value = node.parent ?? "";
        return;
      }
      if (value) node.parent = value;
      else delete node.parent;
      this.markDirty();
      this.refreshLists();
    });
    const mesh = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-node-mesh]");
    mesh?.addEventListener("change", () => {
      if (mesh.value) node.props.assetId = mesh.value;
      else delete node.props.assetId;
      this.markDirty();
      this.render(); // rebuilds tree + viewport + the raw-props view
    });
    this.detailsHost.querySelectorAll<HTMLElement>("[data-as-vec]").forEach((rowEl) => {
      const key = rowEl.dataset.asVec as "position" | "rotation" | "scale";
      const inputs = Array.from(rowEl.querySelectorAll<HTMLInputElement>("input"));
      const identity: Vec3 = key === "scale" ? [1, 1, 1] : [0, 0, 0];
      const collect = (): void => {
        const value = inputs.map((input) => {
          const n = Number(input.value);
          return Number.isFinite(n) ? n : 0;
        }) as Vec3;
        if (value.every((axis, i) => axis === identity[i])) delete node.props[key];
        else node.props[key] = value;
        this.markDirty();
      };
      // Live preview while typing; sync the raw-props view on commit (blur).
      inputs.forEach((input) => {
        input.addEventListener("input", () => {
          collect();
          this.scheduleViewportSync();
        });
        input.addEventListener("change", () => {
          collect();
          this.renderDetails();
          this.syncViewport();
        });
      });
    });
    const props = this.detailsHost.querySelector<HTMLTextAreaElement>("[data-as-node-props]");
    const error = this.detailsHost.querySelector<HTMLElement>("[data-as-node-props-error]");
    props?.addEventListener("input", () => {
      const parsed = parseJsonObject(props.value);
      if (parsed.ok) {
        node.props = parsed.value;
        this.markDirty();
        this.scheduleViewportSync();
        if (error) error.textContent = "";
        props.classList.remove("is-invalid");
      } else {
        if (error) error.textContent = parsed.error;
        props.classList.add("is-invalid");
      }
    });
  }

  private detailsVariable(): string {
    if (this.selection.kind !== "variable") return "";
    const variable = this.def.variables[this.selection.index];
    if (!variable) return `<div class="as-details-head">Variable</div><p class="as-empty">Not found.</p>`;
    const typeOptions = METADATA_FIELD_TYPES.map(
      (type) => `<option value="${type}" ${type === variable.type ? "selected" : ""}>${type}</option>`,
    ).join("");
    const showOptions = variable.type === "select" || variable.type === "tags";
    return `
      <div class="as-details-head">Variable</div>
      <label class="as-field">
        <span>Key</span>
        <input type="text" data-as-var-key value="${escapeHtml(variable.key)}" />
      </label>
      <label class="as-field">
        <span>Label</span>
        <input type="text" data-as-var-label value="${escapeHtml(variable.label)}" />
      </label>
      <label class="as-field">
        <span>Type</span>
        <select data-as-var-type>${typeOptions}</select>
      </label>
      <label class="as-field">
        <span>Default</span>
        <input type="text" data-as-var-default value="${escapeHtml(stringifyMetadataDefault(variable.default))}" />
      </label>
      ${
        showOptions
          ? `<label class="as-field"><span>Options (comma-separated)</span>
        <input type="text" data-as-var-options value="${escapeHtml((variable.options ?? []).join(", "))}" /></label>`
          : ""
      }
    `;
  }

  private bindVariableDetails(): void {
    if (this.selection.kind !== "variable") return;
    const index = this.selection.index;
    const variable = this.def.variables[index];
    if (!variable) return;
    const key = this.detailsHost.querySelector<HTMLInputElement>("[data-as-var-key]");
    key?.addEventListener("change", () => {
      const next = key.value.trim();
      if (!next) {
        key.value = variable.key;
        return;
      }
      if (this.def.variables.some((other, i) => i !== index && other.key === next)) {
        this.setStatus(`Variable key "${next}" already exists.`, "warning");
        key.value = variable.key;
        return;
      }
      variable.key = next;
      this.markDirty();
      this.refreshLists();
    });
    const label = this.detailsHost.querySelector<HTMLInputElement>("[data-as-var-label]");
    label?.addEventListener("input", () => {
      variable.label = label.value;
      this.markDirty();
    });
    label?.addEventListener("change", () => this.refreshLists());
    const type = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-var-type]");
    type?.addEventListener("change", () => {
      variable.type = type.value as MetadataFieldType;
      this.markDirty();
      this.refreshLists();
      this.renderDetails();
    });
    const def = this.detailsHost.querySelector<HTMLInputElement>("[data-as-var-default]");
    def?.addEventListener("input", () => {
      const value = coerceMetadataDefault(def.value, variable.type);
      if (value === undefined) delete variable.default;
      else variable.default = value;
      this.markDirty();
    });
    const options = this.detailsHost.querySelector<HTMLInputElement>("[data-as-var-options]");
    options?.addEventListener("input", () => {
      variable.options = options.value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      this.markDirty();
    });
  }

  private detailsEvent(): string {
    if (this.selection.kind !== "event") return "";
    const binding = this.def.eventBindings[this.selection.index];
    if (!binding) return `<div class="as-details-head">Event Binding</div><p class="as-empty">Not found.</p>`;
    const eventOptions = ACTOR_EVENT_KINDS.map(
      (kind) =>
        `<option value="${kind}" ${kind === binding.event ? "selected" : ""}>${ACTOR_EVENT_LABELS[kind]}</option>`,
    ).join("");
    const ids = this.options.behaviorScriptIds ?? [];
    const idList = ids.length
      ? `<datalist id="as-script-ids">${ids.map((id) => `<option value="${escapeHtml(id)}"></option>`).join("")}</datalist>`
      : "";
    return `
      <div class="as-details-head">Event Binding</div>
      <label class="as-field">
        <span>Event</span>
        <select data-as-event-kind>${eventOptions}</select>
      </label>
      <label class="as-field">
        <span>Behavior Script Id</span>
        <input type="text" data-as-event-script list="as-script-ids" value="${escapeHtml(binding.scriptId)}" placeholder="e.g. spin" />
      </label>
      ${idList}
      <label class="as-field">
        <span>Params (JSON)</span>
        <textarea data-as-event-params rows="8">${escapeHtml(JSON.stringify(binding.params ?? {}, null, 2))}</textarea>
      </label>
      <div class="as-json-error" data-as-event-params-error></div>
      <p class="as-details-note">The script id resolves to a TypeScript behavior in <code>src/game/</code>. Author it (or ask AI) and register it in the behavior registry.</p>
    `;
  }

  private bindEventDetails(): void {
    if (this.selection.kind !== "event") return;
    const binding = this.def.eventBindings[this.selection.index];
    if (!binding) return;
    const kind = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-event-kind]");
    kind?.addEventListener("change", () => {
      binding.event = kind.value as ActorEventKind;
      this.markDirty();
      this.refreshLists();
    });
    const script = this.detailsHost.querySelector<HTMLInputElement>("[data-as-event-script]");
    script?.addEventListener("input", () => {
      binding.scriptId = script.value.trim();
      this.markDirty();
    });
    script?.addEventListener("change", () => this.refreshLists());
    const params = this.detailsHost.querySelector<HTMLTextAreaElement>("[data-as-event-params]");
    const error = this.detailsHost.querySelector<HTMLElement>("[data-as-event-params-error]");
    params?.addEventListener("input", () => {
      const parsed = parseJsonObject(params.value);
      if (parsed.ok) {
        if (Object.keys(parsed.value).length > 0) binding.params = parsed.value;
        else delete binding.params;
        this.markDirty();
        if (error) error.textContent = "";
        params.classList.remove("is-invalid");
      } else {
        if (error) error.textContent = parsed.error;
        params.classList.add("is-invalid");
      }
    });
  }

  // --- mutations ----------------------------------------------------------

  private select(selection: Selection): void {
    this.selection = selection;
    this.render();
  }

  private addComponent(kind: ActorComponentKind): void {
    const root = this.def.components.find((node) => node.parent === undefined);
    const id = this.uniqueNodeId(kind);
    const node: ComponentTemplateNode = { id, component: kind, props: {} };
    if (root) node.parent = root.id;
    this.def.components.push(node);
    this.selection = { kind: "component", id };
    this.markDirty();
    this.render();
  }

  private deleteComponent(id: string): void {
    const node = this.def.components.find((n) => n.id === id);
    if (!node || node.parent === undefined) return; // never delete the root
    // Re-parent direct children to the deleted node's parent.
    for (const child of this.def.components) {
      if (child.parent === id) child.parent = node.parent;
    }
    this.def.components = this.def.components.filter((n) => n.id !== id);
    if (this.selection.kind === "component" && this.selection.id === id) {
      this.selection = { kind: "class" };
    }
    this.markDirty();
    this.render();
  }

  private addVariable(): void {
    const key = this.uniqueVariableKey();
    const variable: MetadataFieldDef = { key, label: key, type: "number" };
    this.def.variables.push(variable);
    this.selection = { kind: "variable", index: this.def.variables.length - 1 };
    this.markDirty();
    this.render();
  }

  private deleteVariable(index: number): void {
    if (index < 0 || index >= this.def.variables.length) return;
    this.def.variables.splice(index, 1);
    if (this.selection.kind === "variable") this.selection = { kind: "class" };
    this.markDirty();
    this.render();
  }

  private addEvent(): void {
    const scriptId = this.options.behaviorScriptIds?.[0] ?? "";
    const binding: EventBinding = { event: "tick", scriptId };
    this.def.eventBindings.push(binding);
    this.selection = { kind: "event", index: this.def.eventBindings.length - 1 };
    this.markDirty();
    this.render();
  }

  private deleteEvent(index: number): void {
    if (index < 0 || index >= this.def.eventBindings.length) return;
    this.def.eventBindings.splice(index, 1);
    if (this.selection.kind === "event") this.selection = { kind: "class" };
    this.markDirty();
    this.render();
  }

  private uniqueNodeId(kind: string): string {
    const base = kind.charAt(0).toLowerCase() + kind.slice(1);
    let candidate = base;
    while (this.def.components.some((node) => node.id === candidate)) {
      this.nodeSeq += 1;
      candidate = `${base}${this.nodeSeq}`;
    }
    return candidate;
  }

  private uniqueVariableKey(): string {
    let n = this.def.variables.length + 1;
    let candidate = `var${n}`;
    while (this.def.variables.some((variable) => variable.key === candidate)) {
      n += 1;
      candidate = `var${n}`;
    }
    return candidate;
  }

  /** True if making `parentId` the parent of `nodeId` would form a cycle. */
  private wouldCycle(nodeId: string, parentId: string): boolean {
    let current: string | undefined = parentId;
    const seen = new Set<string>();
    while (current) {
      if (current === nodeId) return true;
      if (seen.has(current)) return true;
      seen.add(current);
      current = this.def.components.find((node) => node.id === current)?.parent;
    }
    return false;
  }

  // --- compile / save -----------------------------------------------------

  /** Validates the class (Unreal's Compile): structural + reference checks. */
  private compile(): void {
    const errors: string[] = [];
    const warnings: string[] = [];

    const ids = new Set<string>();
    for (const node of this.def.components) {
      if (ids.has(node.id)) errors.push(`Duplicate component id "${node.id}".`);
      ids.add(node.id);
    }
    for (const node of this.def.components) {
      if (node.parent !== undefined && !ids.has(node.parent)) {
        errors.push(`Component "${node.id}" references a missing parent "${node.parent}".`);
      }
    }
    const roots = this.def.components.filter((node) => node.parent === undefined);
    if (roots.length === 0) errors.push("No root component.");

    const keys = new Set<string>();
    for (const variable of this.def.variables) {
      if (!variable.key) errors.push("A variable has an empty key.");
      if (keys.has(variable.key)) errors.push(`Duplicate variable key "${variable.key}".`);
      keys.add(variable.key);
    }

    const known = new Set(this.options.behaviorScriptIds ?? []);
    this.def.eventBindings.forEach((binding, index) => {
      if (!binding.scriptId) {
        errors.push(`Event binding #${index + 1} (${binding.event}) has no script id.`);
      } else if (known.size > 0 && !known.has(binding.scriptId)) {
        warnings.push(`Script "${binding.scriptId}" is not registered yet (author it in src/game/).`);
      }
    });

    if (errors.length === 0) {
      const suffix = warnings.length ? ` · ${warnings.length} warning(s)` : "";
      this.compileStatusEl.textContent = `✓ Compiled${suffix}`;
      this.compileStatusEl.className = "as-editor-compile-status is-ok";
      this.setStatus(
        warnings.length ? `Compiled with warnings: ${warnings[0]}` : "Compiled cleanly.",
        warnings.length ? "warning" : "success",
      );
    } else {
      this.compileStatusEl.textContent = `✕ ${errors.length} error(s)`;
      this.compileStatusEl.className = "as-editor-compile-status is-error";
      this.setStatus(`Compile failed: ${errors[0]}`, "error");
    }
  }

  private async save(): Promise<void> {
    try {
      const result = await saveActorScript(this.options.path, this.def);
      this.dirty = false;
      this.setStatus(result.changed ? "Saved." : "Saved (no changes).", "success");
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private setStatus(message: string, tone: StatusTone = "info"): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone;
    this.options.onStatus?.(message, tone);
  }

  close(): void {
    if (this.dirty && !window.confirm("Discard unsaved changes to this Actor Script?")) return;
    this.dispose();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.viewportSyncTimer !== undefined) window.clearTimeout(this.viewportSyncTimer);
    this.viewport?.dispose();
    this.viewport = null;
    this.overlay.remove();
    if (ActorScriptEditor.activeInstance === this) ActorScriptEditor.activeInstance = null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses a JSON object literal; returns a tagged result rather than throwing. */
function parseJsonObject(
  text: string,
): { ok: true; value: Record<string, SceneJsonValue> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Must be a JSON object." };
    }
    return { ok: true, value: parsed as Record<string, SceneJsonValue> };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/** Reads a Vec3 from a props value, falling back to `fallback` when absent/malformed. */
function readVec3Prop(value: SceneJsonValue | undefined, fallback: Vec3): Vec3 {
  if (Array.isArray(value) && value.length === 3) {
    const [x, y, z] = value;
    if (typeof x === "number" && typeof y === "number" && typeof z === "number") return [x, y, z];
  }
  return [...fallback] as Vec3;
}

/** A 3-input (X/Y/Z) numeric row bound by `data-as-vec="<key>"`. */
function vec3Row(key: string, label: string, value: Vec3): string {
  const input = (axis: number): string =>
    `<input type="number" step="0.1" value="${value[axis]}" aria-label="${escapeHtml(label)} ${"XYZ"[axis]}" />`;
  return `
    <label class="as-field as-vec-field">
      <span>${label}</span>
      <div class="as-vec3" data-as-vec="${escapeHtml(key)}">
        ${input(0)}${input(1)}${input(2)}
      </div>
    </label>
  `;
}

function stringifyMetadataDefault(value: MetadataFieldDef["default"]): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Coerces a Details text input into a metadata default of the field's type. */
function coerceMetadataDefault(
  text: string,
  type: MetadataFieldType,
): MetadataFieldDef["default"] {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "boolean") return trimmed === "true";
  if (type === "tags") {
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return trimmed;
}
