import { Vector3 } from "three";

import { round, snapValue } from "@editor/core/numeric";
import { degreesToRadians } from "@engine/scene/transform";
import type { Vec3 } from "@engine/scene/layout";

import { axisToIndex, isPlaneAxis, planeAxisIndices } from "./axes";
import type { GizmoPointerDrag } from "./interaction";

type MoveDrag = Extract<GizmoPointerDrag, { mode: "move" }>;
type RotateDrag = Extract<GizmoPointerDrag, { mode: "rotate" }>;
type ScaleDrag = Extract<GizmoPointerDrag, { mode: "scale" }>;

/** Move/rotate/scale snap configuration (a structural subset of editor snap state). */
export interface DragSnapSettings {
  move: number;
  moveEnabled: boolean;
  rotate: number;
  rotateEnabled: boolean;
  scale: number;
  scaleEnabled: boolean;
}

/**
 * Screen-space free move (the centre "xyz" handle): offsets the start position
 * along the camera right/up basis by the pointer delta. Returns a full Vec3.
 */
export function freeMoveDragPosition(
  drag: MoveDrag,
  deltaX: number,
  deltaY: number,
  snap: DragSnapSettings,
): Vec3 {
  const right = drag.freeMoveRight ?? new Vector3(1, 0, 0);
  const up = drag.freeMoveUp ?? new Vector3(0, 1, 0);
  const offset = right
    .clone()
    .multiplyScalar(deltaX * 0.01)
    .add(up.clone().multiplyScalar(-deltaY * 0.01));
  return [
    snapValue(drag.startPosition[0] + offset.x, snap.move, snap.moveEnabled),
    snapValue(drag.startPosition[1] + offset.y, snap.move, snap.moveEnabled),
    snapValue(drag.startPosition[2] + offset.z, snap.move, snap.moveEnabled),
  ];
}

/**
 * Two-axis (planar) move: world delta from the plane hit relative to the drag's
 * starting plane hit. Sets all three components from the start position + delta.
 */
export function planeMoveDragPosition(drag: MoveDrag, hit: Vector3, snap: DragSnapSettings): Vec3 {
  const delta = hit.clone().sub(drag.planeStartHit ?? new Vector3());
  const start = drag.startPosition;
  const position: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    position[i] = snapValue((start[i] ?? 0) + delta.getComponent(i), snap.move, snap.moveEnabled);
  }
  return position;
}

/** Vertical (y) handle: screen-Y delta moves height; x/z keep `base`. */
export function axisYMoveDragPosition(
  base: Vec3,
  drag: MoveDrag,
  deltaY: number,
  snap: DragSnapSettings,
): Vec3 {
  const position: Vec3 = [...base];
  position[1] = snapValue(drag.startPosition[1] - deltaY * 0.01, snap.move, snap.moveEnabled);
  return position;
}

/**
 * Local-space x/z move: projects the floor hit onto the object's heading (its Y
 * rotation), so the handle slides along the object's own axis. Keeps `base` y.
 */
export function localAxisMoveDragPosition(
  base: Vec3,
  drag: MoveDrag,
  hit: Vector3,
  snap: DragSnapSettings,
): Vec3 {
  // Y rotation drives the floor-plane heading; X/Z tilt is ignored here since
  // local move stays on the floor.
  const theta = degreesToRadians(drag.startTransform.rotation[1]);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dirX = drag.axis === "x" ? cos : sin;
  const dirZ = drag.axis === "x" ? -sin : cos;
  const startHitX = drag.startPosition[0] - drag.offset.x;
  const startHitZ = drag.startPosition[2] - drag.offset.z;
  const distance = snapValue(
    (hit.x - startHitX) * dirX + (hit.z - startHitZ) * dirZ,
    snap.move,
    snap.moveEnabled,
  );
  const position: Vec3 = [...base];
  position[0] = round(drag.startPosition[0] + dirX * distance);
  position[2] = round(drag.startPosition[2] + dirZ * distance);
  return position;
}

/** World-space x or z move from the floor hit; sets only the dragged axis. */
export function worldAxisMoveDragPosition(
  base: Vec3,
  drag: MoveDrag,
  hit: Vector3,
  snap: DragSnapSettings,
): Vec3 {
  const position: Vec3 = [...base];
  if (drag.axis === "x") {
    position[0] = snapValue(hit.x + drag.offset.x, snap.move, snap.moveEnabled);
  }
  if (drag.axis === "z") {
    position[2] = snapValue(hit.z + drag.offset.z, snap.move, snap.moveEnabled);
  }
  return position;
}

/** Rotate handle: degrees about the dragged axis from the horizontal pointer delta. */
export function rotateDragRotation(
  drag: RotateDrag,
  deltaClientX: number,
  snap: DragSnapSettings,
): Vec3 {
  const axisIndex = axisToIndex(drag.axis);
  const deltaDeg = deltaClientX * 0.5;
  const rotation: Vec3 = [...drag.startRotation];
  rotation[axisIndex] = snapValue(
    drag.startRotation[axisIndex] + deltaDeg,
    snap.rotate,
    snap.rotateEnabled,
  );
  return rotation;
}

/**
 * Scale handle: combined horizontal-minus-vertical pointer delta drives a scale
 * factor. Uniform grows every axis; a plane axis grows its two; a single axis
 * grows one. Never goes below 0.05.
 */
export function scaleDragScale(
  drag: ScaleDrag,
  deltaClientX: number,
  deltaClientY: number,
  snap: DragSnapSettings,
): Vec3 {
  const factor = (deltaClientX - deltaClientY) * 0.005;
  const start = drag.startScale;
  const apply = (value: number): number =>
    Math.max(0.05, snapValue(value + factor, snap.scale, snap.scaleEnabled));

  if (drag.axis === "uniform") {
    // Grow every axis by the same amount so a locked object keeps its profile.
    return [apply(start[0]), apply(start[1]), apply(start[2])];
  }
  if (isPlaneAxis(drag.axis)) {
    const [i, j] = planeAxisIndices(drag.axis);
    const scale: Vec3 = [...start];
    scale[i] = apply(start[i]);
    scale[j] = apply(start[j]);
    return scale;
  }
  const axisIndex = axisToIndex(drag.axis);
  const scale: Vec3 = [...start];
  scale[axisIndex] = apply(start[axisIndex]);
  return scale;
}
