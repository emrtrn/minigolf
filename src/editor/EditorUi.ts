// Editor-only styles. Importing here (rather than statically in index.html)
// keeps them in the dev-only editor chunk, out of the production game build.
import "./editorUi.css";
import {
  ASSET_TYPES,
  assetPath,
  assetRecordById,
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
import type {
  LayoutAudio,
  LayoutBehavior,
  LayoutCloudLayer,
  LayoutInteraction,
  LayoutHeightFog,
  LayoutParticleEmitter,
  LayoutPhysics,
  LayoutPostProcess,
  LayoutSkyAtmosphere,
  MetadataValue,
  Vec3,
} from "@engine/scene/layout";
import {
  isShapePrimitiveType,
  PLAYER_START_ASSET_ID,
  shapeAssetId,
  type ShapePrimitiveType,
} from "@engine/scene/shapes";
import { writePlayCameraPose } from "@/play/cameraHandoff";
import { ThumbnailRenderer, type ThumbnailMaterialPreview } from "./ThumbnailRenderer";
import {
  createProjectContent,
  deleteProjectContent,
  fetchProjectDir,
  findProjectDir,
  flattenProjectFiles,
  importProjectAsset,
  normalizeProjectPath,
  openProjectLevel,
  renameProjectContent,
  type ContentNewKind,
  type ProjectDirNode,
} from "@/project/ProjectAssetTree";
import { projectFileUrl } from "@/project/ProjectSystem";
import { loadAssetMaterialSlots } from "@/scene/assetMaterialSlotsLoader";
import { GAME_MODE_OPTIONS, type GameModeOption } from "@/game/gameModes/catalog";
import { loadActorScript } from "@/editor/actorScriptStore";
import { BEHAVIOR_SCRIPT_IDS } from "@/game/behaviors";
import {
  PARENT_CLASSES,
  PARENT_CLASS_DESCRIPTIONS,
  PARENT_CLASS_LABELS,
  type ParentClass,
} from "@engine/scene/actorScript";
import {
  FORGE_MATERIAL_PRESETS,
  normalizeForgeMaterialDef,
  type ForgeMaterialPreset,
} from "@engine/assets/material";
import {
  COLLISION_CHANNELS,
  COLLISION_ENABLED_VALUES,
  COLLISION_OBJECT_CHANNELS,
  COLLISION_PRESET_IDS,
  COLLISION_RESPONSE_VALUES,
  PHYSICAL_MATERIAL_IDS,
  type CollisionChannel,
  type CollisionEnabled,
  type CollisionObjectChannel,
  type CollisionPresetId,
  type CollisionResponse,
  type CollisionResponseMap,
} from "@engine/scene/collision";
import {
  nextTransformTool,
  type EditorTool,
  type TransformSpace,
} from "@editor/core/tools";

type InspectorTab = "details" | "world";

/** Numeric Sphere Reflection Capture probe fields editable from the Details panel. */
type CaptureNumericKey = "radius" | "intensity" | "resolution" | "near" | "far" | "priority";

/** Numeric Reflective Surface fields editable from the Details panel. */
type SurfaceNumericKey =
  | "reflectionStrength"
  | "fresnelPower"
  | "fresnelBias"
  | "distortion"
  | "resolution";

const DEFAULT_LINEAR_DAMPING = 0.12;
const DEFAULT_ANGULAR_DAMPING = 0.45;
const PHYSICS_AXIS_LABELS = ["X", "Y", "Z"] as const;

/** Typed assets the Content Browser context menu can create (besides folders). */
const CONTENT_NEW_ITEMS: ReadonlyArray<{ kind: ContentNewKind; label: string }> = [
  { kind: "level", label: "Level" },
  { kind: "material", label: "Material" },
  { kind: "particle", label: "Particle" },
  { kind: "script", label: "Script" },
  { kind: "sound", label: "Sound" },
  { kind: "soundCue", label: "Sound Cue" },
  { kind: "ui", label: "UI" },
];

const MATERIAL_PRESET_LABELS: Record<ForgeMaterialPreset, string> = {
  standard: "Standard Surface",
  textured: "Textured Surface",
  metal: "Metal",
  glass: "Glass",
  emissive: "Emissive",
  basic: "Unlit Basic",
};

const MATERIAL_PRESET_DESCRIPTIONS: Record<ForgeMaterialPreset, string> = {
  standard: "General lit PBR material with neutral roughness.",
  textured: "Standard material prepared for texture slots.",
  metal: "Reflective metal starter values.",
  glass: "Simple transparent glass-like starter values.",
  emissive: "Self-lit surface for signs, screens, and glow accents.",
  basic: "Unlit material for simple debug or UI-like surfaces.",
};

/** A context-menu entry: a clickable item or a visual separator. */
type ContextMenuItem =
  | { separator: true }
  | { separator?: false; label: string; enabled?: boolean; danger?: boolean; run: () => void };

/** Optional components the Details panel can add/remove (Transform is required). */
const ADDABLE_COMPONENTS = ["audio", "behavior", "particle", "interaction"] as const;
type AddableComponent = (typeof ADDABLE_COMPONENTS)[number];
const COMPONENT_LABELS: Record<AddableComponent, string> = {
  audio: "Audio",
  behavior: "Behavior",
  particle: "Particle",
  interaction: "Interaction",
};
/** Default audio clip seeded when adding an Audio component (a known clip id). */
const DEFAULT_AUDIO_CLIP = "collision-chime";
/** Default effect id seeded when adding a Particle component. */
const DEFAULT_PARTICLE_EFFECT = "fx.smoke_soft_01";
/** Default script seeded when adding a Behavior component. */
const DEFAULT_BEHAVIOR_SCRIPT = "spin";

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

const COLLISION_ENABLED_LABELS: Record<CollisionEnabled, string> = {
  none: "No Collision",
  query: "Query Only",
  physics: "Physics Only",
  queryAndPhysics: "Query and Physics",
};

const COLLISION_OBJECT_LABELS: Record<CollisionObjectChannel, string> = {
  worldStatic: "World Static",
  worldDynamic: "World Dynamic",
  pawn: "Pawn",
  physicsBody: "Physics Body",
  trigger: "Trigger",
};

const COLLISION_CHANNEL_LABELS: Record<CollisionChannel, string> = {
  worldStatic: "World Static",
  worldDynamic: "World Dynamic",
  pawn: "Pawn",
  physicsBody: "Physics Body",
  trigger: "Trigger",
  visibility: "Visibility",
  camera: "Camera",
};

const COLLISION_RESPONSE_LABELS: Record<CollisionResponse, string> = {
  ignore: "Ignore",
  overlap: "Overlap",
  block: "Block",
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

interface BrowserFolderItem {
  key: string;
  label: string;
  path: string;
  type: "folder";
  fileCount: number;
  descendantFileCount: number;
}

type BrowserContentItem = BrowserFolderItem | BrowserAssetItem;

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
  private contentSizeToggle: HTMLButtonElement;
  private folderTree: HTMLElement;
  private outlinerList: HTMLDivElement;
  private detailsBody: HTMLDivElement;
  private worldSettingsBody: HTMLDivElement;
  private statusText: HTMLElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  private toolButtons = new Map<EditorTool, HTMLButtonElement>();
  private readonly thumbnailRenderer = new ThumbnailRenderer();
  private readonly materialPreviewCache = new Map<string, Promise<ThumbnailMaterialPreview | undefined>>();
  private readonly modelMaterialPreviewCache = new Map<string, Promise<ThumbnailMaterialPreview | undefined>>();
  private activeTool: EditorTool = "move";
  private projectInfo: EditorProjectInfo | null = null;
  private metadataSchema: MetadataSchema | null = null;
  private editableAssets: EditableAsset[] = [];
  private assetTreeRoot: ProjectDirNode | null = null;
  /** All project Actor Script classes discovered for editor pickers (game mode / pawn). */
  private projectActorClasses: { path: string; name: string; parentClass: ParentClass }[] = [];
  /** Project `gameMode` Actor Scripts discovered for the World Settings dropdown. */
  private projectGameModes: GameModeOption[] = [];
  private selectedFolder = "";
  private collapsedFolderPaths = new Set<string>();
  /** Content Browser asset card highlighted as selected (orange). */
  private selectedAssetId: string | null = null;
  /** Content Browser folder card highlighted as selected. */
  private selectedContentFolderPath: string | null = null;
  /** Last asset-grid summary status, restored when the selection is cleared. */
  private contentListStatus = "";
  /** Cached 1x1 transparent image used to suppress the native drag thumbnail. */
  private emptyDragImage: HTMLImageElement | null = null;
  private contentQuery = "";
  private contentType: ContentTypeFilter = CONTENT_FILTER_ALL;
  private contentDrawerOpen = false;
  private contentDrawerTall = false;
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
  /** Hidden file input reused by the Content Browser Import flow. */
  private importInput: HTMLInputElement | null = null;
  /** Folder the next Import upload targets (set when Import is clicked). */
  private importTargetDir = "";
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
              <div class="add-actor-section-title">Visual Effects</div>
              <button type="button" data-add-sky-atmosphere>Sky Atmosphere</button>
              <button type="button" data-add-height-fog>Exponential Height Fog</button>
              <button type="button" data-add-cloud-layer>Cloud Layer</button>
              <button type="button" data-add-reflection-plane>Mirror Plane</button>
              <button type="button" data-add-reflective-surface>Reflective Surface</button>
              <button type="button" data-add-reflection-capture>Sphere Reflection Capture</button>
              <button type="button" data-add-post-process>Post Process</button>
              <div class="add-actor-section-title">UI</div>
              <button type="button" data-add-world-widget>World Widget</button>
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
          <button
            type="button"
            class="content-size-toggle"
            data-content-size-toggle
            aria-pressed="false"
            title="Toggle drawer height"
          >Tall</button>
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
    this.contentSizeToggle = requireElement(this.root, "[data-content-size-toggle]");
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

    // Sky Atmosphere is a transform-less singleton environment actor: click to add
    // (or select the existing one) rather than drag-to-place.
    this.root
      .querySelector<HTMLButtonElement>("[data-add-sky-atmosphere]")
      ?.addEventListener("click", () => {
        this.app.addSkyAtmosphere();
      });

    // Height Fog is a transform-less singleton environment actor: click to add
    // (or select the existing one) rather than drag-to-place.
    this.root
      .querySelector<HTMLButtonElement>("[data-add-height-fog]")
      ?.addEventListener("click", () => {
        this.app.addHeightFog();
      });

    // Cloud Layer is a transform-less singleton environment actor: click to add
    // (or select the existing one) rather than drag-to-place.
    this.root
      .querySelector<HTMLButtonElement>("[data-add-cloud-layer]")
      ?.addEventListener("click", () => {
        this.app.addCloudLayer();
      });

    // Reflection Plane (Planar mirror) is a placed actor with a transform.
    this.root
      .querySelector<HTMLButtonElement>("[data-add-reflection-plane]")
      ?.addEventListener("click", () => {
        this.app.addReflectionPlane();
      });

    // Reflective Surface (textured glossy planar reflection) is a placed actor.
    this.root
      .querySelector<HTMLButtonElement>("[data-add-reflective-surface]")
      ?.addEventListener("click", () => {
        this.app.addReflectiveSurface();
      });

    // Sphere Reflection Capture (probe) is a placed actor with a transform.
    this.root
      .querySelector<HTMLButtonElement>("[data-add-reflection-capture]")
      ?.addEventListener("click", () => {
        this.app.addReflectionCapture();
      });

    // Post Process is a transform-less singleton environment actor.
    this.root
      .querySelector<HTMLButtonElement>("[data-add-post-process]")
      ?.addEventListener("click", () => {
        this.app.addPostProcess();
      });

    // World Widget is a placed world-space UI billboard (anchor + Details fields).
    this.root
      .querySelector<HTMLButtonElement>("[data-add-world-widget]")
      ?.addEventListener("click", () => {
        this.app.addWorldWidget(this.firstUiWidgetAssetId());
      });

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

    this.contentSizeToggle.addEventListener("click", () => {
      this.setContentDrawerTall(!this.contentDrawerTall);
    });

    // Right-click empty asset-grid space -> create content in the current folder.
    // (Right-clicking a card stops propagation and shows the asset menu instead.)
    this.contentList.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openContentContextMenu(event, this.selectedFolder);
    });

    // Click empty asset-grid space -> clear the current asset selection.
    this.contentList.addEventListener("click", (event) => {
      if (event.target === this.contentList) this.clearContentSelection();
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
   * codebase â€” the game is this same app's default route (`/`), so Play just
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
    // starts there). Temporary session override â€” not written to the layout.
    writePlayCameraPose(this.app.getPlayCameraPose());
    const previewUrl = this.projectInfo?.manifest.editor.previewUrl ?? "/";
    const opened = window.open(previewUrl, "_blank", "noopener");
    if (opened) {
      this.setStatus(`Saved. Opening game: ${previewUrl}`, "success");
    } else {
      this.setStatus(`Saved. Popup blocked â€” open ${previewUrl} manually.`, "warning");
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

  /** Toggles the drawer's open DOM state + the periodic refresh interval (no immediate fetch). */
  private applyContentDrawerState(open: boolean): void {
    this.contentDrawerOpen = open;
    this.contentDrawer.classList.toggle("open", open);
    this.contentDrawer.setAttribute("aria-hidden", String(!open));
    this.contentToggle.classList.toggle("active", open);
    this.contentToggle.setAttribute("aria-expanded", String(open));

    window.clearInterval(this.contentRefreshTimer);
    this.contentRefreshTimer = 0;
    if (open) {
      this.contentRefreshTimer = window.setInterval(() => {
        void this.refreshAssetTree({ quiet: true });
      }, 7000);
    }
  }

  private setContentDrawerOpen(open: boolean): void {
    this.applyContentDrawerState(open);
    if (open) void this.refreshAssetTree({ quiet: true });
  }

  private setContentDrawerTall(tall: boolean): void {
    this.contentDrawerTall = tall;
    this.contentDrawer.classList.toggle("is-tall", tall);
    this.contentSizeToggle.classList.toggle("active", tall);
    this.contentSizeToggle.setAttribute("aria-pressed", String(tall));
    this.contentSizeToggle.textContent = tall ? "Short" : "Tall";
  }

  /**
   * Reveals an asset in the Content Browser (Toolbar â†’ Browse from an open
   * editor): opens the drawer, navigates to the asset's folder (expanding
   * ancestors and clearing any type/search filter that would hide it), then
   * selects + briefly flashes the card. Best-effort â€” a missing folder falls
   * back to the asset root. Uses a single authoritative refresh so the flash is
   * never clobbered by a concurrent reload.
   */
  async revealContentAsset(path: string): Promise<void> {
    this.applyContentDrawerState(true);
    await this.refreshAssetTree({ quiet: true });
    if (!this.assetTreeRoot) {
      this.setStatus(`In Content Browser: ${path}`);
      return;
    }
    const normalized = normalizeProjectPath(path);
    const root = this.assetTreeRoot.path;
    const parentDir = normalized.includes("/")
      ? normalized.slice(0, normalized.lastIndexOf("/"))
      : root;
    // Pick the folder that holds the asset; fall back to the asset root.
    const folder =
      parentDir === root || findProjectDir(this.assetTreeRoot.children ?? [], parentDir)
        ? parentDir
        : root;
    this.selectedFolder = folder;
    // Expand every ancestor so the folder is visible in the tree.
    const segments = folder.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      this.collapsedFolderPaths.delete(segments.slice(0, i).join("/"));
    }
    // Clear any filter/search that would hide the target card.
    this.contentType = CONTENT_FILTER_ALL;
    this.contentTypeFilter.value = CONTENT_FILTER_ALL;
    this.contentQuery = "";
    this.contentSearch.value = "";
    this.renderFolderTree();
    this.renderContentAssets();
    this.flashContentCard(path);
  }

  /** Selects + briefly highlights the Content Browser card for `path`, scrolling it into view. */
  private flashContentCard(path: string): void {
    const card = this.contentList.querySelector<HTMLElement>(
      `.asset-card[data-asset-path="${CSS.escape(path)}"]`,
    );
    if (!card) {
      this.setStatus(`In Content Browser: ${path}`);
      return;
    }
    if (card.dataset.assetId) this.setSelectedAsset(card.dataset.assetId);
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card.classList.add("is-revealed");
    window.setTimeout(() => card.classList.remove("is-revealed"), 1600);
    this.setStatus(`Revealed in Content Browser: ${path}`, "info");
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
      void this.refreshProjectActorClasses();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.contentStatus.textContent = message;
      if (!options.quiet) this.setStatus(message, "error");
    }
  }

  /**
   * Scans the project's `*.actor.json` files and caches each class's name +
   * parent class, then derives the editor pickers that depend on it: the World
   * Settings Game Mode dropdown ({@link projectGameModes}) and (on demand) the
   * Game Mode "Default Pawn Class" picker. Re-renders the World Settings tab when
   * the discovered Game Mode set changed.
   */
  private async refreshProjectActorClasses(): Promise<void> {
    if (!this.assetTreeRoot) return;
    const actorPaths = flattenProjectFiles([this.assetTreeRoot])
      .filter((file) => file.path.endsWith(".actor.json"))
      .map((file) => normalizeProjectPath(file.path));
    this.projectActorClasses = await Promise.all(
      actorPaths.map(async (path) => {
        const def = await loadActorScript(path, path);
        return { path, name: def.name || path, parentClass: def.parentClass };
      }),
    );

    const next: GameModeOption[] = this.projectActorClasses
      .filter((cls) => cls.parentClass === "gameMode")
      .map((cls) => ({
        id: cls.path,
        displayName: cls.name,
        description: "Project Game Mode (Actor Script).",
      }));
    const changed =
      next.length !== this.projectGameModes.length ||
      next.some((option, index) => {
        const prev = this.projectGameModes[index];
        return !prev || prev.id !== option.id || prev.displayName !== option.displayName;
      });
    if (!changed) return;
    this.projectGameModes = next;
    this.renderWorldSettings(this.worldSettings ?? this.app.getWorldSettings());
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
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (node === this.assetTreeRoot) {
        this.openContentContextMenu(event, node.path);
      } else {
        this.openContentFolderContextMenu(event, this.toBrowserFolderItem(node));
      }
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
    const children = selected?.children ?? [];
    const folders = children
      .filter((child) => child.type === "dir")
      .map((folder) => this.toBrowserFolderItem(folder))
      .filter((item) => this.contentItemMatchesQuery(item));
    const files = children.filter((child) => child.type === "file");
    const assets = files
      .filter((file) => this.shouldDisplayAssetFile(file))
      .map((file) => this.toBrowserAssetItem(file))
      .filter((item) => this.contentType === CONTENT_FILTER_ALL || item.type === this.contentType)
      .filter((item) => this.contentItemMatchesQuery(item));
    const items: BrowserContentItem[] = [...folders, ...assets];
    const issueCount = assets.filter((item) => contentAssetIssues(item).length > 0).length;
    const missingManifestAssetCount = this.countMissingManifestAssetFiles();

    this.contentPathLabel.textContent = this.selectedFolder || this.assetTreeRoot.path;
    this.contentListStatus = formatContentListStatus(
      items.length,
      folders.length,
      files.length,
      issueCount,
      missingManifestAssetCount,
    );
    this.contentStatus.textContent = this.contentListStatus;

    if (items.length === 0) {
      this.contentList.innerHTML = `
        <div class="empty-details">
          <strong>No matching content</strong>
          <span>${escapeHtml(this.selectedFolder)}</span>
        </div>
      `;
      return;
    }

    this.contentList.replaceChildren(
      ...items.map((item) =>
        item.type === "folder" ? this.createFolderCard(item) : this.createAssetCard(item),
      ),
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
    return !(
      name === "manifest.json" ||
      name === "catalog.json" ||
      name === "metadata-schema.json" ||
      name.endsWith(".collision.json") ||
      name.endsWith(".materials.json") ||
      name.endsWith(".uvw.json")
    );
  }

  private toBrowserFolderItem(folder: ProjectDirNode): BrowserFolderItem {
    return {
      key: folder.path,
      label: folder.name,
      path: folder.path,
      type: "folder",
      fileCount: folder.children?.filter((child) => child.type === "file").length ?? 0,
      descendantFileCount: flattenProjectFiles([folder]).length,
    };
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

  private contentItemMatchesQuery(item: BrowserContentItem): boolean {
    if (!this.contentQuery) return true;
    return `${item.label} ${item.type} ${item.path}`.toLocaleLowerCase().includes(this.contentQuery);
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
    if (assetId !== null) this.selectedContentFolderPath = null;
    for (const card of this.contentList.querySelectorAll<HTMLElement>(".asset-card")) {
      card.classList.toggle("is-selected", card.dataset.assetId === assetId);
    }
  }

  private setSelectedContentFolder(path: string | null): void {
    this.selectedContentFolderPath = path;
    if (path !== null) this.selectedAssetId = null;
    for (const card of this.contentList.querySelectorAll<HTMLElement>(".asset-card")) {
      card.classList.toggle("is-selected", card.dataset.folderPath === path);
    }
  }

  private createAssetCard(item: BrowserAssetItem): HTMLElement {
    const canPlace = Boolean(item.editable?.placeable);
    const canAssignMaterial = Boolean(item.editable && item.type === "material");
    const activeLevel = this.isActiveLevel(item);
    const issues = contentAssetIssues(item);
    const issueTooltip = contentAssetIssueTooltip(issues);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "asset-card";
    card.classList.toggle("is-unregistered", !item.editable);
    card.classList.toggle("has-issues", issues.length > 0);
    // The active level is visually marked and locked against destructive actions.
    card.classList.toggle("is-active-level", activeLevel);
    card.classList.toggle(
      "is-selected",
      Boolean(item.editable && item.editable.id === this.selectedAssetId),
    );
    const canPlaceActorClass = isActorScriptItem(item);
    card.draggable = canPlace || canAssignMaterial || canPlaceActorClass;
    card.dataset.assetPath = item.path;
    if (item.editable) card.dataset.assetId = item.editable.id;
    card.innerHTML = `
      ${
        issues.length > 0
          ? `<span class="asset-issue-dot" title="${escapeHtml(issueTooltip)}" aria-label="${escapeHtml(issueTooltip)}"></span>`
          : ""
      }
      ${
        activeLevel
          ? `<span class="asset-active-badge" title="Active level — locked against rename/delete">Active</span>`
          : ""
      }
      <span class="asset-thumb" data-asset-thumb>${escapeHtml(item.ext.toUpperCase())}</span>
      <span class="asset-meta">
        <strong title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</strong>
        <span class="asset-type-line">${escapeHtml(formatContentTypeBadge(item.type))}</span>
      </span>
    `;
    card.addEventListener("dragstart", (event) => {
      if (canPlaceActorClass) {
        // Actor Script classes place by reference (classRef = public-relative path),
        // not by manifest asset id, so they drag even when not manifest-registered.
        event.dataTransfer?.setData("application/x-forge-actor-class", item.path);
        event.dataTransfer!.effectAllowed = "copy";
        event.dataTransfer?.setDragImage(this.getEmptyDragImage(), 0, 0);
        this.setStatus(`Dragging ${item.label} â€” drop in the viewport to place.`);
        return;
      }
      if (!item.editable || (!canPlace && !canAssignMaterial)) return;
      if (canAssignMaterial) {
        event.dataTransfer?.setData("application/x-forge-material", item.editable.id);
      } else {
        event.dataTransfer?.setData("application/x-3dgamedev-asset", item.editable.id);
      }
      event.dataTransfer!.effectAllowed = "copy";
      // Hide the browser's default drag image (a snapshot of the card) so only
      // the 3D placement ghost in the viewport tracks the cursor.
      event.dataTransfer?.setDragImage(this.getEmptyDragImage(), 0, 0);
      this.setSelectedAsset(item.editable.id);
      if (canPlace) this.app.beginAssetDragPreview(item.editable.id);
      this.setStatus(
        canAssignMaterial
          ? `Dragging ${item.editable.id} â€” drop on a static mesh.`
          : `Dragging ${item.editable.id} â€” drop in the viewport to place.`,
      );
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
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      // Stop the bubble so the asset-grid's "new content" menu doesn't replace this.
      event.stopPropagation();
      if (item.editable) this.setSelectedAsset(item.editable.id);
      this.showContentAssetDetails(item, issues);
      this.openAssetContextMenu(event, item);
    });
    if (item.type !== "file" && isModelAssetType(item.type)) {
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        void this.openMeshEditor(item);
      });
    }
    if (isActorScriptItem(item)) {
      card.classList.add("is-actor-script");
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        void this.openActorScriptEditor(item);
      });
    }
    if (item.type === "material") {
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        void this.openMaterialEditor(item);
      });
    }
    if (isLevelItem(item) && !activeLevel) {
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        void this.openLevel(item);
      });
    }
    if (isUiWidgetItem(item)) {
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        void this.openUiWidgetEditor(item);
      });
    }
    const thumb = card.querySelector<HTMLElement>("[data-asset-thumb]");
    if (thumb && isActorScriptItem(item)) thumb.textContent = "BP";
    if (thumb && item.type !== "file" && isModelAssetType(item.type)) {
      void this.renderAssetThumbnail(item, thumb);
    } else if (thumb && item.type === "material") {
      void this.renderMaterialThumbnail(item, thumb);
    } else if (thumb && item.type === "texture") {
      this.renderTextureThumbnail(item, thumb);
    }
    return card;
  }

  private createFolderCard(item: BrowserFolderItem): HTMLElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "asset-card is-folder";
    card.classList.toggle("is-selected", item.path === this.selectedContentFolderPath);
    card.dataset.folderPath = item.path;
    card.title = item.path;
    card.innerHTML = `
      <span class="asset-thumb folder-thumb">DIR</span>
      <span class="asset-meta">
        <strong title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</strong>
        <span class="asset-type-line">Folder</span>
      </span>
    `;
    card.addEventListener("click", () => {
      this.setSelectedContentFolder(item.path);
      this.contentStatus.textContent = `${item.label} - Folder`;
    });
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      this.navigateToContentFolder(item.path);
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setSelectedContentFolder(item.path);
      this.openContentFolderContextMenu(event, item);
    });
    return card;
  }

  private navigateToContentFolder(path: string): void {
    this.selectedFolder = path;
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      this.collapsedFolderPaths.delete(segments.slice(0, i).join("/"));
    }
    this.clearContentSelection();
    this.renderFolderTree();
    this.renderContentAssets();
  }

  private showContentAssetDetails(item: BrowserAssetItem, issues: BrowserAssetIssue[]): void {
    const prefix = `${item.label} Â· ${formatContentTypeBadge(item.type)}`;
    this.contentStatus.textContent =
      issues.length > 0 ? `${prefix} Â· ${contentAssetIssueTooltip(issues)}` : `${prefix} Â· No issues`;
  }

  /** Drops the Content Browser asset selection and restores the grid summary. */
  private clearContentSelection(): void {
    if (this.selectedAssetId === null && this.selectedContentFolderPath === null) return;
    this.setSelectedAsset(null);
    this.setSelectedContentFolder(null);
    this.contentStatus.textContent = this.contentListStatus;
  }

  /** Right-click menu for a single Content Browser asset card. */
  private openAssetContextMenu(event: MouseEvent, item: BrowserAssetItem): void {
    const items: ContextMenuItem[] = [];
    const activeLevel = this.isActiveLevel(item);
    if (isLevelItem(item)) {
      // A level's primary action is choosing it as the project's default scene.
      // The active level shows a disabled marker instead (it is already default).
      if (activeLevel) {
        items.push({ label: "✓ Default Level", enabled: false, run: () => {} });
      } else {
        items.push({ label: "Set Default Level", run: () => void this.openLevel(item) });
      }
      items.push({ separator: true });
    } else {
      const opener = this.assetEditorOpener(item);
      if (opener) {
        items.push({ label: "Open", run: opener });
        items.push({ separator: true });
      }
    }
    // The active level is locked: renaming or deleting it would leave
    // `defaultScene` pointing at a missing file, so both are disabled.
    items.push({
      label: "Rename...",
      enabled: !activeLevel,
      run: () => void this.renameContentAsset(item),
    });
    items.push({ label: "Copy Path", run: () => void this.copyContentAssetPath(item) });
    items.push({ separator: true });
    items.push({
      label: "Delete",
      danger: true,
      enabled: !activeLevel,
      run: () => void this.deleteContentAsset(item),
    });
    this.openContextMenu(event, items);
  }

  /** Right-click menu for a Content Browser folder card/tree row. */
  private openContentFolderContextMenu(event: MouseEvent, item: BrowserFolderItem): void {
    const items: ContextMenuItem[] = [
      { label: "Open", run: () => this.navigateToContentFolder(item.path) },
      { separator: true },
      { label: "New Folder", run: () => void this.createContent("folder", item.path) },
      { label: "Import...", run: () => this.startImport(item.path) },
      { separator: true },
      { label: "Rename...", run: () => void this.renameContentFolder(item) },
      { label: "Copy Path", run: () => void this.copyContentFolderPath(item) },
      { separator: true },
      {
        label: "Delete",
        danger: true,
        run: () => void this.deleteContentFolder(item),
      },
    ];
    this.openContextMenu(event, items);
  }

  /** Returns an action opening the editor that matches `item`, or null. */
  private assetEditorOpener(item: BrowserAssetItem): (() => void) | null {
    if (isLevelItem(item)) return () => void this.openLevel(item);
    if (item.type === "material") return () => void this.openMaterialEditor(item);
    if (isUiWidgetItem(item)) return () => void this.openUiWidgetEditor(item);
    if (isActorScriptItem(item)) return () => void this.openActorScriptEditor(item);
    if (item.type !== "file" && isModelAssetType(item.type)) {
      return () => void this.openMeshEditor(item);
    }
    return null;
  }

  /**
   * Opens a level for editing: makes it the project's active scene
   * (`editor.defaultScene`) via the dev endpoint, then reloads so boot rebuilds
   * the whole scene from the new default. A full reload is intentional — the
   * scene build path (physics, behaviors, reflections, widgets, runtime) is the
   * boot path, so reusing it avoids a fragile in-place teardown. Switching the
   * active scene also changes where Save writes, so this is gated on a confirm
   * when the current level has undoable (possibly unsaved) edits.
   */
  private async openLevel(item: BrowserAssetItem): Promise<void> {
    if (this.isActiveLevel(item)) {
      this.setStatus(`${item.label} is already the active level.`, "info");
      return;
    }
    if (
      this.app.getHistoryState().canUndo &&
      !window.confirm(
        `Open "${item.label}"?\nUnsaved changes to the current level will be lost.`,
      )
    ) {
      return;
    }
    try {
      await openProjectLevel(item.path);
      this.setStatus(`Opening ${item.label}…`, "success");
      window.location.reload();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /**
   * True when `item` is the level the project currently loads + saves
   * (`editor.defaultScene`). The active level is locked in the Content Browser:
   * it can't be deleted or renamed (either would break the next scene load), and
   * it is the one "Set Default Level" hides since it is already the default.
   */
  private isActiveLevel(item: BrowserAssetItem): boolean {
    if (!isLevelItem(item)) return false;
    const current = this.projectInfo?.manifest.editor.defaultScene;
    return Boolean(current && normalizeProjectPath(current) === normalizeProjectPath(item.path));
  }

  /** Prompts for a new base name and renames the asset file via the dev endpoint. */
  private async renameContentAsset(item: BrowserAssetItem): Promise<void> {
    if (this.isActiveLevel(item)) {
      this.setStatus(
        `"${item.label}" is the active level and is locked. Set another level as default before renaming it.`,
        "warning",
      );
      return;
    }
    const fileName = item.path.split("/").at(-1) ?? item.path;
    const dot = fileName.indexOf(".");
    const currentBase = dot > 0 ? fileName.slice(0, dot) : fileName;
    const next = window.prompt("Rename asset", currentBase);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentBase) return;
    try {
      const result = await renameProjectContent(item.path, trimmed);
      this.setStatus(`Renamed to ${result.path}`, "success");
      if (result.registered) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below still shows the new name.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Confirms, then deletes the asset file (and sidecars/manifest entry). */
  private async deleteContentAsset(item: BrowserAssetItem): Promise<void> {
    if (this.isActiveLevel(item)) {
      this.setStatus(
        `"${item.label}" is the active level and is locked. Set another level as default before deleting it.`,
        "warning",
      );
      return;
    }
    if (!window.confirm(`Delete "${item.label}"? This cannot be undone.`)) return;
    try {
      const result = await deleteProjectContent(item.path);
      if (item.editable && this.selectedAssetId === item.editable.id) {
        this.setSelectedAsset(null);
      }
      this.setStatus(`Deleted ${result.path}`, "success");
      if (result.registered) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below drops the deleted card.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Prompts for a new folder name and updates descendant path references server-side. */
  private async renameContentFolder(item: BrowserFolderItem): Promise<void> {
    const currentBase = item.path.split("/").at(-1) ?? item.label;
    const next = window.prompt("Rename folder", currentBase);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentBase) return;
    try {
      const result = await renameProjectContent(item.path, trimmed);
      this.selectedFolder = replaceContentPathPrefix(this.selectedFolder, item.path, result.path);
      if (this.selectedContentFolderPath) {
        this.selectedContentFolderPath = replaceContentPathPrefix(
          this.selectedContentFolderPath,
          item.path,
          result.path,
        );
      }
      this.collapsedFolderPaths = new Set(
        [...this.collapsedFolderPaths].map((path) =>
          replaceContentPathPrefix(path, item.path, result.path),
        ),
      );
      this.setStatus(`Renamed folder to ${result.path}`, "success");
      if (result.registered) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below still shows the new paths.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Confirms, then deletes a folder and asks the server to scrub stale references. */
  private async deleteContentFolder(item: BrowserFolderItem): Promise<void> {
    const hasFiles = item.descendantFileCount > 0;
    const message = hasFiles
      ? `Delete folder "${item.label}" and ${item.descendantFileCount} file(s)?\n\nForge will remove descendant manifest entries and clean level references to deleted assets/classes so the project can keep loading. This cannot be undone.`
      : `Delete empty folder "${item.label}"? This cannot be undone.`;
    if (!window.confirm(message)) return;
    try {
      const parent = parentContentPath(item.path) ?? this.assetTreeRoot?.path ?? "";
      const result = await deleteProjectContent(item.path);
      if (isSameOrDescendantContentPath(this.selectedFolder, item.path)) {
        this.selectedFolder = parent;
      }
      if (
        this.selectedContentFolderPath &&
        isSameOrDescendantContentPath(this.selectedContentFolderPath, item.path)
      ) {
        this.selectedContentFolderPath = null;
      }
      this.collapsedFolderPaths = new Set(
        [...this.collapsedFolderPaths].filter((path) => !isSameOrDescendantContentPath(path, item.path)),
      );
      this.setStatus(
        `Deleted ${result.path} (${result.deletedFiles} file(s), ${result.removedAssets} asset(s), ${result.cleanedLayouts} level file(s) cleaned)`,
        "success",
      );
      if (result.registered || result.removedAssets > 0) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below drops deleted files.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Copies the folder's public-relative path to the clipboard. */
  private async copyContentFolderPath(item: BrowserFolderItem): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.path);
      this.setStatus(`Copied ${item.path}`, "success");
    } catch {
      this.setStatus(`Path: ${item.path}`, "info");
    }
  }

  /** Copies the asset's public-relative path to the clipboard. */
  private async copyContentAssetPath(item: BrowserAssetItem): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.path);
      this.setStatus(`Copied ${item.path}`, "success");
    } catch {
      this.setStatus(`Path: ${item.path}`, "info");
    }
  }

  private renderTextureThumbnail(item: BrowserAssetItem, thumb: HTMLElement): void {
    thumb.replaceChildren();
    const image = document.createElement("img");
    image.alt = "";
    image.src = projectFileUrl(item.path);
    thumb.append(image);
  }

  private async renderMaterialThumbnail(item: BrowserAssetItem, thumb: HTMLElement): Promise<void> {
    try {
      const material = await this.resolveMaterialPreview(item);
      if (!material) throw new Error("Material preview unavailable");
      const imageUrl = await this.thumbnailRenderer.renderMaterial(item.editable?.id ?? item.path, material);
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

  private resolveMaterialPreview(item: BrowserAssetItem): Promise<ThumbnailMaterialPreview | undefined> {
    const key = item.editable?.id ?? item.path;
    let cached = this.materialPreviewCache.get(key);
    if (!cached) {
      cached = this.resolveMaterialPreviewUncached(item);
      this.materialPreviewCache.set(key, cached);
    }
    return cached;
  }

  private async resolveMaterialPreviewUncached(
    item: BrowserAssetItem,
  ): Promise<ThumbnailMaterialPreview | undefined> {
    return this.resolveMaterialPreviewById(item.editable?.id, item.path);
  }

  private resolveModelDefaultMaterialPreview(item: BrowserAssetItem): Promise<ThumbnailMaterialPreview | undefined> {
    const key = item.editable?.id ?? item.path;
    let cached = this.modelMaterialPreviewCache.get(key);
    if (!cached) {
      cached = this.resolveModelDefaultMaterialPreviewUncached(item);
      this.modelMaterialPreviewCache.set(key, cached);
    }
    return cached;
  }

  private async resolveModelDefaultMaterialPreviewUncached(
    item: BrowserAssetItem,
  ): Promise<ThumbnailMaterialPreview | undefined> {
    const slots = await loadAssetMaterialSlots(item.path);
    const materialId = slots.slots[0];
    return materialId ? this.resolveMaterialPreviewById(materialId) : undefined;
  }

  private async resolveMaterialPreviewById(
    materialId: string | undefined,
    fallbackPath?: string,
  ): Promise<ThumbnailMaterialPreview | undefined> {
    const materialRecord = materialId
      ? assetRecordById({ version: 1, generated: "", ktx2: false, assets: this.editableAssets }, materialId)
      : undefined;
    const materialPath = materialRecord ? assetPath(materialRecord) : fallbackPath;
    if (!materialPath) return undefined;
    const response = await fetch(projectFileUrl(materialPath));
    if (!response.ok) return undefined;
    const def = normalizeForgeMaterialDef(await response.json(), materialRecord?.name ?? "Material");
    const baseColorTexturePath = this.texturePathById(def.baseColorTexture);
    const normalTexturePath = this.texturePathById(def.normalTexture);
    const roughnessTexturePath = this.texturePathById(def.roughnessTexture);
    const metalnessTexturePath = this.texturePathById(def.metalnessTexture);
    const aoTexturePath = this.texturePathById(def.aoTexture);
    const opacityTexturePath = this.texturePathById(def.opacityTexture);
    const emissiveTexturePath = this.texturePathById(def.emissiveTexture);
    const ormTexturePath = this.texturePathById(def.ormTexture);
    const layer1BaseColorTexturePath = this.texturePathById(def.layerBlend?.layer1.baseColorTexture ?? null);
    const layer1NormalTexturePath = this.texturePathById(def.layerBlend?.layer1.normalTexture ?? null);
    const layer1RoughnessTexturePath = this.texturePathById(def.layerBlend?.layer1.roughnessTexture ?? null);
    const layer1MetalnessTexturePath = this.texturePathById(def.layerBlend?.layer1.metalnessTexture ?? null);
    const layer1OpacityTexturePath = this.texturePathById(def.layerBlend?.layer1.opacityTexture ?? null);
    const layer1EmissiveTexturePath = this.texturePathById(def.layerBlend?.layer1.emissiveTexture ?? null);
    const layer1AoTexturePath = this.texturePathById(def.layerBlend?.layer1.aoTexture ?? null);
    const layerBlendMaskTexturePath = this.texturePathById(def.layerBlend?.maskTexture ?? null);
    return {
      materialType: def.materialType,
      baseColor: def.baseColor,
      ...(baseColorTexturePath ? { baseColorTextureUrl: projectFileUrl(baseColorTexturePath) } : {}),
      ...(normalTexturePath ? { normalTextureUrl: projectFileUrl(normalTexturePath) } : {}),
      ...(roughnessTexturePath ? { roughnessTextureUrl: projectFileUrl(roughnessTexturePath) } : {}),
      ...(metalnessTexturePath ? { metalnessTextureUrl: projectFileUrl(metalnessTexturePath) } : {}),
      ...(aoTexturePath ? { aoTextureUrl: projectFileUrl(aoTexturePath) } : {}),
      ...(opacityTexturePath ? { opacityTextureUrl: projectFileUrl(opacityTexturePath) } : {}),
      ...(emissiveTexturePath ? { emissiveTextureUrl: projectFileUrl(emissiveTexturePath) } : {}),
      ...(ormTexturePath ? { ormTextureUrl: projectFileUrl(ormTexturePath) } : {}),
      ...(def.layerBlend ? { layerBlend: def.layerBlend } : {}),
      ...(layer1BaseColorTexturePath ? { layer1BaseColorTextureUrl: projectFileUrl(layer1BaseColorTexturePath) } : {}),
      ...(layer1NormalTexturePath ? { layer1NormalTextureUrl: projectFileUrl(layer1NormalTexturePath) } : {}),
      ...(layer1RoughnessTexturePath ? { layer1RoughnessTextureUrl: projectFileUrl(layer1RoughnessTexturePath) } : {}),
      ...(layer1MetalnessTexturePath ? { layer1MetalnessTextureUrl: projectFileUrl(layer1MetalnessTexturePath) } : {}),
      ...(layer1OpacityTexturePath ? { layer1OpacityTextureUrl: projectFileUrl(layer1OpacityTexturePath) } : {}),
      ...(layer1EmissiveTexturePath ? { layer1EmissiveTextureUrl: projectFileUrl(layer1EmissiveTexturePath) } : {}),
      ...(layer1AoTexturePath ? { layer1AoTextureUrl: projectFileUrl(layer1AoTexturePath) } : {}),
      ...(layerBlendMaskTexturePath ? { layerBlendMaskTextureUrl: projectFileUrl(layerBlendMaskTexturePath) } : {}),
      uvTiling: def.uvTiling,
      roughness: def.roughness,
      metalness: def.metalness,
      aoIntensity: def.aoIntensity,
      opacity: def.opacity,
      alphaMode: def.alphaMode,
      alphaTest: def.alphaTest,
      side: def.side,
      emissive: def.emissive,
      emissiveIntensity: def.emissiveIntensity,
    };
  }

  private texturePathById(textureId: string | null): string | undefined {
    if (!textureId) return undefined;
    const texture = assetRecordById(
      { version: 1, generated: "", ktx2: false, assets: this.editableAssets },
      textureId,
    );
    return texture ? assetPath(texture) : undefined;
  }

  private async renderAssetThumbnail(
    item: BrowserAssetItem,
    thumb: HTMLElement,
  ): Promise<void> {
    try {
      const material = await this.resolveModelDefaultMaterialPreview(item);
      const imageUrl = await this.thumbnailRenderer.renderModel(
        projectFileUrl(item.path),
        material,
      );
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
   * Opens the asset editor that matches the model asset type.
   */
  private async openMeshEditor(item: BrowserAssetItem): Promise<void> {
    if (item.type === "skeletalMesh") {
      await this.openSkeletalMeshEditor(item);
      return;
    }
    await this.openStaticMeshEditor(item);
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
        ...(item.editable ? { assetId: item.editable.id } : {}),
        label: item.label,
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onMaterialSlotsSaved: (assetId) => {
          this.modelMaterialPreviewCache.delete(assetId);
          this.renderContentAssets();
          void this.app.refreshAssetMaterialSlots(assetId);
        },
        onAssetUvwSaved: (assetId) => {
          void this.app.refreshAssetUvwMapping(assetId);
        },
        onCollisionSaved: () => {
          // Pick up the just-saved sidecar (preset/complexity/primitives) so the
          // scene's Show Collision overlay, Play-mode physics, and the Details
          // Simulate Physics guard (complexAsSimple → static-only) reflect it.
          void this.app.refreshAssetCollision().then(() => this.renderDetails(this.selected));
        },
      });
    } catch (error) {
      this.setStatus(
        `Could not open Static Mesh editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * Opens the Persona-style Skeletal Mesh editor for skinned character assets.
   */
  private async openSkeletalMeshEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { SkeletalMeshEditor } = await import("@/editor/SkeletalMeshEditor");
      SkeletalMeshEditor.open({
        modelPath: item.path,
        ...(item.editable ? { assetId: item.editable.id } : {}),
        label: item.label,
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        onStatus: (message, tone) => this.setStatus(message, tone),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Skeletal Mesh editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * Opens the form-based Material Editor for a `*.material.json` asset.
   * Kept behind a dynamic import like the other asset editors.
   */
  private async openMaterialEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { MaterialEditor } = await import("@/editor/MaterialEditor");
      await MaterialEditor.open({
        path: item.path,
        label: item.label.replace(/\.(material|mat)\.json$/i, ""),
        ...(item.editable ? { materialId: item.editable.id } : {}),
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => {
          const key = item.editable?.id ?? item.path;
          this.materialPreviewCache.delete(key);
          this.modelMaterialPreviewCache.clear();
          this.thumbnailRenderer.clearCache();
          this.renderContentAssets();
          if (item.editable) void this.app.refreshMaterialAsset(item.editable.id);
        },
        onApplyToSelected: (materialId) => this.app.setSelectionMaterialSlot(materialId),
        onBrowse: () => this.setStatus(`In Content Browser: ${item.path}`),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Material Editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * Opens the UMG Lite UI Widget editor for a `*.ui.json` asset. Kept behind a
   * dynamic import like the other asset editors.
   */
  private async openUiWidgetEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { UiWidgetEditor } = await import("@/editor/UiWidgetEditor");
      await UiWidgetEditor.open({
        path: item.path,
        label: item.label.replace(/\.ui\.json$/i, ""),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => this.renderContentAssets(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open UI Widget editor: ${error instanceof Error ? error.message : String(error)}`,
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
        <strong>${object.groupId ? "â›“ " : ""}${object.label}</strong>
        <small>${object.assetId} - ${formatPosition(object.position)}</small>
      </span>
      <span class="outliner-actions">
        <button type="button" class="outliner-toggle${object.hidden ? " on" : ""}"
          data-action="hidden" title="${object.hidden ? "Show object" : "Hide object"}">${object.hidden ? "ğŸ™ˆ" : "ğŸ‘"}</button>
        <button type="button" class="outliner-toggle${object.locked ? " on" : ""}"
          data-action="locked" title="${object.locked ? "Unlock object" : "Lock object"}">${object.locked ? "ğŸ”’" : "ğŸ”“"}</button>
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
    const selectedCount = this.outlinerObjects.filter((entry) => entry.selected).length;
    const inGroup =
      object.groupId !== undefined ||
      this.outlinerObjects.some((entry) => entry.selected && entry.groupId);

    const ensureSelected = (): void => {
      if (!object.selected) this.app.selectSceneObject(object.id);
    };

    const items: ContextMenuItem[] = [
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

    this.openContextMenu(event, items);
  }

  /**
   * Builds and positions a context menu at the pointer, wiring outside-click /
   * Escape / blur dismissal. Shared by the outliner and the Content Browser.
   */
  private openContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
    this.closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    for (const item of items) {
      if (item.separator) {
        const divider = document.createElement("div");
        divider.className = "context-menu-separator";
        menu.appendChild(divider);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = `context-menu-item${item.danger ? " danger" : ""}`;
      button.textContent = item.label;
      button.disabled = item.enabled === false;
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

  /** Right-click menu for the Content Browser: New Folder / Import / typed assets. */
  private openContentContextMenu(event: MouseEvent, dir: string): void {
    const items: ContextMenuItem[] = [
      { label: "New Folder", run: () => void this.createContent("folder", dir) },
      { separator: true },
      { label: "Import...", run: () => this.startImport(dir) },
      { separator: true },
      ...CONTENT_NEW_ITEMS.map((item) => ({
        label: item.label,
        run: () => void this.createContent(item.kind, dir),
      })),
    ];
    this.openContextMenu(event, items);
  }

  /** Prompts for a name, then creates the folder/typed stub and refreshes the tree. */
  private async createContent(kind: ContentNewKind, dir: string): Promise<void> {
    // A "Script" is an Actor Script class-asset: pick its parent class first
    // (Unreal's Pick Parent Class dialog), like creating a Blueprint Class.
    let parentClass: ParentClass | undefined;
    let materialPreset: ForgeMaterialPreset | undefined;
    if (kind === "script") {
      const picked = await this.pickParentClass();
      if (!picked) return;
      parentClass = picked;
    } else if (kind === "material") {
      const picked = await this.pickMaterialPreset();
      if (!picked) return;
      materialPreset = picked;
    }
    const label = kind === "folder" ? "folder" : kind === "script" ? "Actor Script" : `${kind} asset`;
    const name = window.prompt(`New ${label} name`, "");
    if (name === null || !name.trim()) return;
    try {
      const result = await createProjectContent({
        kind,
        dir,
        name: name.trim(),
        ...(parentClass ? { parentClass } : {}),
        ...(materialPreset ? { materialPreset } : {}),
      });
      this.setStatus(`Created ${result.path}`, "success");
      if (result.registeredId) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below still shows the new file.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /**
   * Modal mirroring Unreal's "Pick Parent Class": resolves to the chosen
   * {@link ParentClass}, or null when cancelled. Used when creating an Actor
   * Script from the Content Browser.
   */
  private pickParentClass(): Promise<ParentClass | null> {
    return new Promise((resolvePick) => {
      const overlay = document.createElement("div");
      overlay.className = "parent-class-overlay";
      const options = PARENT_CLASSES.map(
        (cls) => `
        <button type="button" class="parent-class-option" data-parent-class="${cls}">
          <span class="parent-class-name">${escapeHtml(PARENT_CLASS_LABELS[cls])}</span>
          <span class="parent-class-desc">${escapeHtml(PARENT_CLASS_DESCRIPTIONS[cls])}</span>
        </button>`,
      ).join("");
      overlay.innerHTML = `
        <div class="parent-class-dialog" role="dialog" aria-label="Pick Parent Class">
          <header class="parent-class-head">Pick Parent Class</header>
          <div class="parent-class-list">${options}</div>
          <footer class="parent-class-foot">
            <button type="button" class="parent-class-cancel" data-parent-cancel>Cancel</button>
          </footer>
        </div>
      `;
      document.body.append(overlay);
      const finish = (value: ParentClass | null): void => {
        cleanup();
        resolvePick(value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") finish(null);
      };
      const cleanup = (): void => {
        window.removeEventListener("keydown", onKey, true);
        overlay.remove();
      };
      window.addEventListener("keydown", onKey, true);
      overlay.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target === overlay || target.closest("[data-parent-cancel]")) {
          finish(null);
          return;
        }
        const option = target.closest<HTMLElement>("[data-parent-class]");
        if (option) finish(option.dataset.parentClass as ParentClass);
      });
    });
  }

  /**
   * Material creation starts with a small preset picker. The preset only seeds
   * the JSON defaults; the upcoming Material Editor remains free to change them.
   */
  private pickMaterialPreset(): Promise<ForgeMaterialPreset | null> {
    return new Promise((resolvePick) => {
      const overlay = document.createElement("div");
      overlay.className = "parent-class-overlay";
      const options = FORGE_MATERIAL_PRESETS.map(
        (preset) => `
        <button type="button" class="parent-class-option" data-material-preset="${preset}">
          <span class="parent-class-name">${escapeHtml(MATERIAL_PRESET_LABELS[preset])}</span>
          <span class="parent-class-desc">${escapeHtml(MATERIAL_PRESET_DESCRIPTIONS[preset])}</span>
        </button>`,
      ).join("");
      overlay.innerHTML = `
        <div class="parent-class-dialog" role="dialog" aria-label="Pick Material Preset">
          <header class="parent-class-head">Pick Material Preset</header>
          <div class="parent-class-list">${options}</div>
          <footer class="parent-class-foot">
            <button type="button" class="parent-class-cancel" data-material-preset-cancel>Cancel</button>
          </footer>
        </div>
      `;
      document.body.append(overlay);
      const finish = (value: ForgeMaterialPreset | null): void => {
        cleanup();
        resolvePick(value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") finish(null);
      };
      const cleanup = (): void => {
        window.removeEventListener("keydown", onKey, true);
        overlay.remove();
      };
      window.addEventListener("keydown", onKey, true);
      overlay.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target === overlay || target.closest("[data-material-preset-cancel]")) {
          finish(null);
          return;
        }
        const option = target.closest<HTMLElement>("[data-material-preset]");
        if (option) finish(option.dataset.materialPreset as ForgeMaterialPreset);
      });
    });
  }

  /**
   * Opens the Actor Script editor for a `*.actor.json` class-asset (Content
   * Browser double-click). Dynamically imported so its panels stay out of the
   * editor entry until a class is actually opened.
   */
  private async openActorScriptEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { ActorScriptEditor } = await import("@/editor/ActorScriptEditor");
      // Freshly scan project classes so a Game Mode's Default Pawn Class picker
      // lists the latest character/pawn Actor Scripts (incl. just-created ones).
      await this.refreshProjectActorClasses();
      const pawnClassRefs = this.projectActorClasses
        .filter((cls) => cls.parentClass === "character" || cls.parentClass === "pawn")
        .map((cls) => ({ path: cls.path, name: cls.name }));
      await ActorScriptEditor.open({
        path: item.path,
        label: item.label.replace(/\.actor\.json$/i, ""),
        behaviorScriptIds: BEHAVIOR_SCRIPT_IDS,
        assetIds: this.editableAssets.map((asset) => asset.id),
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        pawnClassRefs,
        onStatus: (message, tone) => this.setStatus(message, tone),
        onBrowse: () => void this.revealContentAsset(item.path),
        onPlay: () => void this.playTest(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Actor Script editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /** Lazily builds the hidden file input the Import flow reuses. */
  private ensureImportInput(): HTMLInputElement {
    if (this.importInput) return this.importInput;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept =
      ".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.basis,.hdr,.exr,.mp3,.wav,.ogg,.json";
    input.style.display = "none";
    input.addEventListener("change", () => void this.handleImportFiles());
    document.body.appendChild(input);
    this.importInput = input;
    return input;
  }

  /** Opens the OS file picker; selected files upload into `dir`. */
  private startImport(dir: string): void {
    this.importTargetDir = dir;
    const input = this.ensureImportInput();
    input.value = ""; // allow re-selecting the same file twice in a row
    input.click();
  }

  /** Uploads the picked files into the target folder, then refreshes the tree. */
  private async handleImportFiles(): Promise<void> {
    const files = Array.from(this.importInput?.files ?? []);
    if (files.length === 0) return;
    const dir = this.importTargetDir;
    let imported = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        await importProjectAsset(dir, file);
        imported += 1;
      } catch (error) {
        errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (errors.length === 0) {
      this.setStatus(`Imported ${imported} file${imported === 1 ? "" : "s"}`, "success");
    } else {
      const tone = imported === 0 ? "error" : "warning";
      this.setStatus(`Imported ${imported}/${files.length}. ${errors[0]}`, tone);
    }
    // The import endpoint registers each asset in the manifest; re-read it so the
    // new entries resolve as editable (clears the "loose file" badge).
    if (imported > 0) {
      try {
        this.editableAssets = await this.app.reloadEditableAssets();
      } catch {
        // Keep the stale list; the tree refresh below still shows the new file.
      }
    }
    await this.refreshAssetTree({ quiet: false });
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
    // Built-in modes plus discovered project `gameMode` Actor Scripts. Include the
    // current selection even if it is a not-yet-discovered class ref so it stays
    // selected (and round-trips) instead of silently resetting to the default.
    const modeOptions: GameModeOption[] = [...GAME_MODE_OPTIONS, ...this.projectGameModes];
    if (settings.gameMode && !modeOptions.some((option) => option.id === settings.gameMode)) {
      modeOptions.push({
        id: settings.gameMode,
        displayName: settings.gameMode,
        description: "Project Game Mode (Actor Script).",
      });
    }
    const gameModeOptions = modeOptions
      .map(
        (option) =>
          `<option value="${escapeHtml(option.id)}" ${
            option.id === settings.gameMode ? "selected" : ""
          }>${escapeHtml(option.displayName)}</option>`,
      )
      .join("");
    const gameModeDescription =
      modeOptions.find((option) => option.id === settings.gameMode)?.description ?? "";
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
    if (selection.kind === "sky" && selection.sky) {
      this.renderSkyDetails(selection);
      return;
    }
    if (selection.kind === "fog" && selection.fog) {
      this.renderFogDetails(selection);
      return;
    }
    if (selection.kind === "cloud" && selection.cloud) {
      this.renderCloudDetails(selection);
      return;
    }
    if (selection.kind === "post" && selection.post) {
      this.renderPostDetails(selection);
      return;
    }
    if (selection.kind === "reflectionPlane") {
      this.renderReflectionPlaneDetails(selection);
      return;
    }
    if (selection.kind === "reflectiveSurface" && selection.reflectiveSurface) {
      this.renderReflectiveSurfaceDetails(selection);
      return;
    }
    if (selection.kind === "reflectionCapture" && selection.reflectionCapture) {
      this.renderReflectionCaptureDetails(selection);
      return;
    }
    if (selection.kind === "worldWidget" && selection.worldWidget) {
      this.renderWorldWidgetDetails(selection);
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
          selection.category ? escapeHtml(selection.category) : "â€”"
        }</span>
      </div>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      ${pivotRow(selection.pivot, selection.locked, this.app.isPivotEditMode())}
      ${this.renderMaterialSection(selection)}
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
      ${this.renderComponentsSection(selection)}
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
    this.bindCollisionOverrideInputs(selection);

    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-material-slot]")
      ?.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        this.app.setSelectionMaterialSlot(value || undefined);
      });

    this.bindPhysicsInputs();
    this.bindComponentsInputs();
    this.bindMetadataInputs();
  }

  /**
   * Per-object Collision section. Mirrors Unreal's component-level collision:
   * the Collision toggle plus a preset override that defaults to the asset's
   * collision definition ("inherit") until the user picks one.
   */
  private renderMaterialSection(selection: EditableSelection): string {
    if (selection.kind !== "instance") return "";
    const materialAssets = this.editableAssets.filter((asset) => assetType(asset) === "material");
    const options = [`<option value="" ${selection.materialSlot ? "" : "selected"}>None</option>`]
      .concat(
        materialAssets.map(
          (asset) =>
            `<option value="${escapeHtml(asset.id)}" ${
              selection.materialSlot === asset.id ? "selected" : ""
            }>${escapeHtml(asset.displayName ?? asset.name)}</option>`,
        ),
      )
      .join("");
    return `
      <div class="detail-section">
        <div class="detail-section-title">Materials</div>
        <label class="detail-row">
          <span>Element 0</span>
          <select data-material-slot ${selection.locked ? "disabled" : ""}>${options}</select>
        </label>
      </div>
    `;
  }

  private renderCollisionSection(selection: EditableSelection): string {
    // Actor instances carry collision/physics on their class, not per-instance
    // (overrides are a deferred phase), so the instance Details stays transform-only.
    if (selection.kind === "actor") return "";
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
    const enabledOptions = [
      `<option value="" ${selection.collisionEnabled ? "" : "selected"}>Inherit (preset)</option>`,
    ]
      .concat(
        COLLISION_ENABLED_VALUES.map(
          (id) =>
            `<option value="${id}" ${
              selection.collisionEnabled === id ? "selected" : ""
            }>${COLLISION_ENABLED_LABELS[id]}</option>`,
        ),
      )
      .join("");
    const objectOptions = [
      `<option value="" ${selection.objectType ? "" : "selected"}>Inherit (preset)</option>`,
    ]
      .concat(
        COLLISION_OBJECT_CHANNELS.map(
          (id) =>
            `<option value="${id}" ${
              selection.objectType === id ? "selected" : ""
            }>${COLLISION_OBJECT_LABELS[id]}</option>`,
        ),
      )
      .join("");
    const physicalMaterialOptions = [
      `<option value="" ${selection.physicalMaterialId ? "" : "selected"}>Inherit (asset default)</option>`,
    ]
      .concat(
        PHYSICAL_MATERIAL_IDS.map(
          (id) =>
            `<option value="${id}" ${
              selection.physicalMaterialId === id ? "selected" : ""
            }>${id}</option>`,
        ),
      )
      .join("");
    const overlapValue =
      selection.generateOverlapEvents === undefined
        ? ""
        : selection.generateOverlapEvents
          ? "true"
          : "false";
    const hitValue =
      selection.simulationGeneratesHitEvents === undefined
        ? ""
        : selection.simulationGeneratesHitEvents
          ? "true"
          : "false";
    const eventOptions = (current: string): string =>
      [
        `<option value="" ${current === "" ? "selected" : ""}>Inherit (default on)</option>`,
        `<option value="true" ${current === "true" ? "selected" : ""}>Enabled</option>`,
        `<option value="false" ${current === "false" ? "selected" : ""}>Disabled</option>`,
      ].join("");
    const responseRows =
      selection.collisionPreset === "custom" || selection.responses
        ? COLLISION_CHANNELS.map((channel) => {
            const value = selection.responses?.[channel] ?? "";
            const options = [`<option value="" ${value ? "" : "selected"}>Inherit</option>`]
              .concat(
                COLLISION_RESPONSE_VALUES.map(
                  (response) =>
                    `<option value="${response}" ${
                      value === response ? "selected" : ""
                    }>${COLLISION_RESPONSE_LABELS[response]}</option>`,
                ),
              )
              .join("");
            return `
              <label class="detail-row">
                <span>${COLLISION_CHANNEL_LABELS[channel]}</span>
                <select data-collision-response="${channel}">${options}</select>
              </label>
            `;
          }).join("")
        : "";
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
        <label class="detail-row">
          <span>Collision Enabled</span>
          <select data-collision-enabled>${enabledOptions}</select>
        </label>
        <label class="detail-row">
          <span>Object Type</span>
          <select data-collision-object-type>${objectOptions}</select>
        </label>
        <label class="detail-row">
          <span>Phys Material Override</span>
          <select data-collision-physical-material>${physicalMaterialOptions}</select>
        </label>
        <label class="detail-row">
          <span>Generate Overlap Events</span>
          <select data-collision-overlap-events>${eventOptions(overlapValue)}</select>
        </label>
        <label class="detail-row">
          <span>Simulation Generates Hit Events</span>
          <select data-collision-hit-events>${eventOptions(hitValue)}</select>
        </label>
        ${responseRows}
      </div>
    `;
  }

  private bindCollisionOverrideInputs(selection: EditableSelection): void {
    if (selection.kind === "actor") return;
    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-collision-enabled]")
      ?.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        this.app.setSelectionCollisionOverrides({
          collisionEnabled: value ? (value as CollisionEnabled) : undefined,
        });
      });
    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-collision-object-type]")
      ?.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        this.app.setSelectionCollisionOverrides({
          objectType: value ? (value as CollisionObjectChannel) : undefined,
        });
      });
    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-collision-physical-material]")
      ?.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        this.app.setSelectionCollisionOverrides({
          physicalMaterialId: value || undefined,
        });
      });
    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-collision-overlap-events]")
      ?.addEventListener("change", (event) => {
        this.app.setSelectionCollisionOverrides({
          generateOverlapEvents: parseOptionalBoolean((event.target as HTMLSelectElement).value),
        });
      });
    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-collision-hit-events]")
      ?.addEventListener("change", (event) => {
        this.app.setSelectionCollisionOverrides({
          simulationGeneratesHitEvents: parseOptionalBoolean(
            (event.target as HTMLSelectElement).value,
          ),
        });
      });
    this.detailsBody
      .querySelectorAll<HTMLSelectElement>("[data-collision-response]")
      .forEach((select) => {
        select.addEventListener("change", () => {
          const channel = select.dataset.collisionResponse as CollisionChannel | undefined;
          if (!channel) return;
          const next: CollisionResponseMap = { ...(this.selected?.responses ?? selection.responses) };
          const value = select.value as CollisionResponse | "";
          if (value) next[channel] = value;
          else delete next[channel];
          this.app.setSelectionCollisionOverrides({
            responses: Object.keys(next).length > 0 ? next : undefined,
          });
        });
      });
  }

  private renderPhysicsSection(selection: EditableSelection, locked: boolean): string {
    if (selection.kind === "actor") return "";
    const physics = selection.physics;
    const disabled = locked ? "disabled" : "";
    const linearDamping = physics.linearDamping ?? DEFAULT_LINEAR_DAMPING;
    const angularDamping = physics.angularDamping ?? DEFAULT_ANGULAR_DAMPING;
    const enableGravity = physics.enableGravity ?? true;
    const lockPosition = physics.lockPosition ?? [false, false, false];
    const lockRotation = physics.lockRotation ?? [false, false, false];
    // `complexAsSimple` collision uses the render mesh as a static trimesh, which
    // Rapier can't drive dynamically — so Simulate Physics is unavailable and
    // forced off for these assets (the runtime ignores the flag regardless).
    const complexAsSimple =
      this.app.assetCollisionComplexity(selection.assetId) === "complexAsSimple";
    const simulateDisabled = locked || complexAsSimple ? "disabled" : "";

    return `
      <div class="detail-section detail-physics-section">
        <div class="detail-section-title">Physics</div>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="simulatePhysics" ${
            selection.simulatePhysics && !complexAsSimple ? "checked" : ""
          } ${simulateDisabled} />
          <span>Simulate Physics</span>
        </label>
        ${
          complexAsSimple
            ? `<div class="detail-hint detail-hint-warning">Static-only: this asset uses “Use Complex Collision As Simple” collision.</div>`
            : ""
        }
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
   * Optional-component editor (Â§3): each present component (Audio/Behavior/
   * Particle/Interaction) renders as a card with editable fields + Remove, and a
   * single "Add Component" menu lists the absent ones. Add/Remove/edit each route
   * through a `setSelection*` command, so all are single undo/redo steps. The
   * required Transform component is not listed here (it cannot be removed).
   */
  private renderComponentsSection(selection: EditableSelection): string {
    if (selection.kind === "actor") return "";
    const cards: string[] = [];
    if (selection.audio) cards.push(this.componentCard("audio", this.renderAudioFields(selection.audio)));
    if (selection.behavior) {
      cards.push(this.componentCard("behavior", this.renderBehaviorFields(selection.behavior)));
    }
    if (selection.particle) {
      cards.push(this.componentCard("particle", this.renderParticleFields(selection.particle)));
    }
    if (selection.interaction) {
      cards.push(this.componentCard("interaction", this.renderInteractionFields(selection.interaction)));
    }

    const absent = ADDABLE_COMPONENTS.filter((kind) => !selection[kind]);
    const addMenu =
      absent.length === 0
        ? ""
        : `
      <div class="detail-section">
        <label class="detail-row">
          <span>Add Component</span>
          <select data-add-component>
            <option value="">Addâ€¦</option>
            ${absent.map((kind) => `<option value="${kind}">${COMPONENT_LABELS[kind]}</option>`).join("")}
          </select>
        </label>
      </div>`;
    return cards.join("") + addMenu;
  }

  private componentCard(kind: AddableComponent, fields: string): string {
    return `
      <div class="detail-section">
        <div class="detail-section-title detail-component-title">
          <span>${COMPONENT_LABELS[kind]}</span>
          <button type="button" data-remove-component="${kind}"
            title="Remove the ${COMPONENT_LABELS[kind]} component">Remove</button>
        </div>
        ${fields}
      </div>`;
  }

  private renderAudioFields(audio: LayoutAudio): string {
    const sounds = this.editableAssets.filter((asset) => assetType(asset) === "sound");
    const inList = sounds.some((asset) => asset.id === audio.clipId);
    // Preserve the current clip as an option even if it is not a manifest sound
    // asset (e.g. a built-in tone like "collision-chime") so it is not lost.
    const preserved = inList
      ? ""
      : `<option value="${escapeHtml(audio.clipId)}" selected>${escapeHtml(audio.clipId)}</option>`;
    const options =
      preserved +
      sounds
        .map(
          (asset) =>
            `<option value="${escapeHtml(asset.id)}" ${
              asset.id === audio.clipId ? "selected" : ""
            }>${escapeHtml(asset.displayName)}</option>`,
        )
        .join("");
    return `
      <label class="detail-row">
        <span>Clip</span>
        <select data-audio="clipId">${options}</select>
      </label>
      <label class="detail-row">
        <span>Volume</span>
        <input type="number" data-audio="volume" min="0" max="1" step="0.05"
          value="${audio.volume ?? ""}" placeholder="1" />
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-audio="autoPlay" ${audio.autoPlay ? "checked" : ""} />
        <span>Auto Play</span>
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-audio="loop" ${audio.loop ? "checked" : ""} />
        <span>Loop</span>
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-audio="spatial" ${audio.spatial ? "checked" : ""} />
        <span>Spatial</span>
      </label>`;
  }

  private renderBehaviorFields(behavior: LayoutBehavior): string {
    const paramCount = behavior.params ? Object.keys(behavior.params).length : 0;
    const paramsHint =
      paramCount > 0
        ? `<div class="detail-hint">params authored (${paramCount}); edit in layout JSON</div>`
        : "";
    return `
      <label class="detail-row">
        <span>Script</span>
        <input type="text" data-behavior="script" value="${escapeHtml(behavior.script)}"
          placeholder="${DEFAULT_BEHAVIOR_SCRIPT}" />
      </label>
      ${paramsHint}`;
  }

  /**
   * Particle component editor: a reference to a pre-authored effect asset
   * (`.effect.json`) chosen from a dropdown, plus Auto Play. Emitter settings
   * (rate/lifetime/size/velocity/material/color) live in the effect asset, not
   * inline on the component â€” adding the component references an effect, it does
   * not author a new particle system.
   */
  private renderParticleFields(particle: LayoutParticleEmitter): string {
    const effects = this.editableAssets.filter((asset) => assetPath(asset).endsWith(".effect.json"));
    const inList = effects.some((asset) => asset.id === particle.effectId);
    // Preserve the current effect id as an option even if it is not (yet) a
    // known effect asset, so the reference is never silently lost.
    const preserved = inList
      ? ""
      : `<option value="${escapeHtml(particle.effectId)}" selected>${escapeHtml(particle.effectId)}</option>`;
    const options =
      preserved +
      effects
        .map(
          (asset) =>
            `<option value="${escapeHtml(asset.id)}" ${
              asset.id === particle.effectId ? "selected" : ""
            }>${escapeHtml(asset.displayName)}</option>`,
        )
        .join("");
    return `
      <label class="detail-row">
        <span>Effect</span>
        <select data-particle="effectId">${options}</select>
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-particle="autoPlay" ${particle.autoPlay ? "checked" : ""} />
        <span>Auto Play</span>
      </label>
      <div class="detail-hint">Emitter settings live in the effect asset (.effect.json).</div>`;
  }

  private renderInteractionFields(interaction: LayoutInteraction): string {
    return `
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
      </label>`;
  }

  private bindComponentsInputs(): void {
    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-add-component]")
      ?.addEventListener("change", (event) => {
        const kind = (event.currentTarget as HTMLSelectElement).value;
        if (kind) this.addComponent(kind as AddableComponent);
      });
    this.detailsBody
      .querySelectorAll<HTMLButtonElement>("[data-remove-component]")
      .forEach((button) => {
        button.addEventListener("click", () =>
          this.removeComponent(button.dataset.removeComponent as AddableComponent),
        );
      });
    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-audio]")
      .forEach((input) => input.addEventListener("change", () => this.commitAudioInput()));
    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-behavior]")
      .forEach((input) => input.addEventListener("change", () => this.commitBehaviorInput()));
    this.detailsBody
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-particle]")
      .forEach((input) => input.addEventListener("change", () => this.commitParticleInput()));
    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-interaction]")
      .forEach((input) => input.addEventListener("change", () => this.commitInteractionInput()));
  }

  /** Adds a component with sensible defaults (a single undo/redo command). */
  private addComponent(kind: AddableComponent): void {
    if (kind === "audio") {
      // Seed with the first manifest sound (if any) so it is audible on Play.
      const firstSound = this.editableAssets.find((asset) => assetType(asset) === "sound");
      this.app.setSelectionAudio({ clipId: firstSound?.id ?? DEFAULT_AUDIO_CLIP, autoPlay: true });
    } else if (kind === "behavior") this.app.setSelectionBehavior({ script: DEFAULT_BEHAVIOR_SCRIPT });
    else if (kind === "particle") {
      // Seed with the first effect asset (if any) + autoPlay so it is visible on Play.
      const firstEffect = this.editableAssets.find((asset) =>
        assetPath(asset).endsWith(".effect.json"),
      );
      this.app.setSelectionParticle({
        effectId: firstEffect?.id ?? DEFAULT_PARTICLE_EFFECT,
        autoPlay: true,
      });
    } else this.app.setSelectionInteraction({ action: "interact" });
  }

  private removeComponent(kind: AddableComponent): void {
    if (kind === "audio") this.app.setSelectionAudio(undefined);
    else if (kind === "behavior") this.app.setSelectionBehavior(undefined);
    else if (kind === "particle") this.app.setSelectionParticle(undefined);
    else this.app.setSelectionInteraction(undefined);
  }

  private commitAudioInput(): void {
    const clip = this.detailsBody.querySelector<HTMLSelectElement | HTMLInputElement>(
      '[data-audio="clipId"]',
    );
    const clipId = clip?.value.trim();
    if (!clipId) return;
    const audio: LayoutAudio = { clipId };
    const volumeRaw = this.detailsBody
      .querySelector<HTMLInputElement>('[data-audio="volume"]')
      ?.value.trim();
    if (volumeRaw) {
      const volume = Number(volumeRaw);
      if (Number.isFinite(volume) && volume >= 0 && volume <= 1) audio.volume = volume;
    }
    if (this.detailsBody.querySelector<HTMLInputElement>('[data-audio="autoPlay"]')?.checked) {
      audio.autoPlay = true;
    }
    if (this.detailsBody.querySelector<HTMLInputElement>('[data-audio="loop"]')?.checked) {
      audio.loop = true;
    }
    if (this.detailsBody.querySelector<HTMLInputElement>('[data-audio="spatial"]')?.checked) {
      audio.spatial = true;
    }
    this.app.setSelectionAudio(audio);
  }

  private commitBehaviorInput(): void {
    const scriptInput = this.detailsBody.querySelector<HTMLInputElement>('[data-behavior="script"]');
    if (!scriptInput) return;
    const behavior: LayoutBehavior = { script: scriptInput.value.trim() || DEFAULT_BEHAVIOR_SCRIPT };
    const params = this.selected?.behavior?.params;
    if (params && Object.keys(params).length > 0) behavior.params = { ...params };
    this.app.setSelectionBehavior(behavior);
  }

  /**
   * Commits the Particle component as a reference to an effect asset + Auto Play.
   * Any previously-authored inline emitter fields are preserved (spread) but no
   * longer edited here â€” the effect asset is the source of truth.
   */
  private commitParticleInput(): void {
    const effect = this.detailsBody.querySelector<HTMLSelectElement | HTMLInputElement>(
      '[data-particle="effectId"]',
    );
    const effectId = effect?.value.trim();
    if (!effectId) return;
    const base: LayoutParticleEmitter = { ...(this.selected?.particle ?? { effectId }) };
    base.effectId = effectId;
    if (this.detailsBody.querySelector<HTMLInputElement>('[data-particle="autoPlay"]')?.checked) {
      base.autoPlay = true;
    } else {
      delete base.autoPlay;
    }
    this.app.setSelectionParticle(base);
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
    // Environment singletons + reflection planes + world widgets carry no
    // schema-driven metadata.
    if (
      selection.kind === "sky" ||
      selection.kind === "fog" ||
      selection.kind === "cloud" ||
      selection.kind === "reflectionPlane" ||
      selection.kind === "reflectiveSurface" ||
      selection.kind === "reflectionCapture" ||
      selection.kind === "worldWidget" ||
      selection.kind === "post"
    ) {
      return "";
    }
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
      const options = [`<option value="">â€”</option>`]
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
    if (
      !this.selected ||
      this.selected.kind === "sky" ||
      this.selected.kind === "fog" ||
      this.selected.kind === "cloud" ||
      this.selected.kind === "reflectionPlane" ||
      this.selected.kind === "reflectiveSurface" ||
      this.selected.kind === "reflectionCapture" ||
      this.selected.kind === "worldWidget" ||
      this.selected.kind === "post"
    ) {
      return null;
    }
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

  /**
   * Details panel for a placed Planar Reflection (mirror) actor: a full transform
   * (location/rotation/scale) plus a Reflection section for the mirror tint and
   * render-target resolution. The reflective face is the plane's local +Z.
   */
  private renderReflectionPlaneDetails(selection: EditableSelection): void {
    this.detailsScale = [...selection.scale];
    const lockedAttr = selection.locked ? "disabled" : "";
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>reflection / planar mirror</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Mirror Plane" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Reflection</div>
        <label class="detail-row">
          <span>Tint</span>
          <input data-reflection-plane-color type="color"
            value="${escapeHtml(selection.color ?? "#888888")}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Resolution</span>
          <select data-reflection-plane-resolution ${lockedAttr}>
            ${[128, 256, 512, 1024, 2048]
              .map(
                (res) =>
                  `<option value="${res}" ${
                    (selection.reflectionResolution ?? 512) === res ? "selected" : ""
                  }>${res}px</option>`,
              )
              .join("")}
          </select>
        </label>
        <div class="detail-hint">Higher resolution = sharper mirror, more GPU cost.</div>
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

    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-detail-name]");
    nameInput?.addEventListener("change", () => {
      this.app.renameSceneObject(selection.id, nameInput.value);
    });

    this.detailsBody
      .querySelector<HTMLInputElement>("[data-reflection-plane-color]")
      ?.addEventListener("change", (event) => {
        this.app.setSelectedReflectionPlane({
          color: (event.currentTarget as HTMLInputElement).value,
        });
      });

    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-reflection-plane-resolution]")
      ?.addEventListener("change", (event) => {
        const value = Number((event.currentTarget as HTMLSelectElement).value);
        if (!Number.isFinite(value)) return;
        this.app.setSelectedReflectionPlane({ resolution: value });
      });

    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-detail-toggle]")
      .forEach((toggle) => {
        toggle.addEventListener("change", () =>
          this.handleDetailToggle(toggle.dataset.detailToggle ?? "", toggle.checked),
        );
      });
  }

  /**
   * Details panel for a placed Reflective Surface actor: a full transform plus a
   * Material picker (Forge `.material.json` → albedo/normal/roughness) and a
   * Reflection section blending the planar reflection into that material (strength /
   * fresnel / distortion / tint / resolution). The reflective face is local +Z.
   */
  private renderReflectiveSurfaceDetails(selection: EditableSelection): void {
    const surface = selection.reflectiveSurface;
    if (!surface) return;
    this.detailsScale = [...selection.scale];
    const lockedAttr = selection.locked ? "disabled" : "";
    const materialAssets = this.editableAssets.filter((asset) => assetType(asset) === "material");
    const materialOptions = [
      `<option value="" ${surface.material ? "" : "selected"}>Default (glossy)</option>`,
    ]
      .concat(
        materialAssets.map(
          (asset) =>
            `<option value="${escapeHtml(asset.id)}" ${
              surface.material === asset.id ? "selected" : ""
            }>${escapeHtml(asset.displayName ?? asset.name)}</option>`,
        ),
      )
      .join("");
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>reflection / reflective surface</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Reflective Surface" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Material</div>
        <label class="detail-row">
          <span>Surface</span>
          <select data-surface-material ${lockedAttr}>${materialOptions}</select>
        </label>
        <div class="detail-hint">Albedo + normal map + roughness come from this material (asphalt, marble, …).</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Reflection</div>
        <label class="detail-row">
          <span>Strength</span>
          <input data-surface-field="reflectionStrength" type="number" min="0" max="1" step="0.05"
            value="${surface.reflectionStrength}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Fresnel Power</span>
          <input data-surface-field="fresnelPower" type="number" min="0" max="16" step="0.5"
            value="${surface.fresnelPower}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Fresnel Bias</span>
          <input data-surface-field="fresnelBias" type="number" min="0" max="1" step="0.02"
            value="${surface.fresnelBias}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Distortion</span>
          <input data-surface-field="distortion" type="number" min="0" max="1" step="0.01"
            value="${surface.distortion}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Tint</span>
          <input data-surface-tint type="color" value="${escapeHtml(surface.tint)}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Resolution</span>
          <select data-surface-field="resolution" ${lockedAttr}>
            ${[128, 256, 512, 1024, 2048]
              .map(
                (res) =>
                  `<option value="${res}" ${
                    surface.resolution === res ? "selected" : ""
                  }>${res}px</option>`,
              )
              .join("")}
          </select>
        </label>
        <div class="detail-hint">Lower roughness + higher strength = sharper reflection; fresnel concentrates it at grazing angles.</div>
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

    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-detail-name]");
    nameInput?.addEventListener("change", () => {
      this.app.renameSceneObject(selection.id, nameInput.value);
    });

    this.detailsBody
      .querySelector<HTMLSelectElement>("[data-surface-material]")
      ?.addEventListener("change", (event) => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        this.app.setSelectedReflectiveSurface({ material: value || null });
      });

    this.detailsBody
      .querySelector<HTMLInputElement>("[data-surface-tint]")
      ?.addEventListener("change", (event) => {
        this.app.setSelectedReflectiveSurface({
          tint: (event.currentTarget as HTMLInputElement).value,
        });
      });

    this.detailsBody
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-surface-field]")
      .forEach((field) => {
        field.addEventListener("change", () => {
          const key = field.dataset.surfaceField as SurfaceNumericKey | undefined;
          if (!key) return;
          const value = Number(field.value);
          if (!Number.isFinite(value)) return;
          const patch: Partial<Record<SurfaceNumericKey, number>> = {};
          patch[key] = value;
          this.app.setSelectedReflectiveSurface(patch);
        });
      });

    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-detail-toggle]")
      .forEach((toggle) => {
        toggle.addEventListener("change", () =>
          this.handleDetailToggle(toggle.dataset.detailToggle ?? "", toggle.checked),
        );
      });
  }

  /**
   * Details panel for a placed Sphere Reflection Capture (probe) actor: a Location
   * transform plus a Reflection Capture section for the probe radius / resolution /
   * intensity / near-far / priority / parallax. There is no rotation or scale â€” the
   * influence size is the radius.
   */
  /** First `*.ui.json` widget asset id (for a new World Widget), or "" when none. */
  private firstUiWidgetAssetId(): string {
    const widget = this.editableAssets.find(
      (asset) => assetType(asset) === "ui" && assetPath(asset).toLowerCase().endsWith(".ui.json"),
    );
    return widget?.id ?? "";
  }

  /** Reads three numbered `[data-<attr>="0|1|2"]` inputs into a Vec3 (fallback per axis). */
  private readWorldWidgetVec(attr: string, fallback: Vec3): Vec3 {
    const vec: Vec3 = [fallback[0], fallback[1], fallback[2]];
    for (let i = 0; i < 3; i += 1) {
      const input = this.detailsBody.querySelector<HTMLInputElement>(`[data-${attr}="${i}"]`);
      if (input) {
        const value = Number(input.value);
        if (Number.isFinite(value)) vec[i] = value;
      }
    }
    return vec;
  }

  /** Reads the two `[data-ww-off="0|1"]` screen-offset inputs into an `[x, y]` pair. */
  private readWorldWidgetOffset(fallback: [number, number]): [number, number] {
    const out: [number, number] = [fallback[0], fallback[1]];
    for (let i = 0; i < 2; i += 1) {
      const input = this.detailsBody.querySelector<HTMLInputElement>(`[data-ww-off="${i}"]`);
      if (input) {
        const value = Number(input.value);
        if (Number.isFinite(value)) out[i] = value;
      }
    }
    return out;
  }

  /**
   * Details panel for a placed world-space UI widget. Numeric fields write through
   * {@link SceneApp.setSelectedWorldWidget} (no transform gizmo in v1 — the anchor
   * world point is edited here and shown by the viewport marker).
   */
  private renderWorldWidgetDetails(selection: EditableSelection): void {
    const widget = selection.worldWidget;
    if (!widget) return;
    this.detailsScale = [...selection.scale];
    const p = selection.position;
    const o3 = widget.offset3d;
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>ui / world widget</span>
      </div>
      <label class="detail-row">
        <span>Widget</span>
        <input data-ww-field="widget" type="text" value="${escapeHtml(widget.widget)}"
          placeholder="ui asset id (e.g. world-label)" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Anchor</div>
        <label class="detail-row"><span>World X</span>
          <input data-ww-pos="0" type="number" step="0.1" value="${p[0]}" /></label>
        <label class="detail-row"><span>World Y</span>
          <input data-ww-pos="1" type="number" step="0.1" value="${p[1]}" /></label>
        <label class="detail-row"><span>World Z</span>
          <input data-ww-pos="2" type="number" step="0.1" value="${p[2]}" /></label>
        <label class="detail-row"><span>Entity Id</span>
          <input data-ww-field="entityId" type="text" value="${escapeHtml(widget.entityId)}"
            placeholder="actor:0 (optional, tracks entity)" /></label>
        <label class="detail-row"><span>Offset X</span>
          <input data-ww-off3="0" type="number" step="0.1" value="${o3[0]}" /></label>
        <label class="detail-row"><span>Offset Y</span>
          <input data-ww-off3="1" type="number" step="0.1" value="${o3[1]}" /></label>
        <label class="detail-row"><span>Offset Z</span>
          <input data-ww-off3="2" type="number" step="0.1" value="${o3[2]}" /></label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Screen</div>
        <label class="detail-row"><span>Offset X (px)</span>
          <input data-ww-off="0" type="number" step="1" value="${widget.offset[0]}" /></label>
        <label class="detail-row"><span>Offset Y (px)</span>
          <input data-ww-off="1" type="number" step="1" value="${widget.offset[1]}" /></label>
        <label class="detail-row"><span>Max Distance</span>
          <input data-ww-field="maxDistance" type="number" min="0" step="1"
            value="${widget.maxDistance}" /></label>
      </div>
      <div class="detail-hint">World-space billboard. Anchor by a world point or an entity id; offsets nudge it. Position is edited numerically here (no gizmo yet).</div>
    `;

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-ww-field]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.wwField;
        if (key === "widget") this.app.setSelectedWorldWidget({ widget: input.value.trim() });
        else if (key === "entityId") this.app.setSelectedWorldWidget({ entityId: input.value.trim() });
        else if (key === "maxDistance") {
          const value = Number(input.value);
          this.app.setSelectedWorldWidget({ maxDistance: Number.isFinite(value) ? value : 0 });
        }
      });
    });

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-ww-pos]").forEach((input) => {
      input.addEventListener("change", () =>
        this.app.setSelectedWorldWidget({ worldPos: this.readWorldWidgetVec("ww-pos", selection.position) }),
      );
    });
    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-ww-off3]").forEach((input) => {
      input.addEventListener("change", () =>
        this.app.setSelectedWorldWidget({ offset3d: this.readWorldWidgetVec("ww-off3", widget.offset3d) }),
      );
    });
    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-ww-off]").forEach((input) => {
      input.addEventListener("change", () =>
        this.app.setSelectedWorldWidget({ offset: this.readWorldWidgetOffset(widget.offset) }),
      );
    });
  }

  private renderReflectionCaptureDetails(selection: EditableSelection): void {
    const capture = selection.reflectionCapture;
    if (!capture) return;
    this.detailsScale = [...selection.scale];
    const lockedAttr = selection.locked ? "disabled" : "";
    const resolutions = [64, 128, 256, 512, 1024];
    // Stale = cached cubemap no longer matches the probe (moved / near-far edited);
    // the helper turns amber and we surface a Recapture prompt here.
    const bakeStale = this.app.isSelectedReflectionCaptureBakeStale();
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>reflection / sphere capture</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Sphere Reflection Capture" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Reflection Capture</div>
        <label class="detail-row">
          <span>Radius</span>
          <input data-capture-field="radius" type="number" min="0.1" step="0.1"
            value="${capture.radius}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Resolution</span>
          <select data-capture-field="resolution" ${lockedAttr}>
            ${resolutions
              .map(
                (res) =>
                  `<option value="${res}" ${
                    capture.resolution === res ? "selected" : ""
                  }>${res}px</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-capture-field="intensity" type="number" min="0" max="4" step="0.05"
            value="${capture.intensity}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Near</span>
          <input data-capture-field="near" type="number" min="0.001" step="0.1"
            value="${capture.near}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Far</span>
          <input data-capture-field="far" type="number" min="0.1" step="1"
            value="${capture.far}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Priority</span>
          <input data-capture-field="priority" type="number" step="1"
            value="${capture.priority}" ${lockedAttr} />
        </label>
        <label class="detail-toggle">
          <input type="checkbox" data-capture-field="parallax"
            ${capture.parallax ? "checked" : ""} ${lockedAttr} />
          <span>Parallax Correction</span>
        </label>
        ${
          bakeStale
            ? `<div class="detail-hint detail-hint-warning">âš  Bake is stale â€” the probe moved or near/far changed since capture. Press Recapture.</div>`
            : ""
        }
        <button type="button" data-capture-recapture class="detail-button${
          bakeStale ? " detail-button-warning" : ""
        }">Recapture</button>
        <button type="button" data-capture-recapture-all class="detail-button">Recapture All</button>
        <div class="detail-hint">Static capture: bakes a cubemap from this point â€” press Recapture after moving the probe or scene.</div>
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

    this.detailsBody
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-capture-field]")
      .forEach((field) => {
        field.addEventListener("change", () => {
          const key = field.dataset.captureField as CaptureNumericKey | "parallax" | undefined;
          if (!key) return;
          // Parallax is a boolean checkbox; the rest are numeric inputs/selects.
          if (key === "parallax") {
            this.app.setSelectedReflectionCapture({ parallax: (field as HTMLInputElement).checked });
            return;
          }
          const value = Number(field.value);
          if (!Number.isFinite(value)) return;
          const patch: Partial<Record<CaptureNumericKey, number>> = {};
          patch[key] = value;
          this.app.setSelectedReflectionCapture(patch);
        });
      });

    this.detailsBody
      .querySelector<HTMLButtonElement>("[data-capture-recapture]")
      ?.addEventListener("click", () => {
        this.app.recaptureSelectedReflectionCapture();
      });

    this.detailsBody
      .querySelector<HTMLButtonElement>("[data-capture-recapture-all]")
      ?.addEventListener("click", () => {
        this.app.recaptureAllReflectionCaptures();
      });

    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-detail-toggle]")
      .forEach((toggle) => {
        toggle.addEventListener("change", () =>
          this.handleDetailToggle(toggle.dataset.detailToggle ?? "", toggle.checked),
        );
      });
  }

  /**
   * Details panel for the singleton Sky Atmosphere. The sun direction is
   * controlled by rotating the scene's Directional Sun light, so it is
   * intentionally absent here. The global PBR sky-light capture is owned here
   * instead of a separate Reflection Environment actor.
   */
  private renderSkyDetails(selection: EditableSelection): void {
    const sky = selection.sky;
    if (!sky) return;
    this.detailsScale = [1, 1, 1];
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / sky atmosphere</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-sky-name type="text" value="${escapeHtml(sky.name)}" placeholder="Sky Atmosphere" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Atmosphere</div>
        <label class="detail-row">
          <span>Rayleigh</span>
          <input data-sky-number="rayleigh" type="number" step="0.1" min="0" max="6"
            value="${sky.rayleigh}" />
        </label>
        <label class="detail-row">
          <span>Turbidity</span>
          <input data-sky-number="turbidity" type="number" step="0.5" min="1" max="20"
            value="${sky.turbidity}" />
        </label>
        <label class="detail-row">
          <span>Mie</span>
          <input data-sky-number="mie" type="number" step="0.001" min="0" max="0.1"
            value="${sky.mie}" />
        </label>
        <label class="detail-row">
          <span>Mie Anisotropy</span>
          <input data-sky-number="mieDirectionalG" type="number" step="0.01" min="0" max="0.999"
            value="${sky.mieDirectionalG}" />
        </label>
        <label class="detail-row">
          <span>Exposure</span>
          <input data-sky-number="exposure" type="number" step="0.05" min="0" max="4"
            value="${sky.exposure}" />
        </label>
        <div class="detail-hint">Sun direction is set by rotating the Directional Sun light.</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Sky Light Capture</div>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-sky-capture-intensity type="number" step="0.05" min="0" max="4"
            value="${sky.skyLightCapture.intensity}" />
        </label>
        <button type="button" data-sky-recapture class="detail-button">Recapture from Sky</button>
        <div class="detail-hint">Fallback PBR reflection used where no Sphere Reflection Capture applies.</div>
      </div>
    `;

    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-sky-name]");
    nameInput?.addEventListener("change", () => {
      const value = nameInput.value.trim();
      this.app.setSkyAtmosphere(
        { name: value.length > 0 ? value : undefined },
        "Rename Sky Atmosphere",
      );
    });

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-sky-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.skyNumber as keyof LayoutSkyAtmosphere | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setSkyAtmosphere(
          { [key]: value } as Partial<LayoutSkyAtmosphere>,
          "Edit Sky Atmosphere",
        );
      });
    });

    this.detailsBody
      .querySelector<HTMLInputElement>("[data-sky-capture-intensity]")
      ?.addEventListener("change", (event) => {
        const value = Number((event.currentTarget as HTMLInputElement).value);
        if (!Number.isFinite(value)) return;
        this.app.setSkyAtmosphere(
          { skyLightCapture: { intensity: value } },
          "Edit Sky Light Capture",
        );
      });

    this.detailsBody
      .querySelector<HTMLButtonElement>("[data-sky-recapture]")
      ?.addEventListener("click", () => {
        this.app.recaptureSkyLightCapture();
      });
  }

  /**
   * Details panel for the singleton Exponential Height Fog (distance-based, Faz 1).
   * `exp` mode shows Density (FogExp2); `linear` mode shows Start/End (Fog). The
   * panel re-renders after each edit, so the mode-specific fields swap live.
   */
  private renderFogDetails(selection: EditableSelection): void {
    const fog = selection.fog;
    if (!fog) return;
    this.detailsScale = [1, 1, 1];
    const densityRow = `
      <label class="detail-row">
        <span>Density</span>
        <input data-fog-number="density" type="number" step="0.005" min="0" max="2"
          value="${fog.density}" />
      </label>`;
    const linearRows = `
      <label class="detail-row">
        <span>Start</span>
        <input data-fog-number="start" type="number" step="1" min="0"
          value="${fog.start}" />
      </label>
      <label class="detail-row">
        <span>End</span>
        <input data-fog-number="end" type="number" step="1" min="0"
          value="${fog.end}" />
      </label>`;
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / exponential height fog</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-fog-name type="text" value="${escapeHtml(fog.name)}" placeholder="Exponential Height Fog" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Fog</div>
        <label class="detail-row">
          <span>Mode</span>
          <select data-fog-mode>
            <option value="exp" ${fog.mode === "exp" ? "selected" : ""}>Exponential (FogExp2)</option>
            <option value="linear" ${fog.mode === "linear" ? "selected" : ""}>Linear (near/far)</option>
          </select>
        </label>
        <label class="detail-row">
          <span>Color</span>
          <input data-fog-color type="color" value="${escapeHtml(fog.color)}" />
        </label>
        ${fog.mode === "linear" ? linearRows : densityRow}
        <div class="detail-hint">Distance-based scene fog. Height falloff is a later phase.</div>
      </div>
    `;

    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-fog-name]");
    nameInput?.addEventListener("change", () => {
      const value = nameInput.value.trim();
      this.app.setHeightFog(
        { name: value.length > 0 ? value : undefined },
        "Rename Exponential Height Fog",
      );
    });

    this.detailsBody.querySelector<HTMLSelectElement>("[data-fog-mode]")?.addEventListener(
      "change",
      (event) => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        if (value !== "exp" && value !== "linear") return;
        this.app.setHeightFog({ mode: value }, "Edit Exponential Height Fog");
      },
    );

    this.detailsBody.querySelector<HTMLInputElement>("[data-fog-color]")?.addEventListener(
      "change",
      (event) => {
        const value = (event.currentTarget as HTMLInputElement).value;
        this.app.setHeightFog({ color: value }, "Edit Exponential Height Fog");
      },
    );

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-fog-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.fogNumber as keyof LayoutHeightFog | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setHeightFog(
          { [key]: value } as Partial<LayoutHeightFog>,
          "Edit Exponential Height Fog",
        );
      });
    });
  }

  /**
   * Details panel for the singleton static Cloud Layer (procedural cloud dome).
   * Coverage/density/softness/scale paint the noise; Wind drives the optional
   * drift (0 = static). Not volumetric â€” a flat camera-following dome backdrop.
   */
  private renderCloudDetails(selection: EditableSelection): void {
    const cloud = selection.cloud;
    if (!cloud) return;
    this.detailsScale = [1, 1, 1];
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / cloud layer</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-cloud-name type="text" value="${escapeHtml(cloud.name)}" placeholder="Cloud Layer" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Clouds</div>
        <label class="detail-row">
          <span>Color</span>
          <input data-cloud-color type="color" value="${escapeHtml(cloud.color)}" />
        </label>
        <label class="detail-row">
          <span>Coverage</span>
          <input data-cloud-number="coverage" type="number" step="0.05" min="0" max="1"
            value="${cloud.coverage}" />
        </label>
        <label class="detail-row">
          <span>Density</span>
          <input data-cloud-number="density" type="number" step="0.05" min="0" max="1"
            value="${cloud.density}" />
        </label>
        <label class="detail-row">
          <span>Softness</span>
          <input data-cloud-number="softness" type="number" step="0.05" min="0" max="1"
            value="${cloud.softness}" />
        </label>
        <label class="detail-row">
          <span>Scale</span>
          <input data-cloud-number="scale" type="number" step="0.25" min="0.1" max="20"
            value="${cloud.scale}" />
        </label>
        <label class="detail-row">
          <span>Wind</span>
          <input data-cloud-number="speed" type="number" step="0.05" min="0" max="5"
            value="${cloud.speed}" />
        </label>
        <div class="detail-hint">Static procedural cloud dome. Wind 0 keeps it frozen; not volumetric.</div>
      </div>
    `;

    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-cloud-name]");
    nameInput?.addEventListener("change", () => {
      const value = nameInput.value.trim();
      this.app.setCloudLayer({ name: value.length > 0 ? value : undefined }, "Rename Cloud Layer");
    });

    this.detailsBody.querySelector<HTMLInputElement>("[data-cloud-color]")?.addEventListener(
      "change",
      (event) => {
        const value = (event.currentTarget as HTMLInputElement).value;
        this.app.setCloudLayer({ color: value }, "Edit Cloud Layer");
      },
    );

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-cloud-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.cloudNumber as keyof LayoutCloudLayer | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setCloudLayer({ [key]: value } as Partial<LayoutCloudLayer>, "Edit Cloud Layer");
      });
    });
  }

  /** Details panel for the singleton global Post Process actor (Faz 1). */
  private renderPostDetails(selection: EditableSelection): void {
    const post = selection.post;
    if (!post) return;
    this.detailsScale = [1, 1, 1];
    this.detailsBody.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / post process</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-post-name type="text" value="${escapeHtml(post.name)}" placeholder="Post Process" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Exposure & Tone Mapping</div>
        <label class="detail-row">
          <span>Exposure</span>
          <input data-post-exposure type="number" step="0.05" min="0" max="4"
            value="${post.exposure}" />
        </label>
        <label class="detail-row">
          <span>Tonemapper</span>
          <select data-post-tone-mapping>
            <option value="aces" ${post.toneMapping === "aces" ? "selected" : ""}>ACES Filmic</option>
            <option value="neutral" ${post.toneMapping === "neutral" ? "selected" : ""}>Neutral</option>
            <option value="none" ${post.toneMapping === "none" ? "selected" : ""}>None</option>
          </select>
        </label>
        <div class="detail-hint">Post Process controls scene exposure; Sky Atmosphere scales its own exposure locally.</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Anti-alias</div>
        <label class="detail-row">
          <span>Mode</span>
          <select data-post-antialias>
            <option value="none" ${post.antialias === "none" ? "selected" : ""}>None</option>
            <option value="smaa" ${post.antialias === "smaa" ? "selected" : ""}>SMAA</option>
          </select>
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Bloom</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-bloom-enabled ${post.bloom.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Threshold</span>
          <input data-post-bloom-number="threshold" type="number" step="0.05" min="0" max="2"
            value="${post.bloom.threshold}" />
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-post-bloom-number="intensity" type="number" step="0.05" min="0" max="5"
            value="${post.bloom.intensity}" />
        </label>
        <label class="detail-row">
          <span>Radius</span>
          <input data-post-bloom-number="radius" type="number" step="0.05" min="0" max="2"
            value="${post.bloom.radius}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Color Grading</div>
        <label class="detail-row">
          <span>Saturation</span>
          <input data-post-number="saturation" type="number" step="0.05" min="0" max="2"
            value="${post.saturation}" />
        </label>
        <label class="detail-row">
          <span>Contrast</span>
          <input data-post-number="contrast" type="number" step="0.05" min="0" max="2"
            value="${post.contrast}" />
        </label>
        <label class="detail-row">
          <span>Temperature</span>
          <input data-post-number="temperature" type="number" step="0.05" min="-1" max="1"
            value="${post.temperature}" />
        </label>
        <label class="detail-row">
          <span>Tint</span>
          <input data-post-number="tint" type="number" step="0.05" min="-1" max="1"
            value="${post.tint}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Vignette</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-vignette-enabled ${post.vignette.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-post-vignette-number="intensity" type="number" step="0.05" min="0" max="2"
            value="${post.vignette.intensity}" />
        </label>
        <label class="detail-row">
          <span>Offset</span>
          <input data-post-vignette-number="offset" type="number" step="0.05" min="0" max="2"
            value="${post.vignette.offset}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Depth of Field</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-dof-enabled ${post.dof.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Focus Distance</span>
          <input data-post-dof-number="focusDistance" type="number" step="0.5" min="0" max="100"
            value="${post.dof.focusDistance}" />
        </label>
        <label class="detail-row">
          <span>Aperture</span>
          <input data-post-dof-number="aperture" type="number" step="0.05" min="0" max="2"
            value="${post.dof.aperture}" />
        </label>
        <label class="detail-row">
          <span>Max Blur</span>
          <input data-post-dof-number="maxBlur" type="number" step="0.05" min="0" max="2"
            value="${post.dof.maxBlur}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Ambient Occlusion</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-ao-enabled ${post.ao.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Radius</span>
          <input data-post-ao-number="radius" type="number" step="0.05" min="0" max="4"
            value="${post.ao.radius}" />
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-post-ao-number="intensity" type="number" step="0.05" min="0" max="2"
            value="${post.ao.intensity}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Chromatic Aberration</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-ca-enabled ${post.chromaticAberration.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Amount</span>
          <input data-post-ca-number="amount" type="number" step="0.05" min="0" max="2"
            value="${post.chromaticAberration.amount}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Film Grain</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-grain-enabled ${post.grain.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-post-grain-number="intensity" type="number" step="0.05" min="0" max="1"
            value="${post.grain.intensity}" />
        </label>
      </div>
    `;

    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-post-name]");
    nameInput?.addEventListener("change", () => {
      const value = nameInput.value.trim();
      this.app.setPostProcess(
        { name: value.length > 0 ? value : undefined },
        "Rename Post Process",
      );
    });

    this.detailsBody.querySelector<HTMLInputElement>("[data-post-exposure]")?.addEventListener(
      "change",
      (event) => {
        const value = Number((event.currentTarget as HTMLInputElement).value);
        if (!Number.isFinite(value)) return;
        this.app.setPostProcess({ exposure: value }, "Edit Post Process");
      },
    );

    this.detailsBody.querySelector<HTMLSelectElement>("[data-post-tone-mapping]")?.addEventListener(
      "change",
      (event) => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        if (value !== "aces" && value !== "neutral" && value !== "none") return;
        this.app.setPostProcess(
          { toneMapping: value as LayoutPostProcess["toneMapping"] },
          "Edit Post Process",
        );
      },
    );

    this.detailsBody.querySelector<HTMLSelectElement>("[data-post-antialias]")?.addEventListener(
      "change",
      (event) => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        if (value !== "none" && value !== "smaa") return;
        this.app.setPostProcess(
          { antialias: value as LayoutPostProcess["antialias"] },
          "Edit Post Process Anti-alias",
        );
      },
    );

    this.detailsBody.querySelector<HTMLInputElement>("[data-post-bloom-enabled]")?.addEventListener(
      "change",
      (event) => {
        this.app.setPostProcess(
          { bloom: { ...post.bloom, enabled: (event.currentTarget as HTMLInputElement).checked } },
          "Edit Post Process Bloom",
        );
      },
    );

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-post-bloom-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.postBloomNumber as keyof LayoutPostProcess["bloom"] | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setPostProcess(
          { bloom: { ...post.bloom, [key]: value } },
          "Edit Post Process Bloom",
        );
      });
    });

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-post-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.postNumber as
          | "saturation"
          | "contrast"
          | "temperature"
          | "tint"
          | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setPostProcess({ [key]: value }, "Edit Post Process Color Grading");
      });
    });

    this.detailsBody.querySelector<HTMLInputElement>("[data-post-vignette-enabled]")?.addEventListener(
      "change",
      (event) => {
        this.app.setPostProcess(
          {
            vignette: {
              ...post.vignette,
              enabled: (event.currentTarget as HTMLInputElement).checked,
            },
          },
          "Edit Post Process Vignette",
        );
      },
    );

    this.detailsBody
      .querySelectorAll<HTMLInputElement>("[data-post-vignette-number]")
      .forEach((input) => {
        input.addEventListener("change", () => {
          const key = input.dataset.postVignetteNumber as
            | keyof LayoutPostProcess["vignette"]
            | undefined;
          const value = Number(input.value);
          if (!key || !Number.isFinite(value)) return;
          this.app.setPostProcess(
            { vignette: { ...post.vignette, [key]: value } },
            "Edit Post Process Vignette",
          );
        });
      });

    this.detailsBody.querySelector<HTMLInputElement>("[data-post-dof-enabled]")?.addEventListener(
      "change",
      (event) => {
        this.app.setPostProcess(
          { dof: { ...post.dof, enabled: (event.currentTarget as HTMLInputElement).checked } },
          "Edit Post Process Depth of Field",
        );
      },
    );

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-post-dof-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.postDofNumber as keyof LayoutPostProcess["dof"] | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setPostProcess(
          { dof: { ...post.dof, [key]: value } },
          "Edit Post Process Depth of Field",
        );
      });
    });

    this.detailsBody.querySelector<HTMLInputElement>("[data-post-ao-enabled]")?.addEventListener(
      "change",
      (event) => {
        this.app.setPostProcess(
          { ao: { ...post.ao, enabled: (event.currentTarget as HTMLInputElement).checked } },
          "Edit Post Process Ambient Occlusion",
        );
      },
    );

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-post-ao-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.postAoNumber as keyof LayoutPostProcess["ao"] | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setPostProcess(
          { ao: { ...post.ao, [key]: value } },
          "Edit Post Process Ambient Occlusion",
        );
      });
    });

    this.detailsBody.querySelector<HTMLInputElement>("[data-post-ca-enabled]")?.addEventListener(
      "change",
      (event) => {
        this.app.setPostProcess(
          {
            chromaticAberration: {
              ...post.chromaticAberration,
              enabled: (event.currentTarget as HTMLInputElement).checked,
            },
          },
          "Edit Post Process Chromatic Aberration",
        );
      },
    );

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-post-ca-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.postCaNumber as
          | keyof LayoutPostProcess["chromaticAberration"]
          | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setPostProcess(
          { chromaticAberration: { ...post.chromaticAberration, [key]: value } },
          "Edit Post Process Chromatic Aberration",
        );
      });
    });

    this.detailsBody.querySelector<HTMLInputElement>("[data-post-grain-enabled]")?.addEventListener(
      "change",
      (event) => {
        this.app.setPostProcess(
          { grain: { ...post.grain, enabled: (event.currentTarget as HTMLInputElement).checked } },
          "Edit Post Process Film Grain",
        );
      },
    );

    this.detailsBody.querySelectorAll<HTMLInputElement>("[data-post-grain-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.postGrainNumber as keyof LayoutPostProcess["grain"] | undefined;
        const value = Number(input.value);
        if (!key || !Number.isFinite(value)) return;
        this.app.setPostProcess(
          { grain: { ...post.grain, [key]: value } },
          "Edit Post Process Film Grain",
        );
      });
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
          aria-pressed="${locked}">${locked ? "ğŸ”’" : "ğŸ”“"}</button>
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
          dragActive ? "â— Dragging pivot" : "Drag in viewport"
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
  if (kind === "sky") return "S";
  if (kind === "fog") return "F";
  if (kind === "cloud") return "K";
  if (kind === "reflectionPlane") return "M";
  if (kind === "reflectiveSurface") return "R";
  if (kind === "reflectionCapture") return "O";
  if (kind === "post") return "P";
  if (kind === "worldWidget") return "W";
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
    value === "soundCue" ||
    value === "animation" ||
    value === "prefab" ||
    value === "ui" ||
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
  if (value === "soundCue") return "Sound Cues";
  if (value === "animation") return "Animations";
  if (value === "prefab") return "Prefabs";
  if (value === "level") return "Levels";
  if (value === "file") return "Files";
  return formatAssetTypeFallbackLabel(value);
}

