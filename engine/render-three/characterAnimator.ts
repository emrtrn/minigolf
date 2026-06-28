import { AnimationMixer, LoopRepeat } from "three";
import type { AnimationAction, AnimationClip, Object3D } from "three";
import { applyRootMotionToClips, type RootMotionClipSetting } from "./rootMotion";

/** A clip plus its (un-normalized) blend weight, as produced by a blend space. */
export interface AnimatorBlendWeight {
  readonly clip: string;
  readonly weight: number;
}

/**
 * Wraps a Three.js `AnimationMixer` over a character's clips. Supports two
 * mutually-exclusive playback modes — single-clip {@link play} (crossfade by
 * name) and weighted {@link playBlend} (a blend space's per-clip weights) — and
 * switches cleanly between them. Generic render glue: it holds no game rules,
 * the runtime shell (via the pure locomotion selector in `src/game`) decides
 * *what* to play. The owned mixer is advanced once per tick by the
 * `AnimationSubsystem`.
 *
 * Three-touching, so it lives in `engine/render-three`, not `engine/core`.
 */
export class CrossfadeAnimator {
  readonly mixer: AnimationMixer;
  /** Names of the clips this animator can play. */
  readonly clips: ReadonlySet<string>;
  private readonly actions = new Map<string, AnimationAction>();
  private current: string | null = null;
  /** Clips actively contributing to the current weighted blend (empty in clip mode). */
  private readonly blendActions = new Map<string, AnimationAction>();

  constructor(
    root: Object3D,
    clips: readonly AnimationClip[],
    options: { readonly rootMotion?: readonly RootMotionClipSetting[] } = {},
  ) {
    this.mixer = new AnimationMixer(root);
    for (const clip of applyRootMotionToClips(clips, options.rootMotion)) {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    this.clips = new Set(this.actions.keys());
  }

  /** The clip currently playing (or fading in), or null before the first play. */
  get currentClip(): string | null {
    return this.current;
  }

  /**
   * The single clip currently driving the pose with its playhead, for animation
   * notify detection. Null in weighted-blend mode (the playhead is ambiguous) or
   * before the first {@link play}.
   */
  getActiveClip(): { clip: string; time: number; duration: number } | null {
    if (this.blendActions.size > 0 || !this.current) return null;
    const action = this.actions.get(this.current);
    if (!action) return null;
    return { clip: this.current, time: action.time, duration: action.getClip().duration };
  }

  /** Whether a weighted blend (not a single clip) is currently driving the pose. */
  get isBlending(): boolean {
    return this.blendActions.size > 0;
  }

  /**
   * Crossfades to `name` over `duration` seconds. A no-op when it is already the
   * current clip or the name is unknown. The first play snaps in (there is
   * nothing to fade from); a non-positive `duration` also snaps. Leaving blend
   * mode (a prior {@link playBlend}) stops the weighted actions first.
   */
  play(name: string, duration = 0.2): void {
    if (this.blendActions.size > 0) this.stopBlend();
    if (name === this.current) return;
    const next = this.actions.get(name);
    if (!next) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    const prev = this.current ? this.actions.get(this.current) : undefined;
    if (prev && duration > 0) prev.crossFadeTo(next, duration, false);
    else if (prev) prev.stop();
    this.current = name;
  }

  /**
   * Drives a weighted blend of clips (a blend space's resolved weights). Weights
   * are re-normalized; unknown/zero-weight clips are ignored. Contributing clips
   * are kept phase-synced — each runs at a time scale that makes every clip
   * complete one loop over the same blend-weighted reference duration, so a
   * walk↔run blend keeps its footfalls aligned. Newly contributing clips join at
   * the current normalized phase. A no-op when nothing valid contributes (the
   * existing pose is held). Call once per tick with fresh weights.
   */
  playBlend(weights: readonly AnimatorBlendWeight[]): void {
    const valid = weights.filter((entry) => entry.weight > 0 && this.actions.has(entry.clip));
    const total = valid.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return;
    // Leaving single-clip mode: stop the lone action so it stops contributing.
    if (this.current) {
      this.actions.get(this.current)?.stop();
      this.current = null;
    }
    const phase = this.blendPhase();
    let refDuration = 0;
    for (const entry of valid) {
      refDuration += this.actions.get(entry.clip)!.getClip().duration * (entry.weight / total);
    }
    if (refDuration <= 1e-4) refDuration = 1;
    const desired = new Set(valid.map((entry) => entry.clip));
    for (const [name, action] of this.blendActions) {
      if (desired.has(name)) continue;
      action.stop();
      this.blendActions.delete(name);
    }
    for (const entry of valid) {
      let action = this.blendActions.get(entry.clip);
      if (!action) {
        action = this.actions.get(entry.clip)!;
        action.reset();
        action.enabled = true;
        action.setLoop(LoopRepeat, Infinity);
        const duration = action.getClip().duration;
        action.time = phase * duration;
        action.play();
        this.blendActions.set(entry.clip, action);
      }
      action.setEffectiveWeight(entry.weight / total);
      action.setEffectiveTimeScale(action.getClip().duration / refDuration);
    }
  }

  /** Normalized [0,1) phase of the dominant blend action, for aligning joiners. */
  private blendPhase(): number {
    let dominant: AnimationAction | null = null;
    let bestWeight = -1;
    for (const action of this.blendActions.values()) {
      const weight = action.getEffectiveWeight();
      if (weight > bestWeight) {
        bestWeight = weight;
        dominant = action;
      }
    }
    if (!dominant) return 0;
    const duration = dominant.getClip().duration;
    return duration > 0 ? (dominant.time % duration) / duration : 0;
  }

  private stopBlend(): void {
    for (const action of this.blendActions.values()) action.stop();
    this.blendActions.clear();
  }
}
