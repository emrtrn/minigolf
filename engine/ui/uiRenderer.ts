/**
 * UI Widget renderer (UMG Lite runtime).
 *
 * Two layers, split so the mapping logic is testable without a DOM:
 *   1. {@link buildUiRenderTree} — pure: turns a {@link UiWidgetDef} into a plain
 *      {@link UiRenderNode} tree (tag + class + CSS style + text + action). No
 *      DOM, no Three; unit-tested in `tools/engine-tests.ts`.
 *   2. {@link renderUiWidget} / {@link mountUiRenderNode} — thin: walks that tree
 *      into real elements under `#ui-overlay`, wiring action listeners and an
 *      id→element map. Touches `document` only when called (safe to import in
 *      node).
 *
 * v1 widget set: Canvas, Panel, Stack, Text, Image, Button, ProgressBar.
 * v2 adds: Include (embeds another .ui.json asset inline).
 */
import {
  isUiContainerKind,
  readUiAction,
  readUiStaticNumber,
  readUiStaticString,
  readUiTextKey,
  type UiAction,
  type UiNode,
  type UiWidgetDef,
  type UiWidgetKind,
} from "./uiWidget";
import { tokenToCssVar } from "./uiTheme";
import { resolveUiA11yAttrs } from "./uiA11y";

/** Stable CSS suffix per widget kind (`Forge-ui-<suffix>`), decoupled from the enum casing. */
const WIDGET_CSS_NAME: Record<UiWidgetKind, string> = {
  Canvas: "canvas",
  Panel: "panel",
  Stack: "stack",
  Text: "text",
  Image: "image",
  Button: "button",
  ProgressBar: "progress",
  Include: "include",
};

/**
 * Options for the pure build pass.
 * `resolveWidget` is called when an `Include` node is encountered; if it
 * returns a def the included tree is inlined, otherwise a placeholder is shown.
 * `_depth` is an internal recursion guard (max {@link MAX_INCLUDE_DEPTH}).
 */
export interface UiBuildOptions {
  resolveWidget?: (src: string) => UiWidgetDef | null;
  /**
   * Resolves a Text/Button node's localized `{ key, params }` text to display
   * text. Absent: a localized prop falls back to its raw key (so an editor
   * preview without a loaded locale table still shows something meaningful).
   */
  resolveLoc?: (key: string, params?: Record<string, string>) => string;
  _depth?: number;
}

const MAX_INCLUDE_DEPTH = 5;

/** Plain, DOM-free description of one rendered element (the renderer's IR). */
export interface UiRenderNode {
  /** Authored {@link UiNode.id}; absent (empty) for synthetic nodes (e.g. progress fill). */
  nodeId: string;
  widget: UiWidgetKind | "ProgressFill";
  tag: "div" | "button";
  className: string;
  /** CSS-named inline style props (e.g. `align-items`, `border-radius`). */
  style: Record<string, string>;
  /** ARIA / accessibility attributes (e.g. `role`, `aria-label`, `tabindex`). */
  attrs?: Record<string, string>;
  /** Text content for leaf nodes (Text/Button); undefined for containers. */
  text?: string;
  /** Click action for interactive nodes (Button). */
  action?: UiAction;
  /** Synthetic nodes are not authored: skipped from the id→element map + data id. */
  synthetic?: boolean;
  children: UiRenderNode[];
}

/** Layout/style props mapped onto inline CSS (allowlisted so `style` can't be arbitrary CSS). */
const STYLE_NUMBER_PX: Record<string, string> = {
  gap: "gap",
  padding: "padding",
  width: "width",
  height: "height",
  minWidth: "min-width",
  minHeight: "min-height",
  maxWidth: "max-width",
  maxHeight: "max-height",
  fontSize: "font-size",
  radius: "border-radius",
};
const STYLE_NUMBER_RAW: Record<string, string> = {
  grow: "flex-grow",
  opacity: "opacity",
};
const STYLE_STRING_RAW: Record<string, string> = {
  background: "background",
  color: "color",
  fontWeight: "font-weight",
};

/** Friendly flex alignment tokens → CSS values (passthrough for anything else). */
const FLEX_ALIGN: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  stretch: "stretch",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};

function flexValue(token: string): string {
  return FLEX_ALIGN[token] ?? token;
}

/** A `$token` theme reference (e.g. `"$color.surface"`). */
function isTokenRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 1 && value.startsWith("$");
}

/** `"$color.surface"` → `var(--forge-ui-color-surface)` (resolved by the theme). */
function cssVarForTokenRef(ref: string): string {
  return `var(${tokenToCssVar(ref.slice(1))})`;
}