/** True when a Content Browser item is an Actor Script class-asset (`*.actor.json`). */
function isActorScriptItem(item: BrowserAssetItem): boolean {
  return item.path.toLowerCase().endsWith(".actor.json");
}

/** True when a Content Browser item is a level/layout asset (`*.level.json` / `*.layout.json`). */
function isLevelItem(item: BrowserAssetItem): boolean {
  return item.type === "level";
}

/**
 * True for a UI Widget asset (`*.ui.json`). The `ui` asset type also covers
 * `*.theme.json` token files, which must NOT open in the widget editor (saving
 * would overwrite the theme with a widget tree).
 */
function isUiWidgetItem(item: BrowserAssetItem): boolean {
  return item.type === "ui" && item.path.toLowerCase().endsWith(".ui.json");
}

function formatContentTypeBadge(value: BrowserAssetItem["type"]): string {
  if (value === "staticMesh") return "Static Mesh";
  if (value === "skeletalMesh") return "Skeletal Mesh";
  if (value === "texture") return "Texture";
  if (value === "material") return "Material";
  if (value === "sound") return "Sound";
  if (value === "soundCue") return "Sound Cue";
  if (value === "animation") return "Animation";
  if (value === "prefab") return "Prefab";
  if (value === "ui") return "UI Widget";
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
  if (item.type !== "file" && isModelAssetType(item.type) && !item.editable.placeable) {
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
  folderCount: number,
  fileCount: number,
  issueCount: number,
  missingManifestAssetCount: number,
): string {
  const parts = [`${shownCount} shown / ${folderCount} folders / ${fileCount} files`];
  if (issueCount > 0) parts.push(`${issueCount} with issues`);
  if (missingManifestAssetCount > 0) {
    parts.push(`${missingManifestAssetCount} manifest asset file missing`);
  }
  return parts.join(" Â· ");
}

function isSameOrDescendantContentPath(path: string, folder: string): boolean {
  const normalizedPath = normalizeProjectPath(path);
  const normalizedFolder = normalizeProjectPath(folder);
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function replaceContentPathPrefix(path: string, fromFolder: string, toFolder: string): string {
  const normalizedPath = normalizeProjectPath(path);
  const normalizedFrom = normalizeProjectPath(fromFolder);
  const normalizedTo = normalizeProjectPath(toFolder);
  if (normalizedPath === normalizedFrom) return normalizedTo;
  if (!normalizedPath.startsWith(`${normalizedFrom}/`)) return normalizedPath;
  return `${normalizedTo}/${normalizedPath.slice(normalizedFrom.length + 1)}`;
}

function parentContentPath(path: string): string | null {
  const normalized = normalizeProjectPath(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return null;
  return normalized.slice(0, slash);
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

function parseOptionalBoolean(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
