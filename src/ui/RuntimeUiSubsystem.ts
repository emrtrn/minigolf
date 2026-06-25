/**
 * Runtime UI host (UMG Lite).
 *
 * Owns two stacked regions inside the `#ui-overlay` DOM layer:
 *   - **HUD layer** (`setHud`) — one persistent, non-interactive widget pinned at
 *     the bottom. Click-through (`pointer-events: none`), so a HUD never steals
 *     pointer/orbit gestures from the 3D viewport.
 *   - **Screen stack** (`pushScreen`/`replaceScreen`/`popScreen`/`back`) — menus
 *     and modals layered above the HUD. Each screen is a full-frame *scrim*
 *     (`pointer-events: auto`) so an open menu blocks click-through to the canvas
 *     (no accidental camera re-capture) and the top screen owns input.
 *
 * Widget actions are split by kind: a `back` action pops the top screen here
 * (Common UI's cancel); a `message` action is forwarded out via
 * {@link RuntimeUiSubsystemOptions.onMessageAction} for the game layer to react
 * to. {@link RuntimeUiSubsystemOptions.onScreenStackChange} fires whenever the
 * stack depth changes, so the app can route input (suppress gameplay while a
 * menu is up, resume when it closes).
 *
 * Generic by design — no project rules live here. The game decides *which*
 * widget to show and *how* to react to its messages.
 */
import {
  normalizeUiWidgetDef,
  type UiAction,
  type UiWidgetDef,
} from "@engine/ui/uiWidget";
import { renderUiWidget, type RenderedUiWidget, type RenderUiWidgetOptions } from "@engine/ui/uiRenderer";
import { bindUiWidget } from "@engine/ui/uiBinding";
import type { UiViewModelStore } from "@engine/ui/uiViewModel";
import { applyUiTheme, type UiThemeDef } from "@engine/ui/uiTheme";
import { transitionClasses, type UiTransition } from "@engine/ui/uiTransition";

export interface RuntimeUiSubsystemOptions {
  /** Invoked when a `message`-kind widget action fires (UI → gameplay). */
  onMessageAction?: (action: Extract<UiAction, { type: "message" }>, nodeId: string) => void;
  /** Invoked after the screen-stack depth changes (push/pop/clear). */
  onScreenStackChange?: (depth: number) => void;
  /** ViewModel store driving `{ "bind": "path" }` props; omit for static UI. */
  store?: UiViewModelStore;
  /** Resolves a widget's `theme` reference to a loaded theme (for `$token` props). */
  resolveTheme?: (ref: string) => UiThemeDef | null;
  /** Resolves an Include widget's `src` asset-id to its definition for inlining. */
  resolveWidget?: (src: string) => UiWidgetDef | null;
}

interface ScreenEntry {
  layer: HTMLElement;
  rendered: RenderedUiWidget;
  /** Authored widget name, for the `?debug` inspector. */
  name: string;
  /** Screen enter/exit animation, or null when none authored. */
  transition: UiTransition | null;
  /** Releases this screen's data bindings on pop/clear. */
  disposeBinding: () => void;
}

/** Live UI host state for the `?debug` inspector (active HUD + screen stack). */
export interface UiSubsystemDebugSnapshot {
  /** Mounted HUD widget name, or null when none. */
  hud: string | null;
  /** Active screen widget names, bottom → top. */
  screens: string[];
}

