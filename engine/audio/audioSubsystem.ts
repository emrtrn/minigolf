import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import {
  DEFAULT_AUDIO_CLIP_MANIFEST,
  audioClipById,
  type AudioClipManifest,
} from "../assets/audio";
import {
  AUDIO_BUS_IDS,
  DEFAULT_AUDIO_BUS,
  createDefaultBusVolumes,
  isAudioBusId,
  mergeMixSnapshot,
  normalizeBusVolume,
  type AudioBusId,
  type BusMixSnapshot,
  type BusVolumes,
} from "./audioBus";

export const AUDIO_SUBSYSTEM_ID = "audio";
export type AudioBackend = "none" | "web-audio";

export type AudioVec3 = readonly [number, number, number];

export interface AudioPlayOptions {
  volume?: number;
  loop?: boolean;
  spatial?: boolean;
  pitch?: number;
  /** Emitter world position; routes a spatial sound through a `PannerNode`. */
  position?: AudioVec3;
  /** Distance at which spatial attenuation begins. Default {@link DEFAULT_SPATIAL_ATTENUATION}. */
  refDistance?: number;
  /** Distance past which a spatial sound no longer attenuates. */
  maxDistance?: number;
  /** Spatial attenuation rolloff factor (higher = quieter sooner). */
  rolloff?: number;
  /** Mix bus this play routes through. Defaults to {@link DEFAULT_AUDIO_BUS}. */
  bus?: AudioBusId;
}

/** Resolved sphere-attenuation parameters for a spatial `PannerNode`. */
export interface SpatialPannerConfig {
  readonly refDistance: number;
  readonly maxDistance: number;
  readonly rolloff: number;
}

/** Default sphere attenuation: full volume within 4 units, silent past 60. */
export const DEFAULT_SPATIAL_ATTENUATION: SpatialPannerConfig = {
  refDistance: 4,
  maxDistance: 60,
  rolloff: 1,
};

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Resolves a spatial play's attenuation parameters, clamping to positive values
 * and guaranteeing `maxDistance > refDistance` (an inverted/equal pair would make
 * the PannerNode silent or NaN). Pure: unit-tested without a Web Audio context.
 */
export function resolveSpatialPannerConfig(options: AudioPlayOptions): SpatialPannerConfig {
  const refDistance = positiveOr(options.refDistance, DEFAULT_SPATIAL_ATTENUATION.refDistance);
  const maxCandidate = positiveOr(options.maxDistance, DEFAULT_SPATIAL_ATTENUATION.maxDistance);
  return {
    refDistance,
    maxDistance: Math.max(maxCandidate, refDistance + 1),
    rolloff: positiveOr(options.rolloff, DEFAULT_SPATIAL_ATTENUATION.rolloff),
  };
}

export interface AudioPlayRequest extends AudioPlayOptions {
  clipId: string;
}

export interface AudioPlaybackHandle {
  readonly clipId: string;
  readonly stopped: boolean;
  readonly volume: number;
  readonly pitch: number;
  stop(fadeSeconds?: number): void;
  setVolume(value: number, fadeSeconds?: number): void;
  setPitch(value: number): void;
}

export interface AudioBus {
  playOneShot(clipId: string, options?: AudioPlayOptions): void;
  play(clipId: string, options?: AudioPlayOptions): AudioPlaybackHandle;
}

export interface AudioSubsystemOptions {
  backend?: AudioBackend;
  clips?: AudioClipManifest;
  /**
   * Resolves a `clipId` that is not a built-in tone clip to a fetchable audio
   * file URL (e.g. a manifest `sound` asset). Returning null skips playback.
   * Injected by the host so the engine layer stays manifest-agnostic.
   */
  resolveClipUrl?: (clipId: string) => string | null;
}

type BrowserAudioContext = AudioContext;

type AudioSourceNode = AudioBufferSourceNode | OscillatorNode;

class RuntimeAudioPlaybackHandle implements AudioPlaybackHandle {
  readonly clipId: string;
  private source: AudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private context: BrowserAudioContext | null = null;
  private sourceBaseRate = 1;
  private stoppedInternal = false;
  private volumeInternal: number;
  private pitchInternal: number;

  constructor(
    clipId: string,
    options: AudioPlayOptions = {},
    private readonly onStop: (handle: RuntimeAudioPlaybackHandle) => void = () => undefined,
  ) {
    this.clipId = clipId;
    this.volumeInternal = sanitizeVolume(options.volume);
    this.pitchInternal = sanitizePitch(options.pitch);
  }

