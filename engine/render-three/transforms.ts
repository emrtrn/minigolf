import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";

import type { LayoutCharacter, LayoutPlacement, Vec3 } from "@engine/scene/layout";
import { degreesToRadians, readRotation, readScale } from "@engine/scene/transform";

/** Composes a TRS matrix from a position, an XYZ-degrees rotation, and a scale. */
export function composeTransformMatrix(position: Vec3, rotationDeg: Vec3, scale: Vec3): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(eulerDegrees(rotationDeg)),
    new Vector3(...scale),
  );
}

export function composePlacementMatrix(
  placement: LayoutPlacement | LayoutCharacter,
): Matrix4 {
  return composeTransformMatrix(placement.position, readRotation(placement), readScale(placement));
}

/** Builds an XYZ-order Euler from a degrees vector. */
export function eulerDegrees(rotation: Vec3): Euler {
  return new Euler(
    degreesToRadians(rotation[0]),
    degreesToRadians(rotation[1]),
    degreesToRadians(rotation[2]),
    "XYZ",
  );
}

/** Applies a degrees rotation vector to an Object3D's Euler (XYZ order). */
export function applyEulerDegrees(object: Object3D, rotation: Vec3): void {
  object.rotation.copy(eulerDegrees(rotation));
}
