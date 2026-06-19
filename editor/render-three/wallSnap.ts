import { Box3, Vector3 } from "three";

import { round } from "@editor/core/numeric";
import { composePlacementMatrix } from "@engine/render-three/transforms";
import type { Vec3 } from "@engine/scene/layout";

export interface WallSnapResult {
  position: [number, number, number];
  rotationYDeg: number;
}

/**
 * Snaps an instance flush against the nearest of the room's four bounding walls
 * (derived from the room world AABB) and orients it to face the room
 * interior. Pure geometry: `bounds` is the asset's local AABB and `room` the
 * room world AABB; the caller supplies both and the current transform.
 *
 * The asset front is assumed to face +Z; the returned `rotationYDeg` turns it
 * toward the interior, and `position` slides it so its back face sits flush
 * against the wall (origin-agnostic, via a probe box at the snapped rotation).
 */
export function computeWallSnap(
  bounds: Box3,
  room: Box3,
  position: [number, number, number],
  currentRotationYDeg: number,
  scale: number | Vec3,
): WallSnapResult {
  const center = bounds
    .clone()
    .applyMatrix4(composePlacementMatrix({ position, rotationYDeg: currentRotationYDeg, scale }))
    .getCenter(new Vector3());

  const toMinX = center.x - room.min.x;
  const toMaxX = room.max.x - center.x;
  const toMinZ = center.z - room.min.z;
  const toMaxZ = room.max.z - center.z;
  const nearest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);

  let rotationYDeg: number;
  let axis: "x" | "z";
  let wallCoord: number;
  let side: "min" | "max";
  if (nearest === toMinX) {
    rotationYDeg = 90;
    axis = "x";
    wallCoord = room.min.x;
    side = "min";
  } else if (nearest === toMaxX) {
    rotationYDeg = 270;
    axis = "x";
    wallCoord = room.max.x;
    side = "max";
  } else if (nearest === toMinZ) {
    rotationYDeg = 0;
    axis = "z";
    wallCoord = room.min.z;
    side = "min";
  } else {
    rotationYDeg = 180;
    axis = "z";
    wallCoord = room.max.z;
    side = "max";
  }

  // World box at the snapped rotation tells us how far to slide so the back
  // face sits flush against the wall (origin-agnostic).
  const probe = bounds
    .clone()
    .applyMatrix4(composePlacementMatrix({ position, rotationYDeg, scale }));
  const next: [number, number, number] = [...position];
  if (axis === "x") {
    next[0] = round(
      position[0] + (side === "min" ? wallCoord - probe.min.x : wallCoord - probe.max.x),
    );
  } else {
    next[2] = round(
      position[2] + (side === "min" ? wallCoord - probe.min.z : wallCoord - probe.max.z),
    );
  }
  return { position: next, rotationYDeg };
}
