/**
 * Sound Cue Lite — typed schema for `*.soundcue.json` authoring assets.
 *
 * A Sound Cue is a small directed acyclic graph (DAG) that describes how one
 * or more raw audio clips are combined, randomised, pitch/volume-modulated,
 * looped, and delayed before reaching the output. The runtime evaluator
 * (`soundCueEvaluator.ts`) compiles the graph to a list of concrete play
 * events; the engine's `AudioSubsystem` then dispatches each event.
 *
 * V1 node set: Output, Source, Mixer, Random, Modulator, Loop, Delay.
 * V2+ additions: Switch/Branch, Crossfade, Attenuation preset reference.
 */

import { AUDIO_BUS_IDS, type AudioBusId } from "./audioBus";

/** A cue's output routes to one of the engine's mix buses (see `audioBus.ts`). */
export const SOUND_CUE_BUS_IDS = AUDIO_BUS_IDS;
export type SoundCueBusId = AudioBusId;

export const SOUND_CUE_NODE_KINDS = [
  "output",
  "source",
  "mixer",
  "random",
  "modulator",
  "loop",
  "delay",
] as const;
export type SoundCueNodeKind = (typeof SOUND_CUE_NODE_KINDS)[number];

/** Terminal node — the graph's audio output. Exactly one per cue. */
export interface SoundCueOutputNode {
  id: string;
  kind: "output";
  volume?: number;
  pitch?: number;
}

/** Plays a single raw audio clip. Leaf node. */
export interface SoundCueSourceNode {
  id: string;
  kind: "source";
  clipId: string;
  loop?: boolean;
  volume?: number;
  pitch?: number;
}

/** Mixes all connected inputs simultaneously (each at the same volume scale). */
export interface SoundCueMixerNode {
  id: string;
  kind: "mixer";
}

/**
 * Picks exactly one connected input at random.
 * `weights` must match the number of incoming connections (equal weight if absent).
 * `withoutReplacement` is a hint for successive plays (stored, not yet enforced at runtime).
 */
export interface SoundCueRandomNode {
  id: string;
  kind: "random";
  weights?: number[];
  withoutReplacement?: boolean;
}

/** Randomises volume and/or pitch each time the cue triggers. */
export interface SoundCueModulatorNode {
  id: string;
  kind: "modulator";
  volumeMin?: number;
  volumeMax?: number;
  pitchMin?: number;
  pitchMax?: number;
}

/** Forces all downstream source nodes to loop. */
export interface SoundCueLoopNode {
  id: string;
  kind: "loop";
}

/** Delays downstream play events by a random amount in [secondsMin, secondsMax]. */
export interface SoundCueDelayNode {
  id: string;
  kind: "delay";
  secondsMin?: number;
  secondsMax?: number;
}

export type SoundCueNode =
  | SoundCueOutputNode
  | SoundCueSourceNode
  | SoundCueMixerNode
  | SoundCueRandomNode
  | SoundCueModulatorNode
  | SoundCueLoopNode
  | SoundCueDelayNode;

/** Directed edge: audio flows FROM `from` TO `to` (source → output direction). */
export interface SoundCueConnection {
  from: string;
  to: string;
}

/** Top-level output properties (bus routing, overall gain). */
export interface SoundCueOutput {
  volume?: number;
  pitch?: number;
  bus?: SoundCueBusId;
}

/** The serialised form of a `*.soundcue.json` asset (schema v1). */
export interface SoundCueAsset {
  schema: 1;
  type: "soundCue";
  name: string;
  output: SoundCueOutput;
  nodes: SoundCueNode[];
  connections: SoundCueConnection[];
}

/** Position hint stored per-node for the graph editor canvas. */
export interface SoundCueNodePosition {
  id: string;
  x: number;
  y: number;
}