  get stopped(): boolean {
    return this.stoppedInternal;
  }

  get volume(): number {
    return this.volumeInternal;
  }

  get pitch(): number {
    return this.pitchInternal;
  }

  attach(context: BrowserAudioContext, source: AudioSourceNode, gain: GainNode): void {
    this.context = context;
    this.source = source;
    this.gain = gain;
    this.sourceBaseRate = sourcePitchBase(source);
    applySourcePitch(source, this.pitchInternal, this.sourceBaseRate);
    gain.gain.value = this.volumeInternal;
    source.onended = () => this.finish();
    if (this.stoppedInternal) this.stop(0);
  }

  stop(fadeSeconds = 0): void {
    this.finish();
    const source = this.source;
    const gain = this.gain;
    const context = this.context;
    if (!source || !context) return;

    const now = context.currentTime;
    const fade = Math.max(0, fadeSeconds);
    const stopTime = fade > 0 ? now + fade : now;
    if (gain) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (fade > 0) gain.gain.linearRampToValueAtTime(0, stopTime);
      else gain.gain.setValueAtTime(0, now);
    }
    try {
      source.stop(stopTime);
    } catch {
      // Web Audio throws if a source was already stopped; handles are idempotent.
    }
  }

  setVolume(value: number, fadeSeconds = 0): void {
    const next = sanitizeVolume(value);
    this.volumeInternal = next;
    const gain = this.gain;
    const context = this.context;
    if (!gain || !context || this.stoppedInternal) return;

    const now = context.currentTime;
    const fade = Math.max(0, fadeSeconds);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    if (fade > 0) gain.gain.linearRampToValueAtTime(next, now + fade);
    else gain.gain.setValueAtTime(next, now);
  }

  setPitch(value: number): void {
    this.pitchInternal = sanitizePitch(value);
    if (this.source) applySourcePitch(this.source, this.pitchInternal, this.sourceBaseRate);
  }

  private finish(): void {
    if (this.stoppedInternal) return;
    this.stoppedInternal = true;
    this.onStop(this);
  }
}

function sanitizeVolume(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 1;
}