/**
 * Resolves a node's allowlisted style props into a CSS-named inline-style map. A
 * prop may be a literal (number → px, flex alias, passthrough) or a `$token`
 * theme reference, which becomes `var(--forge-ui-<token>)` regardless of prop.
 */
export function resolveInlineStyle(node: UiNode): Record<string, string> {
  const style: Record<string, string> = {};
  const tokenInto = (css: string, key: string): boolean => {
    const raw = node.props[key];
    if (!isTokenRef(raw)) return false;
    style[css] = cssVarForTokenRef(raw);
    return true;
  };

  if (!tokenInto("align-items", "align")) {
    const align = readUiStaticString(node, "align");
    if (align) style["align-items"] = flexValue(align);
  }
  if (!tokenInto("justify-content", "justify")) {
    const justify = readUiStaticString(node, "justify");
    if (justify) style["justify-content"] = flexValue(justify);
  }
  for (const [key, css] of Object.entries(STYLE_NUMBER_PX)) {
    if (tokenInto(css, key)) continue;
    const value = readUiStaticNumber(node, key);
    if (value !== undefined) style[css] = `${value}px`;
  }
  for (const [key, css] of Object.entries(STYLE_NUMBER_RAW)) {
    if (tokenInto(css, key)) continue;
    const value = readUiStaticNumber(node, key);
    if (value !== undefined) style[css] = String(value);
  }
  for (const [key, css] of Object.entries(STYLE_STRING_RAW)) {
    if (tokenInto(css, key)) continue;
    const value = readUiStaticString(node, key);
    if (value !== undefined) style[css] = value;
  }
  return style;
}

/**
 * Resolves a node's `text` prop for the initial render: a localized
 * `{ key, params }` goes through {@link UiBuildOptions.resolveLoc} (raw key when
 * absent), otherwise the literal string. Returns undefined for a `{ bind }` prop
 * (the ViewModel binding fills that in after mount).
 */
function resolveNodeText(node: UiNode, opts: UiBuildOptions): string | undefined {
  const textKey = readUiTextKey(node, "text");
  if (textKey) return opts.resolveLoc ? opts.resolveLoc(textKey.key, textKey.params) : textKey.key;
  return readUiStaticString(node, "text");
}

function progressFillNode(node: UiNode): UiRenderNode {
  const value = readUiStaticNumber(node, "value") ?? 0;
  const max = readUiStaticNumber(node, "max") ?? 1;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return {
    nodeId: "",
    widget: "ProgressFill",
    tag: "div",
    className: "forge-ui-progress__fill",
    style: { width: `${(pct * 100).toFixed(2)}%` },
    synthetic: true,
    children: [],
  };
}

/** Builds the className for a node: base + per-kind + Stack direction + interactive opt-in. */
function classNameFor(node: UiNode): string {
  const classes = ["forge-ui-node", `forge-ui-${WIDGET_CSS_NAME[node.widget]}`];
  if (node.widget === "Stack") {
    const direction = readUiStaticString(node, "direction") === "row" ? "row" : "column";
    classes.push(`forge-ui-stack--${direction}`);
  }
  // Interactive widgets opt back into pointer events (the overlay root is click-through).
  if (node.widget === "Button") classes.push("ui-interactive");
  return classes.join(" ");
}

