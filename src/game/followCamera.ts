/**
 * Pure, headless-testable third-person follow-camera math. No Three.js or DOM:
 * the runtime shell (src/scene/RuntimeSceneApp.ts) feeds it the player position
 * each tick and applies the returned pose to the live camera.
 *
 * The camera keeps a fixed world-space orientation (it translates to track the
 * player but never rotates), so its forward stays aligned with the world
 * movement frame. With the default behind-and-above offset the camera looks
 * down -z, which is exactly `move-forward`, so the existing world-relative WASD
 * reads as camera-relative. Independent camera yaw (orbit / mouse-look) and
 * feeding that yaw back into movement is a later step.
 */

export type Vec3 = [number, number, number];

export interface FollowCameraConfig {
  /** World-space camera offset from the followed player position. */
  readonly offset: Vec3;
  /** Height above the player position that the camera aims at. */
  readonly lookHeight: number;
}

export interface FollowCameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

/** Camera pose the follower eases toward for a player at `playerPos`. */
export function desiredFollowPose(
  playerPos: Vec3,
  config: FollowCameraConfig,
): FollowCameraPose {
  return {
    position: [
      playerPos[0] + config.offset[0],
      playerPos[1] + config.offset[1],
      playerPos[2] + config.offset[2],
    ],
    target: [playerPos[0], playerPos[1] + config.lookHeight, playerPos[2]],
  };
}

/**
 * Framerate-independent smoothing factor in [0, 1] for an exponential approach
 * at `rate` per second over `dt` seconds (`1 - e^(-rate*dt)`). A non-positive
 * rate or dt yields 0 (no movement); a large rate*dt approaches 1 (snap).
 */
export function smoothingFactor(rate: number, dt: number): number {
  if (!(rate > 0) || !(dt > 0)) return 0;
  return 1 - Math.exp(-rate * dt);
}

/** Linearly interpolates `a` toward `b` by `t`, clamped to [0, 1]. */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ];
}

/**
 * Advances the follow camera one tick toward the player. With no previous pose
 * (the first frame) it snaps to the desired pose to avoid easing in from the
 * world origin; otherwise it eases both the position and the look target by `t`.
 */
export function stepFollowCamera(
  prev: FollowCameraPose | null,
  playerPos: Vec3,
  config: FollowCameraConfig,
  t: number,
): FollowCameraPose {
  const desired = desiredFollowPose(playerPos, config);
  if (!prev) return desired;
  return {
    position: lerpVec3(prev.position, desired.position, t),
    target: lerpVec3(prev.target, desired.target, t),
  };
}
