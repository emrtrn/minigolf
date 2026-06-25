/**
 * UI screen transitions (UMG Lite, U7a).
 *
 * Declarative, web-first enter/exit animations for screens, driven by CSS
 * `opacity`/`transform` transitions — deliberately *not* a keyframe timeline
 * (out of scope; see plan §U7a). A widget asset carries an optional
 * {@link UiTransition}; the runtime UI host (`RuntimeUiSubsystem`) applies the
 * preset's CSS classes when a screen is pushed (enter) or popped (exit), and the
 * editor preview can replay it.
 *
 * Pure module: no DOM, no Three. The class-name mapping + reduced-motion gate are
 * pure so they are headless-tested; the host owns the actual DOM class toggling.
 */

/**
 * Built-in transition presets. `none` disables animation; the rest map to a
 * single CSS offset state reused for both enter (from → natural) and exit
 * (natural → from), so a screen slides/scales/fades in and reverses out.
 */
export const UI_TRANSITION_PRESETS = [
  "none",
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "scale",
] as const;
export type UiTransitionPreset = (typeof UI_TRANSITION_PRESETS)[number];

export function isUiTransitionPreset(value: unknown): value is UiTransitionPreset {
  return typeof value === "string" && (UI_TRANSITION_PRESETS as readonly string[]).includes(value);
}

/** A screen's enter/exit transition: which preset plays each way + duration. */
export interface UiTransition {
  enter: UiTransitionPreset;
  exit: UiTransitionPreset;
  durationMs: number;
}

export const DEFAULT_TRANSITION_DURATION_MS = 160;
const MIN_TRANSITION_DURATION_MS = 0;
const MAX_TRANSITION_DURATION_MS = 2000;

/** CSS base class enabling the transition (duration is applied inline by the host). */
export const UI_TRANSITION_BASE_CLASS = "forge-ui-tx";

/**
 * Coerces arbitrary JSON into a {@link UiTransition}, or null when absent or a
 * no-op. Accepts a shorthand string (`"fade"` → same preset both ways) or an
 * object `{ enter, exit, durationMs }`. Invalid presets fall back to `"none"`;
 * duration clamps to [0, 2000] ms. Returns null when both directions are `"none"`
 * (nothing to animate), so a def only carries `transition` when meaningful.
 */
export function normalizeUiTransition(value: unknown): UiTransition | null {
  if (typeof value === "string") {
    if (!isUiTransitionPreset(value) || value === "none") return null;
    return { enter: value, exit: value, durationMs: DEFAULT_TRANSITION_DURATION_MS };
  }
  if (!isPlainObject(value)) return null;
  const enter = isUiTransitionPreset(value.enter) ? value.enter : "none";
  const exit = isUiTransitionPreset(value.exit) ? value.exit : "none";
  if (enter === "none" && exit === "none") return null;
  const raw =
    typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
      ? value.durationMs
      : DEFAULT_TRANSITION_DURATION_MS;
  const durationMs = Math.min(
    MAX_TRANSITION_DURATION_MS,
    Math.max(MIN_TRANSITION_DURATION_MS, Math.round(raw)),
  );
  return { enter, exit, durationMs };
}

/** CSS classes for one direction's transition: `base` enables it, `offset` is the from/out state. */
export interface UiTransitionClasses {
  base: string;
  offset: string;
}

/**
 * CSS classes for a preset, or null when there is nothing to animate (preset
 * `"none"` or reduced-motion). The host adds {@link UiTransitionClasses.base}
 * plus, transiently, {@link UiTransitionClasses.offset} to drive the animation.
 */
export function transitionClasses(
  preset: UiTransitionPreset,
  reducedMotion = false,
): UiTransitionClasses | null {
  if (reducedMotion || preset === "none") return null;
  return { base: UI_TRANSITION_BASE_CLASS, offset: `${UI_TRANSITION_BASE_CLASS}-${preset}` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
