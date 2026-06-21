import type { LayoutSkyAtmosphere } from "./layout";

/**
 * Render-agnostic Sky Atmosphere model: resolved scattering settings + defaults,
 * shared by the editor view-models and the three.js render binding
 * (`engine/render-three/skyAtmosphere.ts`). Kept free of three.js so editor core
 * and the save validator can read it without pulling in the renderer.
 *
 * The sun is NOT part of this model: like Unreal, the scene's directional Sun
 * light is the source of truth for the sun direction (the sky reads its rotation
 * at render time). Scattering/exposure live here, plus the Sky Atmosphere-owned
 * global sky-light capture settings used as the PBR reflection fallback.
 */
export interface ResolvedSkyLightCapture {
  /** Reflection + ambient bounce strength (maps to `scene.environmentIntensity`). */
  intensity: number;
}

export interface ResolvedSkyAtmosphere {
  name: string;
  hidden: boolean;
  rayleigh: number;
  turbidity: number;
  mie: number;
  mieDirectionalG: number;
  exposure: number;
  skyLightCapture: ResolvedSkyLightCapture;
}

export const SKY_ATMOSPHERE_DEFAULTS: ResolvedSkyAtmosphere = {
  name: "Sky Atmosphere",
  hidden: false,
  rayleigh: 2,
  turbidity: 10,
  mie: 0.005,
  mieDirectionalG: 0.8,
  exposure: 1,
  skyLightCapture: {
    intensity: 1,
  },
};

/** Fills every Sky Atmosphere field with its default, decoupled from the layout. */
export function resolveSkyAtmosphere(
  actor: LayoutSkyAtmosphere | null | undefined,
): ResolvedSkyAtmosphere {
  const defaults = SKY_ATMOSPHERE_DEFAULTS;
  if (!actor) return { ...defaults, skyLightCapture: { ...defaults.skyLightCapture } };
  return {
    name: actor.name ?? defaults.name,
    hidden: actor.hidden ?? defaults.hidden,
    rayleigh: actor.rayleigh ?? defaults.rayleigh,
    turbidity: actor.turbidity ?? defaults.turbidity,
    mie: actor.mie ?? defaults.mie,
    mieDirectionalG: actor.mieDirectionalG ?? defaults.mieDirectionalG,
    exposure: actor.exposure ?? defaults.exposure,
    skyLightCapture: {
      intensity: actor.skyLightCapture?.intensity ?? defaults.skyLightCapture.intensity,
    },
  };
}
