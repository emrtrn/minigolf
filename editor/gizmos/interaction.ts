import {
  Camera,
  Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from "three";

import { clamp } from "@editor/core/numeric";
import { degreesToRadians } from "@engine/scene/transform";
import type { GizmoPlaneAxis } from "./axes";
import {
  gizmoHandlesEqual,
  type GizmoHandle,
} from "./handles";

const DEFAULT_SCREEN_SIZE_PX = 118;

export class GizmoInteractionStore {
  private active: GizmoHandle | null = null;
  private hovered: GizmoHandle | null = null;

  get activeHandle(): GizmoHandle | null {
    return this.active;
  }

  get hoveredHandle(): GizmoHandle | null {
    return this.hovered;
  }

  beginDrag(handle: GizmoHandle): void {
    this.active = { ...handle };
    this.hovered = null;
  }

  endDrag(): void {
    this.active = null;
  }

  setHover(handle: GizmoHandle | null): boolean {
    if (gizmoHandlesEqual(handle, this.hovered)) return false;
    this.hovered = handle ? { ...handle } : null;
    return true;
  }

  clearHover(): boolean {
    if (!this.hovered) return false;
    this.hovered = null;
    return true;
  }
}

export function pickGizmoHandle(
  raycaster: Raycaster,
  camera: Camera,
  pointerNdc: Vector2,
  visible: boolean,
  pickables: Object3D[],
): GizmoHandle | null {
  if (!visible || pickables.length === 0) return null;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  const handle = hits[0]?.object.userData.gizmoHandle as GizmoHandle | undefined;
  return handle ?? null;
}

export function calculateGizmoScreenScale(
  cameraFovDegrees: number,
  cameraDistance: number,
  viewportHeight: number,
  screenSizePx: number = DEFAULT_SCREEN_SIZE_PX,
): number {
  const safeViewportHeight = viewportHeight || 1;
  const distance = Math.max(0.01, cameraDistance);
  const viewHeight = 2 * Math.tan(degreesToRadians(cameraFovDegrees) / 2) * distance;
  const worldUnitsPerPixel = viewHeight / safeViewportHeight;
  return clamp(worldUnitsPerPixel * screenSizePx, 0.35, 4);
}

export function screenSpaceMoveBasis(cameraQuaternion: Quaternion): { right: Vector3; up: Vector3 } {
  return {
    right: new Vector3(1, 0, 0).applyQuaternion(cameraQuaternion).normalize(),
    up: new Vector3(0, 1, 0).applyQuaternion(cameraQuaternion).normalize(),
  };
}

export function planeAxisNormalWorld(axis: GizmoPlaneAxis, gizmoQuaternion: Quaternion): Vector3 {
  const local =
    axis === "xy"
      ? new Vector3(0, 0, 1)
      : axis === "yz"
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 1, 0);
  return local.applyQuaternion(gizmoQuaternion).normalize();
}