/** Pure: maps one authored {@link UiNode} into a {@link UiRenderNode}. */
export function buildUiRenderNode(node: UiNode, opts: UiBuildOptions = {}): UiRenderNode {
  // Include: embed the referenced widget's tree (with cycle/depth guard).
  if (node.widget === "Include") {
    const src = readUiStaticString(node, "src");
    const depth = opts._depth ?? 0;
    if (src && opts.resolveWidget && depth < MAX_INCLUDE_DEPTH) {
      const ref = opts.resolveWidget(src);
      if (ref) {
        const inner = buildUiRenderNode(ref.root, { ...opts, _depth: depth + 1 });
        // Transparent wrapper preserves the Include node's id in the byId map
        // without affecting flex layout (display:contents).
        return {
          nodeId: node.id,
          widget: "Include",
          tag: "div",
          className: "forge-ui-node forge-ui-include forge-ui-include--resolved",
          style: { display: "contents" },
          children: [inner],
        };
      }
    }
    // Placeholder: show a labelled box so the author knows the ref is unresolved.
    return {
      nodeId: node.id,
      widget: "Include",
      tag: "div",
      className: "forge-ui-node forge-ui-include",
      style: {},
      text: src ? `[${src}]` : "[include]",
      children: [],
    };
  }

  const style = resolveInlineStyle(node);
  const className = classNameFor(node);
  const resolvedAttrs = resolveUiA11yAttrs(node);
  const a11y = Object.keys(resolvedAttrs).length > 0 ? { attrs: resolvedAttrs } : {};

  if (node.widget === "Image") {
    const src = readUiStaticString(node, "src");
    if (src) style["background-image"] = `url(${JSON.stringify(src)})`;
    return { nodeId: node.id, widget: "Image", tag: "div", className, style, ...a11y, children: [] };
  }

  if (node.widget === "Text") {
    return {
      nodeId: node.id,
      widget: "Text",
      tag: "div",
      className,
      style,
      ...a11y,
      text: resolveNodeText(node, opts) ?? "",
      children: [],
    };
  }

  if (node.widget === "Button") {
    const action = readUiAction(node);
    return {
      nodeId: node.id,
      widget: "Button",
      tag: "button",
      className,
      style,
      ...a11y,
      text: resolveNodeText(node, opts) ?? "Button",
      ...(action ? { action } : {}),
      children: [],
    };
  }

  if (node.widget === "ProgressBar") {
    return {
      nodeId: node.id,
      widget: "ProgressBar",
      tag: "div",
      className,
      style,
      ...a11y,
      children: [progressFillNode(node)],
    };
  }

  // Containers (Canvas/Panel/Stack): recurse children.
  const children = isUiContainerKind(node.widget)
    ? node.children.map((child) => buildUiRenderNode(child, opts))
    : [];
  return { nodeId: node.id, widget: node.widget, tag: "div", className, style, ...a11y, children };
}

/** Pure: builds the full render tree for an asset (its root node). */
export function buildUiRenderTree(def: UiWidgetDef, opts: UiBuildOptions = {}): UiRenderNode {
  return buildUiRenderNode(def.root, opts);
}

export interface UiMountContext {
  onAction?: ((action: UiAction, nodeId: string) => void) | undefined;
  /** Filled with authored-node id → element (synthetic nodes excluded). */
  byId: Map<string, HTMLElement>;
}

/** Thin DOM layer: materializes one {@link UiRenderNode} (and its subtree). */
export function mountUiRenderNode(node: UiRenderNode, ctx: UiMountContext): HTMLElement {
  const element = document.createElement(node.tag);
  element.className = node.className;
  for (const [css, value] of Object.entries(node.style)) {
    element.style.setProperty(css, value);
  }
  if (node.attrs) {
    for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, value);
  }
  if (!node.synthetic && node.nodeId) element.dataset.uiId = node.nodeId;
  if (node.text !== undefined && node.children.length === 0) {
    element.textContent = node.text;
  }
  for (const child of node.children) {
    element.appendChild(mountUiRenderNode(child, ctx));
  }
  if (node.action && ctx.onAction) {
    const action = node.action;
    element.addEventListener("click", () => ctx.onAction?.(action, node.nodeId));
  }
  if (!node.synthetic && node.nodeId) ctx.byId.set(node.nodeId, element);
  return element;
}

export interface RenderedUiWidget {
  /** Root element (mount it under `#ui-overlay`). */
  element: HTMLElement;
  /** Authored-node id → element, for binding updates / inspection. */
  byId: Map<string, HTMLElement>;
  /** The pure render tree the element was built from. */
  tree: UiRenderNode;
  /** Removes the element from the DOM (listeners GC with it). */
  dispose(): void;
}

export interface RenderUiWidgetOptions {
  onAction?: (action: UiAction, nodeId: string) => void;
  /** Resolves Include widget `src` references to their definitions. */
  resolveWidget?: (src: string) => UiWidgetDef | null;
  /** Resolves localized `{ key, params }` text for the initial render. */
  resolveLoc?: (key: string, params?: Record<string, string>) => string;
}

/** Builds + mounts a widget asset into a detached element ready to append to the overlay. */
export function renderUiWidget(
  def: UiWidgetDef,
  options: RenderUiWidgetOptions = {},
): RenderedUiWidget {
  const buildOpts: UiBuildOptions = {};
  if (options.resolveWidget) buildOpts.resolveWidget = options.resolveWidget;
  if (options.resolveLoc) buildOpts.resolveLoc = options.resolveLoc;
  const tree = buildUiRenderTree(def, buildOpts);
  const byId = new Map<string, HTMLElement>();
  const element = mountUiRenderNode(tree, { onAction: options.onAction, byId });
  return {
    element,
    byId,
    tree,
    dispose: () => element.remove(),
  };
}
