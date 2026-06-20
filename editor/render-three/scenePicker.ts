import { Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Intersection, Object3D, PerspectiveCamera } from "three";

import {
  findParentActor,
  findParentCharacter,
  findParentInstancedMesh,
  findParentLight,
} from "@engine/render-three/picking";
import type { InstanceSelection, Selection } from "@editor/core/selection";
import { pickGizmoHandle as pickGizmoHandleFromObjects } from "@editor/gizmos/interaction";
import type { GizmoHandle } from "@editor/gizmos/handles";

export interface ScenePickerOptions {
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** All selectable scene objects: instanced meshes + characters + light roots. */
  pickables: () => Object3D[];
  /** Solid surfaces for placement raycasts: instanced meshes + characters. */
  surfacePickables: () => Object3D[];
  /** The transform gizmo group's visibility + its pickable handle meshes. */
  gizmo: () => { visible: boolean; pickables: Object3D[] };
}

/**
 * Editor viewport raycasting: maps pointer/client coordinates to scene
 * selections, gizmo handles, and floor/surface points. Owns its scratch
 * raycaster + NDC vector + floor plane; reads the live scene through the
 * supplier callbacks so it stays correct as the scene mutates. Editor-only.
 */
export class ScenePicker {
  private readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly getPickables: () => Object3D[];
  private readonly getSurfacePickables: () => Object3D[];
  private readonly getGizmo: () => { visible: boolean; pickables: Object3D[] };

  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly floorHit = new Vector3();

  constructor(options: ScenePickerOptions) {
    this.camera = options.camera;
    this.canvas = options.canvas;
    this.getPickables = options.pickables;
    this.getSurfacePickables = options.surfacePickables;
    this.getGizmo = options.gizmo;
  }

  pickGizmoHandle(clientX: number, clientY: number): GizmoHandle | null {
    const gizmo = this.getGizmo();
    if (!gizmo.visible || gizmo.pickables.length === 0) return null;
    this.setPointerNdc(clientX, clientY);
    return pickGizmoHandleFromObjects(
      this.raycaster,
      this.camera,
      this.pointerNdc,
      gizmo.visible,
      gizmo.pickables,
    );
  }

  pickSelection(clientX: number, clientY: number): Selection | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hits = this.raycaster.intersectObjects(this.getPickables(), true);
    for (const hit of hits) {
      const mesh = findParentInstancedMesh(hit.object);
      if (mesh) {
        const assetId = String(mesh.userData.assetId ?? "");
        if (!assetId || hit.instanceId == null) continue;
        return { kind: "instance", assetId, placementIndex: hit.instanceId };
      }

      const instance = findParentMaterialOverride(hit.object);
      if (instance) return instance;

      const character = findParentCharacter(hit.object);
      if (character) {
        const index = Number(character.userData.characterIndex);
        if (Number.isInteger(index)) return { kind: "character", index };
      }

      const actor = findParentActor(hit.object);
      if (actor) {
        const index = Number(actor.userData.actorIndex);
        if (Number.isInteger(index)) return { kind: "actor", index };
      }

      const light = findParentLight(hit.object);
      if (light) {
        const index = Number(light.userData.lightIndex);
        if (Number.isInteger(index)) return { kind: "light", index };
      }
    }
    return null;
  }

  clientToFloor(clientX: number, clientY: number): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit);
    return hit ? this.floorHit.clone() : null;
  }

  /**
   * Resolves the cursor to a placement point: the nearest scene surface under
   * the cursor (so assets land on table/shelf tops), falling back to the floor
   * plane (y = 0) when no geometry is hit.
   */
  clientToSurface(clientX: number, clientY: number): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hits = this.raycaster.intersectObjects(this.getSurfacePickables(), true);
    if (hits[0]) return hits[0].point.clone();

    const floor = this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit);
    return floor ? this.floorHit.clone() : null;
  }

  clientToPlane(clientX: number, clientY: number, plane: Plane): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const target = new Vector3();
    return this.raycaster.ray.intersectPlane(plane, target) ? target : null;
  }

  /** Casts straight down from `origin`, ignoring the excluded selection's own
   *  geometry, and returns the first surface's y (or null when nothing solid). */
  raycastSurfaceBelow(origin: Vector3, exclude: Selection): number | null {
    const ray = new Raycaster(origin, new Vector3(0, -1, 0), 0, 1000);
    const hits = ray.intersectObjects(this.getPickables(), true);
    for (const hit of hits) {
      if (this.isSelfHit(hit, exclude)) continue;
      return hit.point.y;
    }
    return null;
  }

  private isSelfHit(hit: Intersection, selection: Selection): boolean {
    if (selection.kind === "instance") {
      const mesh = findParentInstancedMesh(hit.object);
      const override = findParentMaterialOverride(hit.object);
      return Boolean(
        (mesh &&
          String(mesh.userData.assetId ?? "") === selection.assetId &&
          hit.instanceId === selection.placementIndex) ||
          (override &&
            override.assetId === selection.assetId &&
            override.placementIndex === selection.placementIndex),
      );
    }
    if (selection.kind === "actor") {
      const actor = findParentActor(hit.object);
      return actor ? Number(actor.userData.actorIndex) === selection.index : false;
    }
    // The Sky Atmosphere + Height Fog + Cloud Layer have no pickable geometry (scene-wide backdrops/effects).
    if (selection.kind === "sky" || selection.kind === "fog" || selection.kind === "cloud") {
      return false;
    }
    const character = findParentCharacter(hit.object);
    return character ? Number(character.userData.characterIndex) === selection.index : false;
  }

  private setPointerNdc(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  }
}

function findParentMaterialOverride(object: Object3D): InstanceSelection | null {
  let current: Object3D | null = object;
  while (current) {
    const assetId = current.userData.assetId;
    const placementIndex = current.userData.placementIndex;
    if (typeof assetId === "string" && Number.isInteger(placementIndex)) {
      return { kind: "instance", assetId, placementIndex };
    }
    current = current.parent;
  }
  return null;
}
