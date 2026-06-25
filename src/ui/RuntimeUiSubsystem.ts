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
import { bindUiLocale, bindUiWidget } from "@engine/ui/uiBinding";
import type { UiViewModelStore } from "@engine/ui/uiViewModel";
import { applyUiTheme, type UiThemeDef } from "@engine/ui/uiTheme";
import type { LocaleRegistry } from "@engine/ui/uiLocale";
import { transitionClasses, type UiTransition } from "@engine/ui/uiTransition";
import { auditUiA11y, collectFocusables, nextFocusIndex } from "@engine/ui/uiA11y";

export interface RuntimeUiSubsystemOptions {
  /** Invoked when a `message`-kind widget action fires (UI → gameplay). */
  onMessageAction?: (action: Extract<UiAction, { type: "message" }>, nodeId: string) => void;
  /** Invoked after the screen-stack depth changes (push/pop/clear). */
  onScreenStackChange?: (depth: number) => void;
  /** ViewModel store driving `{ "bind": "path" }` props; omit for static UI. */
  store?: UiViewModelStore;
  /** Locale registry resolving `{ "key": ... }` text props; omit for non-localized UI. */
  locale?: LocaleRegistry;
  /** Resolves a widget's `theme` reference to a loaded theme (for `$token` props). */
  resolveTheme?: (ref: string) => UiThemeDef | null;
  /** Resolves an Include widget's `src` asset-id to its definition for inlining. */
  resolveWidget?: (src: string) => UiWidgetDef | null;
}

interface ScreenEntry {
  layer: HTMLElement;
  rendered: RenderedUiWidget;
  /** The normalized widget def (for focus order + the `?debug` a11y audit). */
  def: UiWidgetDef;
  /** Authored widget name, for the `?debug` inspector. */
  name: string;
  /** Screen enter/exit animation, or null when none authored. */
  transition: UiTransition | null;
  /** Focusable node ids in tab order (accessibility focus trap / navigation). */
  focusables: string[];
  /** Element that held focus before this screen opened, restored on pop. */
  restoreFocus: HTMLElement | null;
  /** Releases this screen's data bindings on pop/clear. */
  disposeBinding: () => void;
}

/** Live UI host state for the `?debug` inspector (active HUD + screen stack). */
export interface UiSubsystemDebugSnapshot {
  /** Mounted HUD widget name, or null when none. */
  hud: string | null;
  /** Active screen widget names, bottom → top. */
  screens: string[];
  /** Accessibility audit findings across the mounted HUD + screens. */
  audit: string[];
}

