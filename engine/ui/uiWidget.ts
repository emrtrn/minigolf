/**
 * UI Widget (UMG Lite) asset model.
 *
 * A UI Widget is Forge's answer to an Unreal Widget Blueprint: a reusable,
 * declarative *widget tree* (not a placed instance) describing a HUD / menu
 * screen. It is stored as a `*.ui.json` sidecar under `public/` and rendered at
 * runtime into the `#ui-overlay` DOM layer (see `engine/ui/uiRenderer.ts`).
 *
 * Deliberately data-driven: there is no node graph. A node is a widget kind
 * (`Canvas`, `Stack`, `Text`, `Button`, ...) plus a normalized `props` bag.
 * Behaviour is expressed as typed {@link UiAction}s (v1: a single `message`
 * action) and data binding as a typed {@link UiBinding} path — never arbitrary
 * JavaScript. Both keep the runtime renderer simple and the asset safe to save.
 *
 * Pure module: no Three.js, no DOM. The runtime renderer, the (future) UI
 * editor, and `tools/saveValidator.ts` all read this and reuse
 * {@link normalizeUiWidgetDef}, so a malformed/legacy file can never crash a
 * load or be silently corrupted on save.
 */
import type { SceneJsonValue } from "../scene/entity";
import { normalizeUiTransition, type UiTransition } from "./uiTransition";
import { normalizeUiA11y, type UiA11y } from "./uiA11y";

/**
 * The first widget set (plan §1). Containers (`Canvas`, `Panel`, `Stack`) hold
 * children; the rest are leaves. The "next set" (Slider, Checkbox, InputText,
 * ListView, ScrollView, Modal) is intentionally deferred — when added it extends
 * this union and the renderer.
 */
export const UI_WIDGET_KINDS = [
  "Canvas",
  "Panel",
  "Stack",
  "Text",
  "Image",
  "Button",
  "ProgressBar",
  "Include",
] as const;
export type UiWidgetKind = (typeof UI_WIDGET_KINDS)[number];

/** Container kinds may hold children; leaf kinds ignore any authored children. */
export const UI_CONTAINER_KINDS: readonly UiWidgetKind[] = ["Canvas", "Panel", "Stack"];

export function isUiWidgetKind(value: unknown): value is UiWidgetKind {
  return typeof value === "string" && (UI_WIDGET_KINDS as readonly string[]).includes(value);
}

export function isUiContainerKind(kind: UiWidgetKind): boolean {
  return UI_CONTAINER_KINDS.includes(kind);
}

/**
 * A typed data-binding reference, e.g. `{ "bind": "player.health" }`. v1 binds
 * are resolved by the (future) ViewModel-lite store against a small, typed path
 * set — never an arbitrary expression. The schema tolerates bindings now so
 * authored data survives even before the store exists.
 */
export interface UiBinding {
  bind: string;
}

export function isUiBinding(value: unknown): value is UiBinding {
  return isPlainObject(value) && typeof value.bind === "string" && value.bind.length > 0;
}

/** A prop that is either a literal value or a {@link UiBinding}. */
export type UiBindable<T> = T | UiBinding;

/**
 * A typed localized-text reference, e.g. `{ "key": "menu.start" }` with optional
 * `{name}` params. The sibling of {@link UiBinding} for the `text` prop: the
 * active locale's table resolves it at render time (see `engine/ui/uiLocale.ts`).
 * Like bindings, the schema tolerates it now so authored data survives even
 * before any locale table is loaded.
 */
export interface UiTextKey {
  key: string;
  params?: Record<string, string>;
}

export function isUiTextKey(value: unknown): value is UiTextKey {
  return isPlainObject(value) && typeof value.key === "string" && value.key.length > 0;
}

/**
 * A typed widget action. v1 supports two kinds:
 *  - `message`: post a named message the game layer subscribes to (UI → gameplay).
 *  - `back`: pop the current screen (Common UI's "back"/cancel) — handled by the
 *    runtime UI host itself, never reaching the game.
 * Unknown action shapes normalize to null, so a future action type can be added
 * without older runtimes mis-firing.
 */
export interface UiMessageAction {
  type: "message";
  message: string;
}
export interface UiBackAction {
  type: "back";
}
export type UiAction = UiMessageAction | UiBackAction;

export function normalizeUiAction(value: unknown): UiAction | null {
  if (!isPlainObject(value)) return null;
  if (value.type === "message" && typeof value.message === "string" && value.message.length > 0) {
    return { type: "message", message: value.message };
  }
  if (value.type === "back") return { type: "back" };
  return null;
}

