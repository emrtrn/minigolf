import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  TorusGeometry,
} from "three";
import type { MeshBasicMaterial, Object3D } from "three";

import type { GizmoPlaneAxis, GizmoVectorAxis } from "./axes";
import {
  createGizmoHandleMaterial,
  registerGizmoHandlePickables,
  type GizmoHandle,
} from "./handles";

/**
 * Per-handle highlight inputs: the active (currently dragged) and hovered
 * handles are recolored so the gizmo reflects pointer state. The shape matches
 * the trailing arguments of {@link createGizmoHandleMaterial}, so a
 * `GizmoInteractionStore` (which exposes `activeHandle`/`hoveredHandle`) can be
 * passed directly.
 */
export interface GizmoHighlight {
  readonly activeHandle: GizmoHandle | null;
  readonly hoveredHandle: GizmoHandle | null;
}

/** Tools that have a viewport gizmo (the "select" tool has none). */
export type GizmoToolKind = "move" | "rotate" | "scale";

/**
 * Disposes the gizmo's child geometry/materials, empties the pickable list, and
 * resets the group so it can be rebuilt for the next tool/selection.
 */
export function clearGizmoGroup(group: Group, pickables: Object3D[]): void {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    child.removeFromParent();
  }
  pickables.length = 0;
  group.scale.setScalar(1);
  group.visible = false;
}

/**
 * Builds the handle meshes for `tool` into `group`, registering each handle's
 * pickable meshes into `pickables`. Pure Three.js construction — all editor
 * state arrives via {@link GizmoHighlight}.
 */
export function buildGizmoHandles(
  tool: GizmoToolKind,
  group: Group,
  pickables: Object3D[],
  highlight: GizmoHighlight,
): void {
  if (tool === "move") buildMoveGizmo(group, pickables, highlight);
  else if (tool === "rotate") buildRotateGizmo(group, pickables, highlight);
  else buildScaleGizmo(group, pickables, highlight);
}

function materialFor(
  handle: GizmoHandle,
  color: number,
  highlight: GizmoHighlight,
): MeshBasicMaterial {
  return createGizmoHandleMaterial(handle, color, highlight.activeHandle, highlight.hoveredHandle);
}

function buildMoveGizmo(group: Group, pickables: Object3D[], highlight: GizmoHighlight): void {
  buildArrowHandle(group, pickables, highlight, "x", 0xe15b5b);
  buildArrowHandle(group, pickables, highlight, "y", 0x69d282);
  buildArrowHandle(group, pickables, highlight, "z", 0x5b8fe1);

  // Two-axis plane handles, colored by the axis they are perpendicular to.
  buildPlaneHandle(group, pickables, highlight, "move", "xy", 0x5b8fe1);
  buildPlaneHandle(group, pickables, highlight, "move", "xz", 0x69d282);
  buildPlaneHandle(group, pickables, highlight, "move", "yz", 0xe15b5b);

  const center = new Mesh(
    new BoxGeometry(0.18, 0.18, 0.18),
    materialFor({ tool: "move", axis: "xyz" }, 0xf3cc5c, highlight),
  );
  center.name = "move-xyz-free";
  registerGizmoHandlePickables(center, { tool: "move", axis: "xyz" }, pickables);
  group.add(center);
}

function buildRotateGizmo(group: Group, pickables: Object3D[], highlight: GizmoHighlight): void {
  buildRotateRing(group, pickables, highlight, "x", 0xe15b5b);
  buildRotateRing(group, pickables, highlight, "y", 0x69d282);
  buildRotateRing(group, pickables, highlight, "z", 0x5b8fe1);
}

function buildRotateRing(
  group: Group,
  pickables: Object3D[],
  highlight: GizmoHighlight,
  axis: GizmoVectorAxis,
  color: number,
): void {
  const ring = new Mesh(
    new TorusGeometry(0.72, 0.01, 10, 96),
    materialFor({ tool: "rotate", axis }, color, highlight),
  );
  ring.name = `rotate-${axis}-ring`;
  // A torus lies in its local XY plane (normal +Z); orient each ring so its
  // normal points down the axis it rotates about.
  if (axis === "x") ring.rotation.y = Math.PI / 2;
  else if (axis === "y") ring.rotation.x = Math.PI / 2;
  registerGizmoHandlePickables(ring, { tool: "rotate", axis }, pickables);
  group.add(ring);
}