export class RuntimeUiSubsystem {
  private readonly hudLayer: HTMLElement;
  private readonly screenRoot: HTMLElement;
  private hud: RenderedUiWidget | null = null;
  private hudBinding: (() => void) | null = null;
  /** Mounted HUD widget name, for the `?debug` inspector. */
  private hudName: string | null = null;
  /** Mounted HUD def, for the `?debug` a11y audit. */
  private hudDef: UiWidgetDef | null = null;
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
    // Keyboard focus trap + navigation for the top screen (accessibility, U7c).
    this.screenRoot.addEventListener("keydown", this.handleScreenKeydown);
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
    this.hudDef = widget;
    this.hudBinding = this.bind(rendered, widget);
    return rendered;
  }

  clearHud(): void {
    this.hudBinding?.();
    this.hudBinding = null;
    this.hud?.dispose();
    this.hud = null;
    this.hudName = null;
    this.hudDef = null;
  }

  // --- Screen stack --------------------------------------------------------

  /** Pushes a screen on top of the stack and returns its handle. */
  pushScreen(def: UiWidgetDef | unknown): RenderedUiWidget {
    const widget = isUiWidgetDef(def) ? def : normalizeUiWidgetDef(def);
    const prevDepth = this.screens.length;
    const restoreFocus = activeFocusElement();
    const layer = document.createElement("div");
    layer.className = "forge-ui-screen-layer";
    // A screen is a modal dialog; `tabIndex` lets the layer hold focus when it has
    // no focusable children, so the keyboard trap still reaches it.
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.setAttribute("aria-label", widget.name);
    layer.tabIndex = -1;
    const rendered = renderUiWidget(widget, this.renderOptions());
    layer.appendChild(rendered.element);
    this.applyTheme(rendered, widget);
    this.screenRoot.appendChild(layer);
    const transition = widget.transition ?? null;
    const entry: ScreenEntry = {
      layer,
      rendered,
      def: widget,
      name: widget.name,
      transition,
      focusables: collectFocusables(widget.root),
      restoreFocus,
      disposeBinding: this.bind(rendered, widget),
    };
    this.screens.push(entry);
    this.animateEnter(layer, transition);
    this.focusInitial(entry);
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
    top.layer.setAttribute("aria-label", widget.name);
    this.applyTheme(rendered, widget);
    top.rendered = rendered;
    top.def = widget;
    top.name = widget.name;
    top.transition = widget.transition ?? null;
    top.focusables = collectFocusables(widget.root);
    top.disposeBinding = this.bind(rendered, widget);
    this.focusInitial(top);
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
    this.restoreFocus(entry);
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
    // Restore focus to whatever held it before the bottom screen opened.
    const bottom = this.screens[0];
    for (const entry of this.screens) {
      entry.disposeBinding();
      entry.rendered.dispose();
      entry.layer.remove();
    }
    this.screens.length = 0;
    if (bottom) this.restoreFocus(bottom);
    this.fireStackChange(prevDepth);
  }

  /** Element for a node id: searches the top screen first, then the HUD. */
  getElement(nodeId: string): HTMLElement | null {
    return this.screens.at(-1)?.rendered.byId.get(nodeId) ?? this.hud?.byId.get(nodeId) ?? null;
  }

  /** Active HUD + screen-stack names (+ a11y audit) for the `?debug` UI inspector. */
  getDebugSnapshot(): UiSubsystemDebugSnapshot {
    const audit: string[] = [];
    const collect = (def: UiWidgetDef | null): void => {
      if (!def) return;
      for (const issue of auditUiA11y(def)) {
        audit.push(`${def.name}: ${issue.widget} "${issue.nodeId}" — ${issue.message}`);
      }
    };
    collect(this.hudDef);
    for (const entry of this.screens) collect(entry.def);
    return { hud: this.hudName, screens: this.screens.map((entry) => entry.name), audit };
  }

  dispose(): void {
    for (const timer of this.animationTimers) clearTimeout(timer);
    this.animationTimers.clear();
    this.clearScreens();
    this.clearHud();
    this.screenRoot.removeEventListener("keydown", this.handleScreenKeydown);
    this.hudLayer.remove();
    this.screenRoot.remove();
  }

  // --- Focus (accessibility) -----------------------------------------------

  /**
   * Focuses a freshly pushed screen: the authored `initialFocus` node when it is
   * focusable, else the first focusable element, else the layer itself (so the
   * keyboard trap always has a focus holder even on a screen with no controls).
   */
  private focusInitial(entry: ScreenEntry): void {
    const elements = this.focusableElements(entry);
    let target: HTMLElement | undefined;
    const initial = entry.def.initialFocus;
    if (initial && entry.focusables.includes(initial)) {
      target = entry.rendered.byId.get(initial);
    }
    (target ?? elements[0] ?? entry.layer).focus({ preventScroll: true });
  }

  /** Restores focus to whatever held it before `entry` opened (if still connected). */
  private restoreFocus(entry: ScreenEntry): void {
    const el = entry.restoreFocus;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }

  /** The screen's focusable elements, in tab order, that are still in the DOM. */
  private focusableElements(entry: ScreenEntry): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const id of entry.focusables) {
      const el = entry.rendered.byId.get(id);
      if (el && el.isConnected) out.push(el);
    }
    return out;
  }

  /**
   * Moves keyboard focus within the top screen by `delta` (wrapping). Public so a
   * gamepad/action-map navigation source can drive the same focus order the
   * keyboard trap uses.
   */
  moveFocus(delta: number): void {
    const entry = this.screens.at(-1);
    if (!entry) return;
    const elements = this.focusableElements(entry);
    if (elements.length === 0) return;
    const active = activeFocusElement();
    const current = active ? elements.indexOf(active) : -1;
    const index = nextFocusIndex(current, elements.length, delta);
    elements[index]?.focus({ preventScroll: true });
  }

  /** Activates (clicks) the focused control in the top screen — Common UI "confirm". */
  activateFocused(): void {
    const entry = this.screens.at(-1);
    if (!entry) return;
    const active = activeFocusElement();
    if (active && entry.layer.contains(active)) active.click();
  }

  /** Tab/arrow keyboard navigation + focus trap, scoped to the top screen. */
  private readonly handleScreenKeydown = (event: KeyboardEvent): void => {
    if (this.screens.length === 0) return;
    switch (event.key) {
      case "Tab":
        event.preventDefault();
        this.moveFocus(event.shiftKey ? -1 : 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        this.moveFocus(-1);
        break;
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        this.moveFocus(1);
        break;
      default:
        break;
    }
  };

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

  /** Builds render options for a widget mount (action handler + optional resolvers). */
  private renderOptions(): RenderUiWidgetOptions {
    const opts: RenderUiWidgetOptions = { onAction: this.handleAction };
    if (this.options.resolveWidget) opts.resolveWidget = this.options.resolveWidget;
    const locale = this.options.locale;
    if (locale) opts.resolveLoc = (key, params) => locale.resolve(key, params);
    return opts;
  }

  /**
   * Wires a freshly rendered widget to its data sources: `{ bind }` props to the
   * store and `{ key }` text to the locale registry. Returns one combined dispose
   * the caller releases on unmount (no-op when neither source is configured).
   */
  private bind(rendered: RenderedUiWidget, widget: UiWidgetDef): () => void {
    const disposers: (() => void)[] = [];
    if (this.options.store) disposers.push(bindUiWidget(rendered, widget, this.options.store));
    if (this.options.locale) disposers.push(bindUiLocale(rendered, widget, this.options.locale));
    if (disposers.length === 0) return () => {};
    return () => {
      for (const dispose of disposers) dispose();
    };
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

/** The currently focused element as an HTMLElement, or null. */
function activeFocusElement(): HTMLElement | null {
  const el = typeof document !== "undefined" ? document.activeElement : null;
  return el instanceof HTMLElement ? el : null;
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
