/**
 * Audio Bus Lite — the pure, headless data model for Forge's mix buses.
 *
 * A bus is just a named gain stage. The runtime topology (built lazily in
 * `audioSubsystem.ts` once a Web Audio context exists) is:
 *
 *   destination ← master ← { music, sfx, ui, ambience }
 *
 * Every play routes its gain into one bus; non-master buses feed `master`, so a
 * play's effective level is `playGain × busVolume × masterVolume`. A *mix
 * snapshot* is a partial set of target bus volumes (e.g. a pause/menu duck that
 * lowers music + ambience while leaving `ui` alone).
 *
 * This module owns no Web Audio objects so it can be unit-tested on node and
 * imported by pure consumers (e.g. `soundCueTypes.ts`) without pulling in the
 * audio runtime.
 */

export const AUDIO_BUS_IDS = ["master", "music", "sfx", "ui", "ambience"] as const;
export type AudioBusId = (typeof AUDIO_BUS_IDS)[number];

/** Plays with no explicit bus route straight to `master`. */
export const DEFAULT_AUDIO_BUS: AudioBusId = "master";

/** A partial set of bus → target-volume overrides applied as one mix change. */
export type BusMixSnapshot = Partial<Record<AudioBusId, number>>;

/** A bus volume table: every bus mapped to its current linear gain. */
export type BusVolumes = Record<AudioBusId, number>;

export function isAudioBusId(value: unknown): value is AudioBusId {
  return typeof value === "string" && (AUDIO_BUS_IDS as readonly string[]).includes(value);
}

/** Clamps a bus volume to a finite, non-negative number; defaults to 1. */
export function normalizeBusVolume(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 1;
}

/** A fresh table with every bus at unity gain. */
export function createDefaultBusVolumes(): BusVolumes {
  const volumes = {} as BusVolumes;
  for (const id of AUDIO_BUS_IDS) volumes[id] = 1;
  return volumes;
}

/**
 * The effective gain multiplier a play on `bus` receives, accounting for the
 * bus feeding `master`. `master` is the root, so it only counts its own volume.
 */
export function effectiveBusGain(volumes: BusVolumes, bus: AudioBusId): number {
  const master = normalizeBusVolume(volumes.master);
  if (bus === "master") return master;
  return normalizeBusVolume(volumes[bus]) * master;
}

/**
 * Returns a new volume table with the snapshot's overrides applied (normalized).
 * Buses absent from the snapshot keep their current value. Pure — the live
 * subsystem mirrors this onto its GainNodes.
 */
export function mergeMixSnapshot(volumes: BusVolumes, snapshot: BusMixSnapshot): BusVolumes {
  const next: BusVolumes = { ...volumes };
  for (const id of AUDIO_BUS_IDS) {
    const override = snapshot[id];
    if (override !== undefined) next[id] = normalizeBusVolume(override);
  }
  return next;
}

/**
 * Example duck for a paused/menu state: pull music + ambience well down and trim
 * sfx, but leave `ui` (and `master`) at full so menu clicks stay crisp. Apply on
 * pause, restore with {@link createDefaultBusVolumes} (or a stored snapshot) on
 * resume.
 */
export const MENU_DUCK_MIX: BusMixSnapshot = {
  music: 0.25,
  ambience: 0.3,
  sfx: 0.5,
};