function buildScaleGizmo(group: Group, pickables: Object3D[], highlight: GizmoHighlight): void {
  const center = new Mesh(
    new BoxGeometry(0.16, 0.16, 0.16),
    materialFor({ tool: "scale", axis: "uniform" }, 0xf3cc5c, highlight),
  );
  center.name = "scale-uniform";
  registerGizmoHandlePickables(center, { tool: "scale", axis: "uniform" }, pickables);
  group.add(center);

  buildScaleHandle(group, pickables, highlight, "x", 0xe15b5b);
  buildScaleHandle(group, pickables, highlight, "y", 0x69d282);
  buildScaleHandle(group, pickables, highlight, "z", 0x5b8fe1);

  buildPlaneHandle(group, pickables, highlight, "scale", "xy", 0x5b8fe1);
  buildPlaneHandle(group, pickables, highlight, "scale", "xz", 0x69d282);
  buildPlaneHandle(group, pickables, highlight, "scale", "yz", 0xe15b5b);
}

/** Small square handle for two-axis (planar) move/scale, like Unreal's gizmo. */
function buildPlaneHandle(
  group: Group,
  pickables: Object3D[],
  highlight: GizmoHighlight,
  tool: "move" | "scale",
  axis: GizmoPlaneAxis,
  color: number,
): void {
  const size = 0.2;
  const reach = 0.34;
  const material = materialFor({ tool, axis }, color, highlight);
  const quad = new Mesh(new PlaneGeometry(size, size), material);
  quad.name = `${tool}-${axis}-plane`;
  if (axis === "xy") {
    quad.position.set(reach, reach, 0);
  } else if (axis === "xz") {
    quad.position.set(reach, 0, reach);
    quad.rotation.x = -Math.PI / 2;
  } else {
    quad.position.set(0, reach, reach);
    quad.rotation.y = Math.PI / 2;
  }
  registerGizmoHandlePickables(quad, { tool, axis }, pickables);
  group.add(quad);
}

function buildArrowHandle(
  group: Group,
  pickables: Object3D[],
  highlight: GizmoHighlight,
  axis: GizmoVectorAxis,
  color: number,
): void {
  const handleGroup = new Group();
  handleGroup.name = `move-${axis}-axis`;

  const material = materialFor({ tool: "move", axis }, color, highlight);
  const shaft = new Mesh(new CylinderGeometry(0.012, 0.012, 0.62, 8), material.clone());
  const head = new Mesh(new ConeGeometry(0.055, 0.14, 14), material.clone());
  shaft.position.y = 0.31;
  head.position.y = 0.69;
  handleGroup.add(shaft, head);

  if (axis === "x") handleGroup.rotation.z = -Math.PI / 2;
  if (axis === "z") handleGroup.rotation.x = Math.PI / 2;

  registerGizmoHandlePickables(handleGroup, { tool: "move", axis }, pickables);
  group.add(handleGroup);
}

function buildScaleHandle(
  group: Group,
  pickables: Object3D[],
  highlight: GizmoHighlight,
  axis: GizmoVectorAxis,
  color: number,
): void {
  const handleGroup = new Group();
  handleGroup.name = `scale-${axis}-axis`;

  const material = materialFor({ tool: "scale", axis }, color, highlight);
  const shaft = new Mesh(new CylinderGeometry(0.01, 0.01, 0.52, 8), material.clone());
  const handle = new Mesh(new BoxGeometry(0.11, 0.11, 0.11), material.clone());
  shaft.position.y = 0.26;
  handle.position.y = 0.58;
  handleGroup.add(shaft, handle);

  if (axis === "x") handleGroup.rotation.z = -Math.PI / 2;
  if (axis === "z") handleGroup.rotation.x = Math.PI / 2;
  registerGizmoHandlePickables(handleGroup, { tool: "scale", axis }, pickables);
  group.add(handleGroup);
}
