/**
 * Pure mini golf ball physics core.
 *
 * The runtime shell owns rendering/input. This module owns deterministic arcade
 * rolling behavior that can be tested headlessly: putt impulse, friction,
 * slope acceleration, wall bounce, rest detection, cup capture, and simple
 * out-of-bounds reset.
 */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export interface MiniGolfAabb2 {
  readonly min: Vec2;
  readonly max: Vec2;
}

export interface MiniGolfWall {
  readonly bounds: MiniGolfAabb2;
  readonly restitution?: number;
}

export interface MiniGolfSurface {
  readonly bounds?: MiniGolfAabb2;
  /** Base surface height at `origin`; y is derived from this 2.5D plane. */
  readonly height?: number;
  /** Surface gradient as `[dY/dX, dY/dZ]`; positive X slope accelerates toward -X. */
  readonly slope?: Vec2;
  /**
   * Runtime-only height sampler for mesh-derived surfaces. Return `null` when
   * the point is outside the sampled surface so lower/default surfaces can win.
   */
  readonly heightAt?: (x: number, z: number) => number | null;
  /** Optional runtime-only gradient sampler matching `heightAt`. */
  readonly slopeAt?: (x: number, z: number) => Vec2 | null;
  readonly origin?: Vec2;
  /** Multiplier for the global rolling friction. */
  readonly friction?: number;
}

export interface MiniGolfCup {
  readonly center: Vec3;
  readonly radius: number;
  readonly captureSpeed: number;
}

export interface MiniGolfCourse {
  readonly bounds?: MiniGolfAabb2;
  readonly hazards?: readonly MiniGolfAabb2[];
  readonly walls?: readonly MiniGolfWall[];
  readonly surfaces?: readonly MiniGolfSurface[];
  readonly cup?: MiniGolfCup;
  readonly defaultSurface?: MiniGolfSurface;
}

export interface MiniGolfPhysicsConfig {
  readonly fixedTimeStep: number;
  readonly ballRadius: number;
  readonly maxPuttSpeed: number;
  readonly puttPowerExponent: number;
  readonly rollingFriction: number;
  readonly slopeGravity: number;
  readonly wallRestitution: number;
  readonly restSpeed: number;
  readonly restSlopeAcceleration: number;
}

export interface MiniGolfBallState {
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly resting: boolean;
  readonly inCup: boolean;
  readonly outOfBounds: boolean;
  readonly penaltyStrokes: number;
  readonly lastSafePos: Vec3;
}

export const DEFAULT_MINI_GOLF_PHYSICS: MiniGolfPhysicsConfig = {
  fixedTimeStep: 1 / 120,
  ballRadius: 0.16,
  maxPuttSpeed: 8,
  puttPowerExponent: 1.35,
  rollingFriction: 1.25,
  slopeGravity: 9.8,
  wallRestitution: 0.72,
  restSpeed: 0.035,
  restSlopeAcceleration: 0.02,
};

export function createMiniGolfBallState(pos: Vec3, vel: Vec3 = [0, 0, 0]): MiniGolfBallState {
  return {
    pos: [...pos] as unknown as Vec3,
    vel: [...vel] as unknown as Vec3,
    resting: planarSpeed(vel) <= DEFAULT_MINI_GOLF_PHYSICS.restSpeed,
    inCup: false,
    outOfBounds: false,
    penaltyStrokes: 0,
    lastSafePos: [...pos] as unknown as Vec3,
  };
}

export function applyMiniGolfPutt(
  state: MiniGolfBallState,
  direction: Vec2,
  normalizedPower: number,
  config: Partial<MiniGolfPhysicsConfig> = {},
): MiniGolfBallState {
  if (state.inCup) return state;
  const cfg = physicsConfig(config);
  const dir = normalize2(direction);
  const power = clamp(normalizedPower, 0, 1);
  const speed = cfg.maxPuttSpeed * Math.pow(power, cfg.puttPowerExponent);
  return {
    ...state,
    vel: [dir[0] * speed, 0, dir[1] * speed],
    resting: speed <= cfg.restSpeed,
    outOfBounds: false,
  };
}