/** One node of the widget tree (parent/child via nested {@link UiNode.children}). */
export interface UiNode {
  /** Stable id, unique within the asset; used by the renderer's id→element map. */
  id: string;
  widget: UiWidgetKind;
  /** Normalized prop bag (literals or {@link UiBinding} objects). */
  props: Record<string, SceneJsonValue>;
  /** Optional accessibility metadata (ARIA label/role, focusability). See `uiA11y.ts`. */
  a11y?: UiA11y;
  children: UiNode[];
}

/** Authoring preview frame the editor/renderer use to size the design canvas. */
export interface UiPreview {
  width: number;
  height: number;
}

/** A complete UI Widget asset (the `*.ui.json` payload). */
export interface UiWidgetDef {
  schema: 1;
  type: "ui";
  name: string;
  preview: UiPreview;
  /** Optional `*.theme.json` token asset reference (resolved in a later phase). */
  theme?: string;
  /** Optional screen enter/exit animation (applied by the runtime UI host). */
  transition?: UiTransition;
  /**
   * Optional id of the node to focus when this widget is pushed as a screen
   * (accessibility, U7c). Falls back to the first focusable node when absent or
   * when the referenced node isn't focusable.
   */
  initialFocus?: string;
  root: UiNode;
}

export const DEFAULT_UI_PREVIEW: UiPreview = { width: 1280, height: 720 };

/** A fresh, minimal widget asset: an empty `Canvas` root. */
export function defaultUiWidgetDef(name: string): UiWidgetDef {
  return {
    schema: 1,
    type: "ui",
    name,
    preview: { ...DEFAULT_UI_PREVIEW },
    root: { id: "root", widget: "Canvas", props: {}, children: [] },
  };
}

// ---------------------------------------------------------------------------
// Typed prop readers — the renderer/editor read props through these so the
// literal-vs-binding distinction is handled in one place.
// ---------------------------------------------------------------------------

/** Literal string at `key`, or undefined when absent / a binding / wrong type. */
export function readUiStaticString(node: UiNode, key: string): string | undefined {
  const value = node.props[key];
  return typeof value === "string" ? value : undefined;
}

/** Literal finite number at `key`, or undefined when absent / a binding / wrong type. */
export function readUiStaticNumber(node: UiNode, key: string): number | undefined {
  const value = node.props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Literal boolean at `key`, or undefined when absent / a binding / wrong type. */
export function readUiStaticBoolean(node: UiNode, key: string): boolean | undefined {
  const value = node.props[key];
  return typeof value === "boolean" ? value : undefined;
}

/** Binding path at `key` (e.g. `"player.health"`), or undefined when the prop is a literal. */
export function readUiBindingPath(node: UiNode, key: string): string | undefined {
  const value = node.props[key];
  return isUiBinding(value) ? value.bind : undefined;
}

/**
 * Localized-text reference at `key` (default `"text"`), or undefined for a
 * literal/binding. Params are sanitized to string values (numbers coerced) so a
 * hand-authored table can't smuggle non-string substitutions into the DOM.
 */
export function readUiTextKey(node: UiNode, key = "text"): UiTextKey | undefined {
  const value = node.props[key];
  if (!isUiTextKey(value)) return undefined;
  const params = isPlainObject(value.params) ? sanitizeTextKeyParams(value.params) : undefined;
  return params ? { key: value.key, params } : { key: value.key };
}

/** Keeps only string/number param values (numbers coerced to strings), dropping the rest. */
function sanitizeTextKeyParams(value: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) out[key] = String(raw);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Typed action at `key` (default `"onClick"`), or null when absent / malformed. */
export function readUiAction(node: UiNode, key = "onClick"): UiAction | null {
  return normalizeUiAction(node.props[key]);
}

// ---------------------------------------------------------------------------
// Tree helpers (pure) — used by the UI editor to build/find/mutate the tree.
// ---------------------------------------------------------------------------

/** Sensible default props for a freshly added widget (palette → designer). */
const NEW_NODE_PROPS: Partial<Record<UiWidgetKind, Record<string, SceneJsonValue>>> = {
  Text: { text: "Text" },
  Button: { text: "Button" },
  ProgressBar: { value: 50, max: 100 },
  Stack: { direction: "column", gap: 8 },
  Include: { src: "" },
};

/** Builds a new node of the given kind with default props and the supplied id. */
export function createUiNode(widget: UiWidgetKind, id: string): UiNode {
  return { id, widget, props: { ...(NEW_NODE_PROPS[widget] ?? {}) }, children: [] };
}

/** Depth-first search for a node by id (returns the node, or null). */
export function findUiNode(root: UiNode, id: string): UiNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findUiNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Finds the parent of the node with `id` (null for the root or when absent). */
export function findUiNodeParent(root: UiNode, id: string): UiNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findUiNodeParent(child, id);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalization (defensive: never throws, always returns a usable asset).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keeps only JSON-serializable prop values, dropping `undefined`. */
function normalizeProps(value: unknown): Record<string, SceneJsonValue> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, SceneJsonValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    out[key] = raw as SceneJsonValue;
  }
  return out;
}

