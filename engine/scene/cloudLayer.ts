import type { LayoutCloudLayer } from "./layout";

/**
 * Render-agnostic Static Cloud Layer model: resolved settings + defaults, shared
 * by the editor view-models and the three.js render binding
 * (`engine/render-three/cloudLayer.ts`). Kept free of three.js so editor core and
 * the save validator can read it without pulling in the renderer.
 *
 * Unlike Unreal's Volumetric Clouds this is **static, not volumetric**: a single
 * camera-following dome backdrop whose cloud cover is painted by a procedural fBm
 * noise shader (no raymarching, no textures). It pairs with the Sky Atmosphere
 * backdrop. `speed` drives an optional gentle UV drift; the default `0` keeps the
 * clouds completely frozen.
 */
export interface ResolvedCloudLayer {
  name: string;
  hidden: boolean;
  /** Cloud tint (hex `#rrggbb`). */
  color: string;
  /** Fraction of the sky covered by cloud (0 = clear, 1 = overcast). */
  coverage: number;
  /** Overall cloud opacity (0 = invisible, 1 = solid). */
  density: number;
  /** Edge feathering of the cloud shapes (0 = hard edges, 1 = very soft). */
  softness: number;
  /** Feature size of the noise — larger = bigger, broader cloud masses. */
  scale: number;
  /** Drift speed (wind). 0 keeps the clouds static; higher gently scrolls them. */
  speed: number;
}

export const CLOUD_LAYER_DEFAULTS: ResolvedCloudLayer = {
  name: "Cloud Layer",
  hidden: false,
  color: "#ffffff",
  coverage: 0.5,
  density: 0.85,
  softness: 0.3,
  scale: 2,
  speed: 0,
};

/** Fills every Cloud Layer field with its default, decoupled from the layout. */
export function resolveCloudLayer(
  actor: LayoutCloudLayer | null | undefined,
): ResolvedCloudLayer {
  const defaults = CLOUD_LAYER_DEFAULTS;
  if (!actor) return { ...defaults };
  return {
    name: actor.name ?? defaults.name,
    hidden: actor.hidden ?? defaults.hidden,
    color: actor.color ?? defaults.color,
    coverage: actor.coverage ?? defaults.coverage,
    density: actor.density ?? defaults.density,
    softness: actor.softness ?? defaults.softness,
    scale: actor.scale ?? defaults.scale,
    speed: actor.speed ?? defaults.speed,
  };
}