export function stepMiniGolfBall(
  state: MiniGolfBallState,
  course: MiniGolfCourse,
  deltaSeconds: number,
  config: Partial<MiniGolfPhysicsConfig> = {},
): MiniGolfBallState {
  const cfg = physicsConfig(config);
  if (deltaSeconds <= 0 || state.inCup) return state;

  let next = { ...state, outOfBounds: false };
  let remaining = deltaSeconds;
  while (remaining > 0) {
    const dt = Math.min(cfg.fixedTimeStep, remaining);
    next = stepFixed(next, course, dt, cfg);
    remaining -= dt;
    if (next.inCup || next.outOfBounds) break;
  }
  return next;
}

export function planarSpeed(vel: Vec3): number {
  return Math.hypot(vel[0], vel[2]);
}

export function miniGolfSurfaceHeight(surface: MiniGolfSurface, x: number, z: number): number {
  const sampled = surface.heightAt?.(x, z);
  if (sampled !== null && sampled !== undefined && Number.isFinite(sampled)) return sampled;
  const [ox, oz] = surface.origin ?? [0, 0];
  const [sx, sz] = surface.slope ?? [0, 0];
  return (surface.height ?? 0) + sx * (x - ox) + sz * (z - oz);
}

/**
 * Samples the active course surface height at world coordinates. Returns the
 * local surface when one covers the point, otherwise the course default.
 */
export function miniGolfCourseSurfaceHeight(
  course: MiniGolfCourse,
  x: number,
  z: number,
): number {
  return miniGolfSurfaceHeight(surfaceAt(course, x, z), x, z);
}

function stepFixed(
  state: MiniGolfBallState,
  course: MiniGolfCourse,
  dt: number,
  cfg: MiniGolfPhysicsConfig,
): MiniGolfBallState {
  let [x, y, z] = state.pos;
  let vx = state.vel[0];
  let vz = state.vel[2];

  const surface = surfaceAt(course, x, z);
  const slope = miniGolfSurfaceSlope(surface, x, z);
  vx += -slope[0] * cfg.slopeGravity * dt;
  vz += -slope[1] * cfg.slopeGravity * dt;

  const friction = cfg.rollingFriction * Math.max(0, surface.friction ?? 1);
  [vx, vz] = applyFriction([vx, vz], friction, dt);

  x += vx * dt;
  z += vz * dt;
  y = miniGolfSurfaceHeight(surfaceAt(course, x, z), x, z);

  const collision = resolveWallCollisions(x, z, vx, vz, course.walls ?? [], cfg);
  x = collision.x;
  z = collision.z;
  vx = collision.vx;
  vz = collision.vz;

  if (isOutOfBounds(x, z, course)) {
    return {
      ...state,
      pos: state.lastSafePos,
      vel: [0, 0, 0],
      resting: true,
      inCup: false,
      outOfBounds: true,
      penaltyStrokes: state.penaltyStrokes + 1,
    };
  }

  const speed = Math.hypot(vx, vz);
  const cup = course.cup;
  if (cup && distance2([x, z], [cup.center[0], cup.center[2]]) <= cup.radius && speed <= cup.captureSpeed) {
    return {
      ...state,
      pos: cup.center,
      vel: [0, 0, 0],
      resting: true,
      inCup: true,
      outOfBounds: false,
      lastSafePos: cup.center,
    };
  }

  const slopeAcceleration = Math.hypot(slope[0] * cfg.slopeGravity, slope[1] * cfg.slopeGravity);
  const resting = speed <= cfg.restSpeed && slopeAcceleration <= cfg.restSlopeAcceleration;
  const pos: Vec3 = [x, y, z];
  return {
    ...state,
    pos,
    vel: resting ? [0, 0, 0] : [vx, 0, vz],
    resting,
    inCup: false,
    outOfBounds: false,
    lastSafePos: resting ? pos : state.lastSafePos,
  };
}

function physicsConfig(config: Partial<MiniGolfPhysicsConfig>): MiniGolfPhysicsConfig {
  return { ...DEFAULT_MINI_GOLF_PHYSICS, ...config };
}