function sanitizePitch(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function sourcePitchBase(source: AudioSourceNode): number {
  if ("playbackRate" in source) return source.playbackRate.value;
  return source.frequency.value;
}

function applySourcePitch(source: AudioSourceNode, pitch: number, base: number): void {
  if ("playbackRate" in source) source.playbackRate.value = base * pitch;
  else source.frequency.value = base * pitch;
}

/**
 * Writes a 3-vector to a Web Audio `positionX/Y/Z` (or `forwardX/Y/Z`) AudioParam
 * trio when the browser exposes them, else calls the deprecated `setPosition`/
 * `setOrientation` fallback. Keeps spatial audio working across browser versions.
 */
function setAudioVec3(
  context: BrowserAudioContext,
  x: AudioParam | undefined,
  y: AudioParam | undefined,
  z: AudioParam | undefined,
  value: AudioVec3,
  fallback: () => void,
): void {
  if (x && y && z) {
    const t = context.currentTime;
    x.setValueAtTime(value[0], t);
    y.setValueAtTime(value[1], t);
    z.setValueAtTime(value[2], t);
  } else {
    fallback();
  }
}

export class AudioSubsystem implements Subsystem, AudioBus {
  readonly id = AUDIO_SUBSYSTEM_ID;
  private readonly backend: AudioBackend;
  private readonly clips: AudioClipManifest;
  private readonly resolveClipUrl?: (clipId: string) => string | null;
  private context: BrowserAudioContext | null = null;
  private pending: Array<{ request: AudioPlayRequest; handle: RuntimeAudioPlaybackHandle }> = [];
  private readonly active = new Set<RuntimeAudioPlaybackHandle>();
  private played: AudioPlayRequest[] = [];
  /** Decoded audio buffers keyed by URL; promise-cached so each file loads once. */
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** Latest listener pose (camera), applied to the context once it exists. */
  private listenerPosition: AudioVec3 | null = null;
  private listenerForward: AudioVec3 = [0, 0, -1];
  /** Linear gain per mix bus; the source of truth, mirrored onto live GainNodes. */
  private readonly busVolumes: BusVolumes = createDefaultBusVolumes();
  /** Live bus GainNodes, created lazily with the context (`master` → destination). */
  private busNodes: Map<AudioBusId, GainNode> | null = null;

  constructor(options: AudioSubsystemOptions = {}) {
    this.backend = options.backend ?? "none";
    this.clips = options.clips ?? DEFAULT_AUDIO_CLIP_MANIFEST;
    if (options.resolveClipUrl) this.resolveClipUrl = options.resolveClipUrl;
  }

  /**
   * Resumes the audio context (browser autoplay policies suspend it until a user
   * gesture). The host should call this on the first pointer/key input so
   * auto-played ambient cues queued at scene load begin sounding.
   */
  resumeContext(): void {
    void this.context?.resume().catch(() => undefined);
  }

  /**
   * Updates the spatial-audio listener (the runtime camera/player). Stored and
   * applied to the Web Audio listener whenever the context exists, so the host
   * can call it every frame; a no-op for the `none` backend.
   */
  setListenerPose(position: AudioVec3, forward: AudioVec3): void {
    this.listenerPosition = position;
    this.listenerForward = forward;
    if (this.context) this.applyListener(this.context);
  }

  /** Current linear gain of a mix bus (headless-safe; reads the stored table). */
  getBusVolume(bus: AudioBusId): number {
    return this.busVolumes[bus];
  }

  /**
   * Sets a mix bus's linear gain, optionally ramping a live GainNode over
   * `fadeSeconds`. Stored even with no context so the value applies once a bus
   * graph is built. Non-finite/negative values clamp to a sane gain.
   */
  setBusVolume(bus: AudioBusId, value: number, fadeSeconds = 0): void {
    const next = normalizeBusVolume(value);
    this.busVolumes[bus] = next;
    const node = this.busNodes?.get(bus);
    const context = this.context;
    if (!node || !context) return;
    const now = context.currentTime;
    const fade = Math.max(0, fadeSeconds);
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    if (fade > 0) node.gain.linearRampToValueAtTime(next, now + fade);
    else node.gain.setValueAtTime(next, now);
  }

  /** Applies a partial mix snapshot (e.g. a pause/menu duck) to several buses. */
  applyMixSnapshot(snapshot: BusMixSnapshot, fadeSeconds = 0): void {
    const next = mergeMixSnapshot(this.busVolumes, snapshot);
    for (const id of AUDIO_BUS_IDS) {
      if (next[id] !== this.busVolumes[id]) this.setBusVolume(id, next[id], fadeSeconds);
    }
  }

  /** Restores every bus to unity gain (the default mix). */
  resetMix(fadeSeconds = 0): void {
    for (const id of AUDIO_BUS_IDS) this.setBusVolume(id, 1, fadeSeconds);
  }

  /**
   * Builds the bus gain graph once per context: `master` → destination, then
   * music/sfx/ui/ambience → master. Each node starts at its stored bus volume so
   * a mix set before the context existed is preserved.
   */
  private ensureBusGraph(context: BrowserAudioContext): Map<AudioBusId, GainNode> {
    if (this.busNodes) return this.busNodes;
    const nodes = new Map<AudioBusId, GainNode>();
    for (const id of AUDIO_BUS_IDS) {
      const gain = context.createGain();
      gain.gain.value = this.busVolumes[id];
      nodes.set(id, gain);
    }
    const master = nodes.get("master")!;
    master.connect(context.destination);
    for (const id of AUDIO_BUS_IDS) {
      if (id !== "master") nodes.get(id)!.connect(master);
    }
    this.busNodes = nodes;
    return nodes;
  }

  private applyListener(context: BrowserAudioContext): void {
    const position = this.listenerPosition;
    if (!position) return;
    const listener = context.listener;
    setAudioVec3(context, listener.positionX, listener.positionY, listener.positionZ, position, () =>
      listener.setPosition?.(position[0], position[1], position[2]),
    );
    const f = this.listenerForward;
    setAudioVec3(context, listener.forwardX, listener.forwardY, listener.forwardZ, f, () =>
      listener.setOrientation?.(f[0], f[1], f[2], 0, 1, 0),
    );
  }

  /** Resolves the bus GainNode a request routes into (building the graph if new). */
  private busOutput(context: BrowserAudioContext, request: AudioPlayRequest): GainNode {
    const nodes = this.ensureBusGraph(context);
    const bus = request.bus && isAudioBusId(request.bus) ? request.bus : DEFAULT_AUDIO_BUS;
    return nodes.get(bus) ?? nodes.get("master")!;
  }

  /**
   * Connects a play's gain to its mix bus. Spatial plays with a position route
   * through a `PannerNode` (sphere attenuation) first; everything else feeds the
   * bus directly. The bus graph chains to the destination.
   */
  private connectSpatialOutput(
    context: BrowserAudioContext,
    gain: GainNode,
    request: AudioPlayRequest,
  ): void {
    const output = this.busOutput(context, request);
    if (!request.spatial || !request.position) {
      gain.connect(output);
      return;
    }
    const panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    const config = resolveSpatialPannerConfig(request);
    panner.refDistance = config.refDistance;
    panner.maxDistance = config.maxDistance;
    panner.rolloffFactor = config.rolloff;
    const p = request.position;
    setAudioVec3(context, panner.positionX, panner.positionY, panner.positionZ, p, () =>
      panner.setPosition?.(p[0], p[1], p[2]),
    );
    gain.connect(panner);
    panner.connect(output);
  }

  playOneShot(clipId: string, options: AudioPlayOptions = {}): void {
    this.play(clipId, options);
  }

  play(clipId: string, options: AudioPlayOptions = {}): AudioPlaybackHandle {
    const request = { clipId, ...options };
    const handle = new RuntimeAudioPlaybackHandle(clipId, options, (stopped) => {
      this.active.delete(stopped);
    });
    this.active.add(handle);
    this.pending.push({ request, handle });
    return handle;
  }

  playedRequests(): readonly AudioPlayRequest[] {
    return this.played;
  }

  update(_context: EngineUpdateContext): void {
    const requests = this.pending;
    this.pending = [];
    for (const { request, handle } of requests) {
      if (handle.stopped) {
        this.active.delete(handle);
        continue;
      }
      this.played.push(request);
      if (this.backend === "web-audio") {
        // A failed clip (bad node param, decode error, etc.) must never throw out
        // of the per-frame update and kill the engine loop.
        try {
          this.playWebAudio(request, handle);
        } catch (error) {
          console.error(`[audio] playback failed for "${request.clipId}":`, error);
          handle.stop();
        }
      } else if (!request.loop) handle.stop();
    }
  }

  dispose(): void {
    for (const { handle } of this.pending) handle.stop();
    this.pending = [];
    for (const handle of this.active) handle.stop();
    this.active.clear();
    this.played = [];
    this.buffers.clear();
    this.busNodes = null;
    void this.context?.close();
    this.context = null;
  }

  private playWebAudio(
    request: AudioPlayRequest,
    handle: RuntimeAudioPlaybackHandle,
  ): void {
    const context = this.audioContext();
    if (!context) {
      handle.stop();
      return;
    }
    void context.resume().catch(() => undefined);

    // Built-in synthesized tone clips (e.g. the collision chime).
    const tone = audioClipById(this.clips, request.clipId);
    if (tone && tone.type === "tone") {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.frequency.value = tone.frequencyHz;
      oscillator.connect(gain);
      this.connectSpatialOutput(context, gain, request);
      handle.attach(context, oscillator, gain);
      if (handle.stopped) return;
      oscillator.start(now);
      oscillator.stop(now + tone.durationSeconds);
      return;
    }

    // Otherwise resolve the clip id to a fetchable audio file (manifest sound).
    const url = this.resolveClipUrl?.(request.clipId) ?? null;
    if (url) void this.playFile(context, url, request, handle);
    else handle.stop();
  }

  private async playFile(
    context: BrowserAudioContext,
    url: string,
    request: AudioPlayRequest,
    handle: RuntimeAudioPlaybackHandle,
  ): Promise<void> {
    const buffer = await this.loadBuffer(context, url);
    if (!buffer || handle.stopped) {
      if (!buffer) handle.stop();
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = request.loop ?? false;
    const gain = context.createGain();
    source.connect(gain);
    this.connectSpatialOutput(context, gain, request);
    handle.attach(context, source, gain);
    if (handle.stopped) return;
    source.start();
  }

  private loadBuffer(context: BrowserAudioContext, url: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(url, pending);
    }
    return pending;
  }

  private audioContext(): BrowserAudioContext | null {
    if (this.context) return this.context;
    const ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!ctor) return null;
    this.context = new ctor();
    this.applyListener(this.context);
    return this.context;
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }

  var webkitAudioContext: typeof AudioContext | undefined;
}
