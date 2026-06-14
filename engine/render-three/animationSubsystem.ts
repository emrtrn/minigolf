import type { AnimationMixer } from "three";

import type { EngineUpdateContext, Subsystem } from "@engine/core/Subsystem";

/** Stable registry id for the animation subsystem. */
export const ANIMATION_SUBSYSTEM_ID = "render-three.animation";

/**
 * Advances Three.js `AnimationMixer`s once per engine tick.
 *
 * Owns the live mixer set (a mixer is added as each character's clip starts
 * playing) and steps every mixer by the tick's `deltaSeconds`. This is the work
 * that previously ran inline in the `SceneApp` rAF loop; moving it behind a
 * subsystem proves the engine-core tick drives real per-frame work.
 *
 * Three-touching, so it lives in `engine/render-three`, not `engine/core`.
 */
export class AnimationSubsystem implements Subsystem {
  readonly id = ANIMATION_SUBSYSTEM_ID;
  private readonly mixers: AnimationMixer[] = [];

  /** Registers a mixer to be advanced on each tick; returns it for chaining. */
  add(mixer: AnimationMixer): AnimationMixer {
    this.mixers.push(mixer);
    return mixer;
  }

  /** Drops all mixers (e.g. when the scene is torn down or reloaded). */
  clear(): void {
    this.mixers.length = 0;
  }

  update(context: EngineUpdateContext): void {
    for (const mixer of this.mixers) mixer.update(context.deltaSeconds);
  }

  dispose(): void {
    this.clear();
  }
}
