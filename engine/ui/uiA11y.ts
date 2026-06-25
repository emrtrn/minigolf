/**
 * UI accessibility (UMG Lite, U7c).
 *
 * DOM is natively accessible, so Forge gets real ARIA roles/attributes almost for
 * free — this module just maps a widget node to the right semantics and computes
 * keyboard focus order. Three pure concerns:
 *   1. {@link resolveUiA11yAttrs} — widget kind + authored {@link UiA11y} → an ARIA
 *      attribute map (role / aria-label / aria-value* / tabindex). Applied by the
 *      renderer like inline style.
 *   2. {@link collectFocusables} + {@link nextFocusIndex} — the focus order within a
 *      screen and wrap-around navigation, used by the runtime UI host's focus trap.
 *   3. {@link auditUiA11y} — a tiny lint (label-less Button / Image) surfaced in the
 *      `?debug` inspector so authoring gaps are visible.
 *
 * Pure module: no DOM, no Three. The runtime host applies the attributes and owns
 * actual focus/`.focus()`; everything here is headless-tested.
 *
 * Imports prop readers from {@link ./uiWidget} (a deliberate, runtime-only import
 * cycle: `uiWidget` only references `normalizeUiA11y` inside its own functions).
 */
import {
  readUiBindingPath,
  readUiStaticNumber,
  readUiStaticString,
  readUiTextKey,
  type UiNode,
  type UiWidgetDef,
  type UiWidgetKind,
} from "./uiWidget";

/**
 * Authored accessibility metadata for a node. All fields optional: a `label`
 * becomes `aria-label`, a `role` overrides the widget's default ARIA role, and
 * `focusable` opts a non-interactive node into (or a Button out of) keyboard focus.
 */
export interface UiA11y {
  label?: string;
  role?: string;
  focusable?: boolean;
}

/** Widget kinds that the browser focuses without an explicit `tabindex`. */
const NATIVELY_FOCUSABLE: readonly UiWidgetKind[] = ["Button"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Defensively coerces arbitrary JSON into {@link UiA11y}, or undefined when empty. */
export function normalizeUiA11y(value: unknown): UiA11y | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: UiA11y = {};
  if (typeof value.label === "string" && value.label.length > 0) out.label = value.label;
  if (typeof value.role === "string" && value.role.length > 0) out.role = value.role;
  if (typeof value.focusable === "boolean") out.focusable = value.focusable;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Whether a node takes keyboard focus: an explicit `a11y.focusable` wins, else
 * Buttons are focusable and everything else is not. Drives {@link collectFocusables}
 * and (via tabindex) the DOM tab order.
 */
export function isUiNodeFocusable(node: UiNode): boolean {
  if (node.a11y?.focusable === true) return true;
  if (node.a11y?.focusable === false) return false;
  return NATIVELY_FOCUSABLE.includes(node.widget);
}

/**
 * Resolves a node's ARIA attributes from its widget kind plus authored
 * {@link UiA11y}. ProgressBar gets `role=progressbar` + `aria-value*` (from static
 * value/max; a bound bar is updated by the binding layer); Image gets `role=img`;
 * an explicit `label`/`role` override. `focusable` maps to `tabindex` so a focusable
 * non-Button (or a defocused Button) participates correctly in keyboard navigation.
 */
export function resolveUiA11yAttrs(node: UiNode): Record<string, string> {
  const attrs: Record<string, string> = {};
  switch (node.widget) {
    case "ProgressBar": {
      attrs.role = "progressbar";
      attrs["aria-valuemin"] = "0";
      const value = readUiStaticNumber(node, "value");
      const max = readUiStaticNumber(node, "max");
      if (max !== undefined) attrs["aria-valuemax"] = String(max);
      if (value !== undefined) attrs["aria-valuenow"] = String(value);
      break;
    }
    case "Image":
      attrs.role = "img";
      break;
    default:
      break;
  }
  const a11y = node.a11y;
  if (a11y?.role) attrs.role = a11y.role;
  if (a11y?.label) attrs["aria-label"] = a11y.label;
  if (a11y?.focusable === true && !NATIVELY_FOCUSABLE.includes(node.widget)) {
    attrs.tabindex = "0";
  } else if (a11y?.focusable === false) {
    attrs.tabindex = "-1";
  }
  return attrs;
}

/** Depth-first list of focusable node ids — the screen's keyboard focus order. */
export function collectFocusables(root: UiNode): string[] {
  const ids: string[] = [];
  const walk = (node: UiNode): void => {
    if (isUiNodeFocusable(node)) ids.push(node.id);
    node.children.forEach(walk);
  };
  walk(root);
  return ids;
}

/**
 * The next index when moving focus by `delta` over `count` items, wrapping at both
 * ends. A negative `current` (nothing focused) seeds from the first item going
 * forward or the last going back. Returns -1 when there is nothing to focus.
 */
export function nextFocusIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

/** One accessibility lint finding (surfaced in the `?debug` UI inspector). */
export interface UiA11yIssue {
  nodeId: string;
  widget: UiWidgetKind;
  message: string;
}

/**
 * A minimal accessibility audit: flags a Button with no accessible name (no text,
 * text key, bound text, or `a11y.label`) and an Image with no `a11y.label` (its
 * `role=img` needs a name). Deliberately small — not a full WCAG checker.
 */
export function auditUiA11y(def: UiWidgetDef): UiA11yIssue[] {
  const issues: UiA11yIssue[] = [];
  const walk = (node: UiNode): void => {
    if (node.widget === "Button" && !hasAccessibleName(node)) {
      issues.push({ nodeId: node.id, widget: node.widget, message: "Button has no text or label" });
    } else if (node.widget === "Image" && !node.a11y?.label) {
      issues.push({ nodeId: node.id, widget: node.widget, message: "Image has no label" });
    }
    node.children.forEach(walk);
  };
  walk(def.root);
  return issues;
}

/** Whether a node has any accessible name source (label, literal/key/bound text). */
function hasAccessibleName(node: UiNode): boolean {
  if (node.a11y?.label) return true;
  if (readUiTextKey(node, "text")) return true;
  if (readUiBindingPath(node, "text") !== undefined) return true;
  return (readUiStaticString(node, "text") ?? "").length > 0;
}