export class RuntimeUiSubsystem {
  private readonly hudLayer: HTMLElement;
  private readonly screenRoot: HTMLElement;
  private hud: RenderedUiWidget | null = null;
  private hudBinding: (() => void) | null = null;
  /** Mounted HUD widget name, for the `?debug` inspector. */
  private hudName: string | null = null;
  private readonly screens: ScreenEntry[] = [];
  /** Pending enter/exit-animation cleanup timers, cleared on dispose. */
  private readonly animationTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly host: HTMLElement,
    private readonly options: RuntimeUiSubsystemOptions = {},
  ) {
    this.hudLayer = document.createElement("div");
    this.hudLayer.className = "forge-ui-hud-layer";
    this.screenRoot = document.createElement("div");
    this.screenRoot.className = "forge-ui-screen-root";
    // HUD first (bottom), screens above — order is fixed regardless of call timing.
    this.host.appendChild(this.hudLayer);
    this.host.appendChild(this.screenRoot);
  }

  /** Number of screens currently on the stack (0 when only the HUD, if any, shows). */
  get screenDepth(): number {
    return this.screens.length;
  }

  // --- HUD layer -----------------------------------------------------------

  /** Renders the persistent HUD widget, replacing any current one. */
  setHud(def: UiWidgetDef | unknown): RenderedUiWidget {
    const widget = isUiWidgetDef(def) ? def : normalizeUiWidgetDef(def);
    this.clearHud();
    const rendered = renderUiWidget(widget, this.renderOptions());
    this.hudLayer.appendChild(rendered.element);
    this.applyTheme(rendered, widget);
    this.hud = rendered;
    this.hudName = widget.name;
    this.hudBinding = this.bind(rendered, widget);
    return rendered;
  }

  clearHud(): void {
    this.hudBinding?.();
    this.hudBinding = null;
    this.hud?.dispose();
    this.hud = null;
    this.hudName = null;
  }

  // --- Screen stack --------------------------------------------------------

  /** Pushes a screen on top of the stack and returns its handle. */
  pushScreen(def: UiWidgetDef | unknown): RenderedUiWidget {
    const widget = isUiWidgetDef(def) ? def : normalizeUiWidgetDef(def);
    const prevDepth = this.screens.length;
    const layer = document.createElement("div");
    layer.className = "forge-ui-screen-layer";
    const rendered = renderUiWidget(widget, this.renderOptions());
    layer.appendChild(rendered.element);
    this.applyTheme(rendered, widget);
    this.screenRoot.appendChild(layer);
    const transition = widget.transition ?? null;
    this.screens.push({
      layer,
      rendered,
      name: widget.name,
      transition,
      disposeBinding: this.bind(rendered, widget),
    });
    this.animateEnter(layer, transition);
    this.fireStackChange(prevDepth);
    return rendered;
  }

  /** Replaces the top screen in place (no depth change), or pushes when empty. */
  replaceScreen(def: UiWidgetDef | unknown): RenderedUiWidget {
    const top = this.screens.at(-1);
    if (!top) return this.pushScreen(def);
    const widget = isUiWidgetDef(def) ? def : normalizeUiWidgetDef(def);
    top.disposeBinding();
    top.rendered.dispose();
    const rendered = renderUiWidget(widget, this.renderOptions());
    top.layer.appendChild(rendered.element);
    this.applyTheme(rendered, widget);
    top.rendered = rendered;
    top.name = widget.name;
    top.transition = widget.transition ?? null;
    top.disposeBinding = this.bind(rendered, widget);
    return rendered;
  }

  /**
   * Pops the top screen. Returns false when the stack was already empty. Input
   * routing (the stack-change callback) and data bindings are released
   * immediately; the layer's DOM is removed after its exit animation finishes.
   */
  popScreen(): boolean {
    const entry = this.screens.pop();
    if (!entry) return false;
    entry.disposeBinding();
    this.animateExit(entry);
    this.fireStackChange(this.screens.length + 1);
    return true;
  }

  /** Cancel/back: pops the top screen (alias of {@link popScreen}). */
  back(): boolean {
    return this.popScreen();
  }

  /** Removes every screen (e.g. on resume), firing one stack change. */
  clearScreens(): void {
    if (this.screens.length === 0) return;
    const prevDepth = this.screens.length;
    for (const entry of this.screens) {
      entry.disposeBinding();
      entry.rendered.dispose();
      entry.layer.remove();
    }
    this.screens.length = 0;
    this.fireStackChange(prevDepth);
  }

  /** Element for a node id: searches the top screen first, then the HUD. */
  getElement(nodeId: string): HTMLElement | null {
    return this.screens.at(-1)?.rendered.byId.get(nodeId) ?? this.hud?.byId.get(nodeId) ?? null;
  }

  /** Active HUD + screen-stack names for the `?debug` UI inspector. */
  getDebugSnapshot(): UiSubsystemDebugSnapshot {
    return { hud: this.hudName, screens: this.screens.map((entry) => entry.name) };
  }

  dispose(): void {
    for (const timer of this.animationTimers) clearTimeout(timer);
    this.animationTimers.clear();
    this.clearScreens();
    this.clearHud();
    this.hudLayer.remove();
    this.screenRoot.remove();
  }

  /** True when the user prefers reduced motion (animations are then skipped). */
  private reducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /**
   * Plays a screen's enter animation: mount in the offset (from) state, then drop
   * the offset on the next frame so CSS transitions it to the natural state.
   * No-op for `none`/reduced-motion. The base class + inline duration are cleared
   * once the transition ends so later style changes don't animate.
   */
  private animateEnter(layer: HTMLElement, transition: UiTransition | null): void {
    const classes = transition ? transitionClasses(transition.enter, this.reducedMotion()) : null;
    if (!classes || !transition) return;
    layer.style.transitionDuration = `${transition.durationMs}ms`;
    layer.classList.add(classes.base, classes.offset);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => layer.classList.remove(classes.offset));
    });
    let done = false;
    const cleanup = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.animationTimers.delete(timer);
      layer.removeEventListener("transitionend", onEnd);
      layer.classList.remove(classes.base);
      layer.style.transitionDuration = "";
    };
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === layer) cleanup();
    };
    layer.addEventListener("transitionend", onEnd);
    const timer = setTimeout(cleanup, transition.durationMs + 80);
    this.animationTimers.add(timer);
  }

  /**
   * Plays a screen's exit animation, then removes its layer + disposes its
   * widget. The layer stops intercepting input immediately. With no transition
   * (or reduced motion) the removal is synchronous.
   */
  private animateExit(entry: ScreenEntry): void {
    const classes = entry.transition
      ? transitionClasses(entry.transition.exit, this.reducedMotion())
      : null;
    if (!classes || !entry.transition) {
      entry.rendered.dispose();
      entry.layer.remove();
      return;
    }
    const { layer } = entry;
    layer.style.pointerEvents = "none";
    layer.style.transitionDuration = `${entry.transition.durationMs}ms`;
    layer.classList.add(classes.base);
    void layer.offsetWidth; // Force reflow so the offset animates from the natural state.
    layer.classList.add(classes.offset);
    let done = false;
    const cleanup = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.animationTimers.delete(timer);
      layer.removeEventListener("transitionend", onEnd);
      entry.rendered.dispose();
      layer.remove();
    };
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === layer) cleanup();
    };
    layer.addEventListener("transitionend", onEnd);
    const timer = setTimeout(cleanup, entry.transition.durationMs + 80);
    this.animationTimers.add(timer);
  }

  private readonly handleAction = (action: UiAction, nodeId: string): void => {
    if (action.type === "back") {
      this.back();
      return;
    }
    this.options.onMessageAction?.(action, nodeId);
  };

  /** Builds render options for a widget mount (action handler + optional resolveWidget). */
  private renderOptions(): RenderUiWidgetOptions {
    const opts: RenderUiWidgetOptions = { onAction: this.handleAction };
    if (this.options.resolveWidget) opts.resolveWidget = this.options.resolveWidget;
    return opts;
  }

  /** Wires a freshly rendered widget's `{ bind }` props to the store (no-op without one). */
  private bind(rendered: RenderedUiWidget, widget: UiWidgetDef): () => void {
    return this.options.store ? bindUiWidget(rendered, widget, this.options.store) : () => {};
  }

  /** Applies the widget's referenced theme's `$token` CSS variables to its root. */
  private applyTheme(rendered: RenderedUiWidget, widget: UiWidgetDef): void {
    if (!widget.theme || !this.options.resolveTheme) return;
    const theme = this.options.resolveTheme(widget.theme);
    if (theme) applyUiTheme(rendered.element, theme);
  }

  private fireStackChange(prevDepth: number): void {
    if (this.screens.length !== prevDepth) {
      this.options.onScreenStackChange?.(this.screens.length);
    }
  }
}

/** Narrow guard: already a normalized {@link UiWidgetDef} (skip re-normalizing). */
function isUiWidgetDef(value: unknown): value is UiWidgetDef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "ui" &&
    typeof (value as { root?: unknown }).root === "object"
  );
}
