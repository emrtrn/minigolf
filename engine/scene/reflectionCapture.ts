import type { LayoutSphereReflectionCapture, Vec3 } from "./layout";

/**
 * Render-agnostic Sphere Reflection Capture model: resolved settings + defaults,
 * shared by the editor view-models, the save validator, and the three.js render
 * binding (`engine/render-three/reflectionCapture.ts`). Kept free of three.js so
 * editor core and the validator can read it without pulling in the renderer.
 *
 * The web/three counterpart to Unreal's **Sphere Reflection Capture**: a placed
 * probe that bakes a static local cubemap from its own position. Surfaces within
 * the probe's `radius` sample this local capture instead of the global Reflection
 * Environment. Unlike the Planar Reflection it is not re-rendered every frame —
 * the capture is baked once and cached. There can be many, each positioned in the
 * world; the influence size is the `radius`, not a transform scale. Faz 1 models
 * only the placed actor + influence sphere; per-probe bake + nearest-probe envMap
 * arrive in later phases.
 */
export interface ResolvedSphereReflectionCapture {
  name: string;
  hidden: boolean;
  /** Influence radius in world units. */
  radius: number;
  /** Reflection strength multiplier applied to the captured cubemap. */
  intensity: number;
  /** Baked cubemap face resolution in px. */
  resolution: number;
  /** CubeCamera near clip used when baking. */
  near: number;
  /** CubeCamera far clip used when baking. */
  far: number;
  /** Local sphere parallax correction for covered surfaces (Faz 4); default off. */
  parallax: boolean;
  /** Overlap tie-breaker: higher priority wins when two probes both cover a surface. */
  priority: number;
}

export const SPHERE_REFLECTION_CAPTURE_DEFAULTS: ResolvedSphereReflectionCapture = {
  name: "Sphere Reflection Capture",
  hidden: false,
  radius: 5,
  intensity: 1,
  resolution: 256,
  near: 0.1,
  far: 100,
  parallax: false,
  priority: 0,
};

/** Fills every Sphere Reflection Capture field with its default, decoupled from the layout. */
export function resolveSphereReflectionCapture(
  actor: LayoutSphereReflectionCapture | null | undefined,
): ResolvedSphereReflectionCapture {
  const defaults = SPHERE_REFLECTION_CAPTURE_DEFAULTS;
  if (!actor) return { ...defaults };
  return {
    name: actor.name ?? defaults.name,
    hidden: actor.hidden ?? defaults.hidden,
    radius: actor.radius ?? defaults.radius,
    intensity: actor.intensity ?? defaults.intensity,
    resolution: actor.resolution ?? defaults.resolution,
    near: actor.near ?? defaults.near,
    far: actor.far ?? defaults.far,
    parallax: actor.parallax ?? defaults.parallax,
    priority: actor.priority ?? defaults.priority,
  };
}

/** A stable, collision-free id for a new capture (`reflection-capture-<n>`). */
export function uniqueSphereReflectionCaptureId(
  captures: LayoutSphereReflectionCapture[],
): string {
  const existing = new Set(captures.map((capture) => capture.id));
  let index = 1;
  while (existing.has(`reflection-capture-${index}`)) index += 1;
  return `reflection-capture-${index}`;
}

/**
 * A probe candidate for nearest-probe selection: its world position + influence
 * radius + overlap priority. Render-agnostic so the selection algorithm can be
 * unit-tested and shared by the editor + runtime envMap-assignment passes.
 */
export interface ReflectionCaptureProbe {
  position: Vec3;
  radius: number;
  priority: number;
}

/**
 * Picks the probe that should light `point`, returning its index in `probes` (or
 * null when no probe reaches the point). A probe covers the point only when its
 * `score = distance / radius` is `<= 1`. Among covering probes the precedence is
 * Unreal-style: explicit `priority` (higher wins) first, then the smaller `radius`
 * — a smaller, more-local capture overrides a larger one even when the larger one
 * is more centered — then the lower `score` (more centered), then earlier array
 * order (layout order). Callers pass only eligible probes (visible + baked);
 * hidden/unbaked probes are excluded upstream.
 */
export function selectNearestReflectionCapture(
  point: Vec3,
  probes: readonly ReflectionCaptureProbe[],
): number | null {
  let bestIndex: number | null = null;
  let bestScore = Infinity;
  let bestPriority = -Infinity;
  let bestRadius = Infinity;
  for (let index = 0; index < probes.length; index += 1) {
    const probe = probes[index]!;
    if (probe.radius <= 0) continue;
    const dx = point[0] - probe.position[0];
    const dy = point[1] - probe.position[1];
    const dz = point[2] - probe.position[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const score = distance / probe.radius;
    if (score > 1) continue;
    // Precedence among covering probes: higher priority, then smaller radius
    // (small-probe override), then lower score, then earlier order (strict
    // comparisons + in-order iteration keep the first of equal probes).
    const better =
      probe.priority > bestPriority ||
      (probe.priority === bestPriority &&
        (probe.radius < bestRadius ||
          (probe.radius === bestRadius && score < bestScore)));
    if (better) {
      bestIndex = index;
      bestScore = score;
      bestPriority = probe.priority;
      bestRadius = probe.radius;
    }
  }
  return bestIndex;
}

/** A unique display name for a new capture, suffixing on collision. */
export function uniqueSphereReflectionCaptureName(
  baseName: string,
  captures: LayoutSphereReflectionCapture[],
): string {
  const existing = new Set(captures.map((capture) => capture.name ?? capture.id));
  if (!existing.has(baseName)) return baseName;
  let index = 2;
  while (existing.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}
