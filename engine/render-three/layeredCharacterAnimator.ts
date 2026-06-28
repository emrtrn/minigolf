/**
 * Layered character animator: drives the lower body with locomotion while the
 * upper body runs a montage/aim pose (Unreal's Slot + Layered Blend Per Bone, as
 * data). Built on two {@link CrossfadeAnimator}s over body-masked clip variants —
 * the lower one keeps the legs walking, the upper one is the "UpperBody slot":
 * by default it mirrors locomotion (arm swing), and montages (fire/reload) or a
 * held aim pose temporarily own it. The masks are disjoint, so the two channels
 * compose without fighting over any bone.
 *
 * The runtime shell decides *what* each channel plays (locomotion selector + game
 * input); this class only orchestrates the slot/montage state. Three-touching.
 */
import { type AnimationClip, type Object3D } from "three";
import { CrossfadeAnimator, type AnimatorBlendWeight } from "./characterAnimator";
import { collectSubtreeNodeNames, splitClipsByUpperBody } from "./bodyMask";
import { applyRootMotionToClips, type RootMotionClipSetting } from "./rootMotion";

export interface LayeredMontageOptions {
  readonly blendInSeconds?: number;
  readonly blendOutSeconds?: number;
}

export class LayeredCharacterAnimator {
  /** All clip names available on either channel. */
  readonly clips: ReadonlySet<string>;
  private readonly lower: CrossfadeAnimator;
  private readonly upper: CrossfadeAnimator;
  private readonly durations = new Map<string, number>();
  private readonly upperBodyMatched: boolean;

  /** Dominant locomotion clip the upper body mirrors when no aim/montage owns it. */
  private passthroughClip: string | null = null;
  /** Held upper-body pose (aim); null means mirror locomotion. */
  private aimClip: string | null = null;
  /** Active one-shot upper montage, with the time left and its return blend. */
  private montage: { clip: string; remaining: number; blendOut: number } | null = null;

  constructor(
    root: Object3D,
    clips: readonly AnimationClip[],
    upperBodyBone: string,
    options: { readonly rootMotion?: readonly RootMotionClipSetting[] } = {},
  ) {
    const upperNames = collectSubtreeNodeNames(root, upperBodyBone);
    this.upperBodyMatched = upperNames.size > 0;
    const playbackClips = applyRootMotionToClips(clips, options.rootMotion);
    const split = splitClipsByUpperBody(playbackClips, upperNames);
    this.lower = new CrossfadeAnimator(root, split.lower);
    this.upper = new CrossfadeAnimator(root, split.upper);
    this.clips = new Set(clips.map((clip) => clip.name));
    for (const clip of clips) this.durations.set(clip.name, clip.duration);
  }

  /** The two mixers to register with the `AnimationSubsystem`. */
  get mixers(): readonly [CrossfadeAnimator["mixer"], CrossfadeAnimator["mixer"]] {
    return [this.lower.mixer, this.upper.mixer];
  }

  /** True when the upper-body mask matched bones (else layering is a no-op). */
  get hasUpperBody(): boolean {
    return this.upperBodyMatched;
  }

  /** Current lower-channel clip (legs), for debug/tests. */
  get lowerClip(): string | null {
    return this.lower.currentClip;
  }

  /** Current upper-channel clip (torso/arms/head), for debug/tests. */
  get upperClip(): string | null {
    return this.upper.currentClip;
  }

  /**
   * Lower-channel (locomotion) playhead for notify detection — the canonical
   * footstep case. Null in blend mode / before first play (see
   * {@link CrossfadeAnimator.getActiveClip}). Upper-body montage notifies are not
   * sampled here yet.
   */
  getActiveClip(): { clip: string; time: number; duration: number } | null {
    return this.lower.getActiveClip();
  }

  // --- Lower body (locomotion) ---

  playLocomotion(clip: string, fadeSeconds = 0.18): void {
    this.lower.play(clip, fadeSeconds);
    this.setPassthrough(clip);
  }

  playLocomotionBlend(weights: readonly AnimatorBlendWeight[]): void {
    this.lower.playBlend(weights);
    const dominant = dominantClip(weights);
    if (dominant) this.setPassthrough(dominant);
  }

  // --- Upper body (slot) ---

  /** Holds an upper-body aim pose; pass null to release back to locomotion. */
  setAim(clip: string | null, blendInSeconds = 0.18): void {
    const next = clip && this.clips.has(clip) ? clip : null;
    if (next === this.aimClip) return;
    this.aimClip = next;
    if (!this.montage) this.applyUpper(blendInSeconds);
  }

  /** Plays a one-shot upper-body montage; returns to aim/passthrough when done. */
  playMontage(clip: string, options: LayeredMontageOptions = {}): void {
    if (!this.clips.has(clip)) return;
    this.montage = {
      clip,
      remaining: this.durations.get(clip) ?? 0,
      blendOut: options.blendOutSeconds ?? 0.2,
    };
    this.upper.play(clip, options.blendInSeconds ?? 0.08);
  }

  /** Whether a one-shot upper montage is currently playing. */
  get isMontaging(): boolean {
    return this.montage !== null;
  }

  /** Advances montage timing; call once per tick from the session's update. */
  update(deltaSeconds: number): void {
    if (!this.montage) return;
    this.montage.remaining -= deltaSeconds;
    if (this.montage.remaining > 0) return;
    const blendOut = this.montage.blendOut;
    this.montage = null;
    this.applyUpper(blendOut);
  }

  private setPassthrough(clip: string): void {
    this.passthroughClip = clip;
    if (!this.montage && !this.aimClip) this.upper.play(clip, 0.18);
  }

  private applyUpper(fadeSeconds: number): void {
    const target = this.aimClip ?? this.passthroughClip;
    if (target) this.upper.play(target, fadeSeconds);
  }
}

function dominantClip(weights: readonly AnimatorBlendWeight[]): string | null {
  let dominant: string | null = null;
  let best = -1;
  for (const entry of weights) {
    if (entry.weight > best) {
      best = entry.weight;
      dominant = entry.clip;
    }
  }
  return dominant;
}
