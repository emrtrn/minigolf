import { Euler, Matrix4, Quaternion, Vector3 } from "three";

import { round } from "@editor/core/numeric";
import { eulerDegrees } from "@engine/render-three/transforms";
import type { EditableTransform } from "@editor/core/editableScene";
import type { Vec3 } from "@engine/scene/layout";

const RAD_TO_DEG = 180 / Math.PI;

/** Builds a world matrix from an editable transform (pos / euler-degrees / scale). */
export function transformToMatrix(transform: EditableTransform): Matrix4 {
  const position = new Vector3(...transform.position);
  const rotation = new Quaternion().setFromEuler(eulerDegrees(transform.rotation));
  const scale = new Vector3(...transform.scale);
  return new Matrix4().compose(position, rotation, scale);
}

/** Decomposes a world matrix back into an editable transform (degrees rotation). */
export function matrixToTransform(matrix: Matrix4): EditableTransform {
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x * RAD_TO_DEG, euler.y * RAD_TO_DEG, euler.z * RAD_TO_DEG],
    scale: [scale.x, scale.y, scale.z],
  };
}

/**
 * Origin position that keeps `pivotWorld` fixed under a given rotation+scale:
 * p' = pivotWorld − R·S·pivotLocal. Used so rotate/scale drags pivot about the
 * authored pivot point instead of the object origin.
 */
export function pivotCorrectedPosition(
  pivotWorld: Vector3,
  rotation: Vec3,
  scale: Vec3,
  pivot: Vec3,
): Vec3 {
  const rotScale = new Matrix4().compose(
    new Vector3(0, 0, 0),
    new Quaternion().setFromEuler(eulerDegrees(rotation)),
    new Vector3(...scale),
  );
  const offset = new Vector3(...pivot).applyMatrix4(rotScale);
  return [
    round(pivotWorld.x - offset.x),
    round(pivotWorld.y - offset.y),
    round(pivotWorld.z - offset.z),
  ];
}