function normalizePreview(value: unknown): UiPreview {
  if (!isPlainObject(value)) return { ...DEFAULT_UI_PREVIEW };
  const width =
    typeof value.width === "number" && value.width > 0 ? value.width : DEFAULT_UI_PREVIEW.width;
  const height =
    typeof value.height === "number" && value.height > 0 ? value.height : DEFAULT_UI_PREVIEW.height;
  return { width, height };
}

/**
 * Normalizes one node. Unknown widget kinds fall back to `Panel` (a safe empty
 * container) so a future/unknown widget renders as a box rather than breaking
 * the tree. Leaf kinds keep no children. `nextId` mints ids for nodes that omit
 * one, keeping every id unique within the asset.
 */
function normalizeUiNode(value: unknown, nextId: () => string): UiNode {
  const input = isPlainObject(value) ? value : {};
  const widget = isUiWidgetKind(input.widget) ? input.widget : "Panel";
  const id = typeof input.id === "string" && input.id.length > 0 ? input.id : nextId();
  const props = normalizeProps(input.props);
  const a11y = normalizeUiA11y(input.a11y);
  const children =
    isUiContainerKind(widget) && Array.isArray(input.children)
      ? input.children.map((child) => normalizeUiNode(child, nextId))
      : [];
  return { id, widget, props, ...(a11y ? { a11y } : {}), children };
}

/**
 * Defensively coerces arbitrary JSON into a valid {@link UiWidgetDef}.
 *
 * Back-compat: the legacy `{ schema:1, type:"ui", name, root:{} }` stub (and any
 * malformed file) normalizes to a widget with an empty `Canvas` root, so old
 * files keep opening. Always returns a def with a root node.
 */
export function normalizeUiWidgetDef(value: unknown, fallbackName = "Untitled"): UiWidgetDef {
  const input = isPlainObject(value) ? value : {};
  const name = typeof input.name === "string" && input.name.length > 0 ? input.name : fallbackName;
  const preview = normalizePreview(input.preview);
  const theme = typeof input.theme === "string" && input.theme.length > 0 ? input.theme : undefined;
  const transition = normalizeUiTransition(input.transition);
  const initialFocus =
    typeof input.initialFocus === "string" && input.initialFocus.length > 0
      ? input.initialFocus
      : undefined;

  let counter = 0;
  const seen = new Set<string>();
  const nextId = (): string => {
    let id = `node-${counter++}`;
    while (seen.has(id)) id = `node-${counter++}`;
    return id;
  };

  // An empty/missing root (the legacy `root: {}` stub) becomes a fresh Canvas.
  const hasRoot = isPlainObject(input.root) && Object.keys(input.root).length > 0;
  const root = hasRoot
    ? dedupeNodeIds(normalizeUiNode(input.root, nextId), seen)
    : { id: "root", widget: "Canvas" as const, props: {}, children: [] };

  return {
    schema: 1,
    type: "ui",
    name,
    preview,
    ...(theme ? { theme } : {}),
    ...(transition ? { transition } : {}),
    ...(initialFocus ? { initialFocus } : {}),
    root,
  };
}

/**
 * Rewrites duplicate ids to unique ones (depth-first), so a hand-authored file
 * that reused an id can't produce an ambiguous id→element map at render time.
 */
function dedupeNodeIds(node: UiNode, seen: Set<string>): UiNode {
  let counter = 0;
  const assign = (current: UiNode): UiNode => {
    let id = current.id;
    while (seen.has(id)) id = `${current.id}-${counter++}`;
    seen.add(id);
    return {
      id,
      widget: current.widget,
      props: current.props,
      ...(current.a11y ? { a11y: current.a11y } : {}),
      children: current.children.map(assign),
    };
  };
  return assign(node);
}
