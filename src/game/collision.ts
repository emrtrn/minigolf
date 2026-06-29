/**
 * Pure, headless-testable collision response: resolve a proposed horizontal move
 * against static collider AABBs so the player cannot walk through walls and
 * slides along them instead. No Three.js, DOM, or physics-engine dependency —
 * the player behavior (src/game/behaviors.ts) feeds it the AABBs the physics
 * subsystem already derives.
 *
 * Movement is resolved on the XZ plane (vertical motion is G2's floor clamp). A
 * blocker only blocks when it overlaps the player's vertical span, so the player
 * can jump over short obstacles. The X and Z axes are resolved separately, which
 * yields wall sliding: a diagonal move into an X-facing wall keeps its Z
 * component.
 *
 * Only *new* penetration caused by this move is resolved — a blocker the player
 * already overlaps on an axis is left alone. That keeps the ground/platform the
 * player stands inside (its collider AABB) from freezing horizontal movement,
 * and avoids snapping out of pre-existing overlaps.
 */

export interface Aabb3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface PlanarDelta {
  readonly dx: number;
  readonly dz: number;
}

export interface GroundProbeOptions {
  /** Half-size of the character footprint on X/Z. */
  readonly footprintHalf: readonly [number, number];
  /** Maximum surface height the character can step up to while grounded. */
  readonly maxStepUp: number;
  /** Small downward snap distance for walking down shallow steps without falling. */
  readonly maxStepDown: number;
}

export interface GroundHit {
  /** The character root/feet Y that rests on this surface. */
  readonly floorY: number;
  readonly blocker: Aabb3;
}

/** Half-open interval overlap: touching edges (equal) do not count, so a flush slide is allowed. */
function overlaps(minA: number, maxA: number, minB: number, maxB: number): boolean {
  return minA < maxB && maxA > minB;
}

/**
 * Returns the proposed `delta` clamped so the player's AABB (centered at
 * `position`, with `half` extents) does not enter any blocker. Each axis is
 * resolved independently against the blockers whose vertical span overlaps the
 * player's, pushing the moved edge flush against the nearest blocker.
 */
export function resolvePlanarMovement(
  position: readonly [number, number, number],
  delta: PlanarDelta,
  half: readonly [number, number, number],
  blockers: readonly Aabb3[],
): PlanarDelta {
  const [px, py, pz] = position;
  const [hx, hy, hz] = half;

  // Only blockers overlapping the player's vertical span can block this move.
  const active = blockers.filter((b) => overlaps(py - hy, py + hy, b.min[1], b.max[1]));

  // Resolve X against the player's current Z span.
  let x = px + delta.dx;
  for (const b of active) {
    if (!overlaps(pz - hz, pz + hz, b.min[2], b.max[2])) continue;
    if (overlaps(px - hx, px + hx, b.min[0], b.max[0])) continue; // already inside on X: not new
    if (!overlaps(x - hx, x + hx, b.min[0], b.max[0])) continue;
    if (delta.dx > 0) x = Math.min(x, b.min[0] - hx);
    else if (delta.dx < 0) x = Math.max(x, b.max[0] + hx);
  }

  // Resolve Z against the now-resolved X span (so blocking X still lets Z slide).
  let z = pz + delta.dz;
  for (const b of active) {
    if (!overlaps(x - hx, x + hx, b.min[0], b.max[0])) continue;
    if (overlaps(pz - hz, pz + hz, b.min[2], b.max[2])) continue; // already inside on Z: not new
    if (!overlaps(z - hz, z + hz, b.min[2], b.max[2])) continue;
    if (delta.dz > 0) z = Math.min(z, b.min[2] - hz);
    else if (delta.dz < 0) z = Math.max(z, b.max[2] + hz);
  }

  return { dx: x - px, dz: z - pz };
}

export function filterWalkableBlockers(
  footY: number,
  blockers: readonly Aabb3[],
  maxStepUp: number,
): Aabb3[] {
  const stepTop = footY + Math.max(0, maxStepUp);
  return blockers.filter((blocker) => blocker.max[1] > stepTop);
}

export function findGroundAt(
  position: readonly [number, number, number],
  blockers: readonly Aabb3[],
  options: GroundProbeOptions,
): GroundHit | null {
  const [px, py, pz] = position;
  const [hx, hz] = options.footprintHalf;
  const minY = py - Math.max(0, options.maxStepDown);
  const maxY = py + Math.max(0, options.maxStepUp);
  return highestWalkableSurface(
    blockers,
    px,
    pz,
    hx,
    hz,
    (top) => top >= minY && top <= maxY,
  );
}

export function findLandingGround(
  previousFootY: number,
  nextFootY: number,
  position: readonly [number, number, number],
  blockers: readonly Aabb3[],
  options: GroundProbeOptions,
): GroundHit | null {
  if (nextFootY > previousFootY) return null;
  const [px, , pz] = position;
  const [hx, hz] = options.footprintHalf;
  return highestWalkableSurface(
    blockers,
    px,
    pz,
    hx,
    hz,
    (top) => top <= previousFootY && top >= nextFootY,
  );
}

function highestWalkableSurface(
  blockers: readonly Aabb3[],
  px: number,
  pz: number,
  hx: number,
  hz: number,
  acceptsTop: (top: number) => boolean,
): GroundHit | null {
  let best: GroundHit | null = null;
  for (const blocker of blockers) {
    if (!overlaps(px - hx, px + hx, blocker.min[0], blocker.max[0])) continue;
    if (!overlaps(pz - hz, pz + hz, blocker.min[2], blocker.max[2])) continue;
    const top = blocker.max[1];
    if (!acceptsTop(top)) continue;
    if (!best || top > best.floorY) best = { floorY: top, blocker };
  }
  return best;
}