function surfaceAt(course: MiniGolfCourse, x: number, z: number): MiniGolfSurface {
  const surfaces = course.surfaces ?? [];
  let best: { surface: MiniGolfSurface; height: number } | null = null;
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index]!;
    const height = sampledSurfaceHeight(surface, x, z);
    if (height === null) continue;
    if (!best || height >= best.height) best = { surface, height };
  }
  if (best) return best.surface;
  return course.defaultSurface ?? {};
}

function sampledSurfaceHeight(surface: MiniGolfSurface, x: number, z: number): number | null {
  if (surface.bounds && !containsAabb(surface.bounds, x, z)) return null;
  const sampled = surface.heightAt?.(x, z);
  if (sampled === null) return null;
  if (sampled !== undefined) return Number.isFinite(sampled) ? sampled : null;
  return miniGolfSurfaceHeight(surface, x, z);
}

function miniGolfSurfaceSlope(surface: MiniGolfSurface, x: number, z: number): Vec2 {
  const sampled = surface.slopeAt?.(x, z);
  if (sampled) return sampled;
  return surface.slope ?? [0, 0];
}

function resolveWallCollisions(
  x: number,
  z: number,
  vx: number,
  vz: number,
  walls: readonly MiniGolfWall[],
  cfg: MiniGolfPhysicsConfig,
): { x: number; z: number; vx: number; vz: number } {
  for (const wall of walls) {
    const hit = circleAabbHit(x, z, cfg.ballRadius, wall.bounds);
    if (!hit) continue;
    x += hit.nx * hit.penetration;
    z += hit.nz * hit.penetration;
    const normalVelocity = vx * hit.nx + vz * hit.nz;
    if (normalVelocity < 0) {
      const bounce = 1 + (wall.restitution ?? cfg.wallRestitution);
      vx -= bounce * normalVelocity * hit.nx;
      vz -= bounce * normalVelocity * hit.nz;
    }
  }
  return { x, z, vx, vz };
}

function circleAabbHit(
  x: number,
  z: number,
  radius: number,
  aabb: MiniGolfAabb2,
): { nx: number; nz: number; penetration: number } | null {
  const nearestX = clamp(x, aabb.min[0], aabb.max[0]);
  const nearestZ = clamp(z, aabb.min[1], aabb.max[1]);
  let dx = x - nearestX;
  let dz = z - nearestZ;
  let distSq = dx * dx + dz * dz;

  if (distSq > 0) {
    if (distSq >= radius * radius) return null;
    const dist = Math.sqrt(distSq);
    return { nx: dx / dist, nz: dz / dist, penetration: radius - dist };
  }

  const left = Math.abs(x - aabb.min[0]);
  const right = Math.abs(aabb.max[0] - x);
  const bottom = Math.abs(z - aabb.min[1]);
  const top = Math.abs(aabb.max[1] - z);
  const min = Math.min(left, right, bottom, top);
  if (min === left) {
    dx = -1;
    dz = 0;
  } else if (min === right) {
    dx = 1;
    dz = 0;
  } else if (min === bottom) {
    dx = 0;
    dz = -1;
  } else {
    dx = 0;
    dz = 1;
  }
  distSq = 0;
  return { nx: dx, nz: dz, penetration: radius + min };
}

function applyFriction(velocity: Vec2, deceleration: number, dt: number): [number, number] {
  const speed = Math.hypot(velocity[0], velocity[1]);
  if (speed <= 0 || deceleration <= 0) return [velocity[0], velocity[1]];
  const nextSpeed = Math.max(0, speed - deceleration * dt);
  const scale = nextSpeed / speed;
  return [velocity[0] * scale, velocity[1] * scale];
}

function isOutOfBounds(x: number, z: number, course: MiniGolfCourse): boolean {
  if (course.bounds && !containsAabb(course.bounds, x, z)) return true;
  return (course.hazards ?? []).some((hazard) => containsAabb(hazard, x, z));
}

function containsAabb(aabb: MiniGolfAabb2, x: number, z: number): boolean {
  return x >= aabb.min[0] && x <= aabb.max[0] && z >= aabb.min[1] && z <= aabb.max[1];
}

function normalize2(value: Vec2): [number, number] {
  const length = Math.hypot(value[0], value[1]);
  return length > 0 ? [value[0] / length, value[1] / length] : [0, 0];
}

function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
