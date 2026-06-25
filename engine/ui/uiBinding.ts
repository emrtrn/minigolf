/**
 * UI data binding (UMG MVVM glue).
 *
 * Connects a rendered widget's elements to a {@link UiViewModelStore}: collects
 * the `{ "bind": "path" }` props in a widget tree, resolves each to its current
 * field value, and applies it to the DOM. Only nodes that carry a binding are
 * wired, and each re-applies only when one of its bound paths changes — the
 * event-driven update the plan calls for (no per-frame re-read of every widget).
 *
 * v1 bindable props: `text` (Text/Button), `value` + `max` (ProgressBar), `src`
 * (Image). Collection is pure + testable; {@link applyBoundNode} /
 * {@link bindUiWidget} touch the DOM and run only at runtime.
 */
import { readUiBindingPath, readUiTextKey, type UiNode, type UiTextKey, type UiWidgetDef } from "./uiWidget";
import type { RenderedUiWidget } from "./uiRenderer";
import type { UiFieldValue, UiViewModelStore } from "./uiViewModel";
import type { LocaleRegistry } from "./uiLocale";

/** Props a binding can drive, per widget kind. */
export const BINDABLE_UI_PROPS = ["text", "value", "max", "src"] as const;
export type BindableUiProp = (typeof BINDABLE_UI_PROPS)[number];

export interface UiNodeBinding {
  node: UiNode;
  binds: { prop: BindableUiProp; path: string }[];
}

/** Walks the tree and returns one entry per node that carries ≥1 binding. */
export function collectUiBindings(def: UiWidgetDef): UiNodeBinding[] {
  const out: UiNodeBinding[] = [];
  const walk = (node: UiNode): void => {
    const binds: { prop: BindableUiProp; path: string }[] = [];
    for (const prop of BINDABLE_UI_PROPS) {
      const path = readUiBindingPath(node, prop);
      if (path !== undefined) binds.push({ prop, path });
    }
    if (binds.length > 0) out.push({ node, binds });
    node.children.forEach(walk);
  };
  walk(def.root);
  return out;
}

/**
 * Resolves a prop to its live value: the store field when the prop is bound,
 * else the static literal (so a ProgressBar with a bound `value` and static
 * `max` still works). Undefined when neither yields a usable scalar.
 */
export function resolveUiBoundValue(
  node: UiNode,
  prop: BindableUiProp,
  store: UiViewModelStore,
): UiFieldValue | undefined {
  const path = readUiBindingPath(node, prop);
  if (path !== undefined) return store.getField(path);
  const literal = node.props[prop];
  return typeof literal === "string" || typeof literal === "number" || typeof literal === "boolean"
    ? literal
    : undefined;
}

function numberOr(value: UiFieldValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Applies a bound node's current values to its element (DOM). */
export function applyBoundNode(
  element: HTMLElement,
  node: UiNode,
  store: UiViewModelStore,
): void {
  switch (node.widget) {
    case "Text":
    case "Button": {
      const value = resolveUiBoundValue(node, "text", store);
      element.textContent = value === undefined ? "" : String(value);
      break;
    }
    case "Image": {
      const src = resolveUiBoundValue(node, "src", store);
      element.style.backgroundImage =
        typeof src === "string" && src ? `url(${JSON.stringify(src)})` : "";
      break;
    }
    case "ProgressBar": {
      const value = numberOr(resolveUiBoundValue(node, "value", store), 0);
      const max = numberOr(resolveUiBoundValue(node, "max", store), 1);
      const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
      const fill = element.querySelector<HTMLElement>(".forge-ui-progress__fill");
      if (fill) fill.style.width = `${(pct * 100).toFixed(2)}%`;
      // Keep the ARIA value in sync so a screen reader announces the live progress.
      element.setAttribute("aria-valuenow", String(value));
      element.setAttribute("aria-valuemax", String(max));
      break;
    }
    default:
      break;
  }
}

/**
 * Wires a rendered widget's bound nodes to the store: applies initial values,
 * then subscribes each node to its paths. Returns an unsubscribe handle the
 * caller releases on unmount.
 */
export function bindUiWidget(
  rendered: RenderedUiWidget,
  def: UiWidgetDef,
  store: UiViewModelStore,
): () => void {
  const unsubscribes: (() => void)[] = [];
  for (const { node, binds } of collectUiBindings(def)) {
    const element = rendered.byId.get(node.id);
    if (!element) continue;
    const apply = (): void => applyBoundNode(element, node, store);
    apply();
    for (const { path } of binds) unsubscribes.push(store.subscribe(path, apply));
  }
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

// ---------------------------------------------------------------------------
// Localization glue (sibling of binding): re-resolve `{ key }` text on a locale
// switch. The initial render is already localized by the build pass
// (`resolveLoc`); this keeps mounted widgets in sync when the locale changes.
// ---------------------------------------------------------------------------

export interface UiNodeLoc {
  node: UiNode;
  textKey: UiTextKey;
}

/** Walks the tree and returns one entry per Text/Button node with a localized `text`. */
export function collectUiLocBindings(def: UiWidgetDef): UiNodeLoc[] {
  const out: UiNodeLoc[] = [];
  const walk = (node: UiNode): void => {
    if (node.widget === "Text" || node.widget === "Button") {
      const textKey = readUiTextKey(node, "text");
      if (textKey) out.push({ node, textKey });
    }
    node.children.forEach(walk);
  };
  walk(def.root);
  return out;
}

/** Resolves a localized node's text against the active locale and applies it (DOM). */
export function applyLocNode(
  element: HTMLElement,
  textKey: UiTextKey,
  registry: LocaleRegistry,
): void {
  element.textContent = registry.resolve(textKey.key, textKey.params);
}

/**
 * Wires a rendered widget's localized text nodes to the registry: re-resolves
 * them whenever the active locale changes. Returns an unsubscribe handle the
 * caller releases on unmount. No-op when the widget has no localized text.
 */
export function bindUiLocale(
  rendered: RenderedUiWidget,
  def: UiWidgetDef,
  registry: LocaleRegistry,
): () => void {
  const locNodes = collectUiLocBindings(def);
  if (locNodes.length === 0) return () => {};
  const apply = (): void => {
    for (const { node, textKey } of locNodes) {
      const element = rendered.byId.get(node.id);
      if (element) applyLocNode(element, textKey, registry);
    }
  };
  apply();
  return registry.subscribe(apply);
}
