import { Group, InstancedMesh, Matrix4, Object3D } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { Entity } from "@engine/scene/entity";
import { readTransformComponent } from "@engine/scene/components";
import type { LayoutCharacter, LayoutPlacement } from "@engine/scene/layout";
import { readRotation, readScale } from "@engine/scene/transform";
import { isRenderableMesh } from "./materials";
import { applyEulerDegrees, composePlacementMatrix, composeTransformMatrix } from "./transforms";

const HIDDEN_INSTANCE_MATRIX = new Matrix4().makeScale(0, 0, 0);

export interface InstancedModelGroup {
  group: Group;
  meshes: InstancedMesh[];
}

/** Normalized per-placement render input, decoupled from the layout format. */
export interface InstanceRenderItem {
  matrix: Matrix4;
  hidden: boolean;
}

/** Legacy builder: derives render items straight from layout placements. */
export function placementInstanceItems(placements: LayoutPlacement[]): InstanceRenderItem[] {
  return placements.map((placement) => ({
    matrix: composePlacementMatrix(placement),
    hidden: placement.hidden ?? false,
  }));
}

/**
 * Entity-driven builder: derives render items from scene entities' transform
 * components and the `hidden` tag. Produces matrices identical to
 * `placementInstanceItems` because both compose through `composeTransformMatrix`.
 */
export function entityInstanceItems(entities: Entity[]): InstanceRenderItem[] {
  return entities.map((entity) => {
    const transform = readTransformComponent(entity);
    const matrix = transform
      ? composeTransformMatrix(transform.position, transform.rotation, transform.scale)
      : new Matrix4();
    return { matrix, hidden: entity.tags?.includes("hidden") ?? false };
  });
}

export interface CreateInstancedModelGroupOptions {
  assetId: string;
  gltf: GLTF;
  items: InstanceRenderItem[];
  castShadow: boolean;
  receiveShadow: boolean;
}

export function createInstancedModelGroup(
  options: CreateInstancedModelGroupOptions,
): InstancedModelGroup {
  const { assetId, gltf, items, castShadow, receiveShadow } = options;
  const group = new Group();
  const meshes: InstancedMesh[] = [];
  group.name = `instanced-${assetId}`;

  gltf.scene.updateMatrixWorld(true);

  gltf.scene.traverse((object) => {
    if (!isRenderableMesh(object)) return;

    const instanced = new InstancedMesh(object.geometry, object.material, items.length);
    instanced.name = `${assetId}-${object.name || "mesh"}`;
    instanced.frustumCulled = false;
    instanced.castShadow = castShadow;
    instanced.receiveShadow = receiveShadow;
    instanced.userData.assetId = assetId;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      if (item.hidden) {
        instanced.setMatrixAt(index, HIDDEN_INSTANCE_MATRIX);
        continue;
      }
      const matrix = item.matrix.clone().multiply(object.matrixWorld);
      instanced.setMatrixAt(index, matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    group.add(instanced);
    meshes.push(instanced);
  });

  return { group, meshes };
}

export function createCharacterSceneObject(
  gltf: GLTF,
  placement: LayoutCharacter,
): Object3D {
  const character = gltf.scene.clone();
  character.name = placement.name ?? placement.assetId;
  character.position.set(...placement.position);
  applyEulerDegrees(character, readRotation(placement));
  character.scale.set(...readScale(placement));
  character.visible = !(placement.hidden ?? false);

  const castShadow = placement.castShadow ?? true;
  character.traverse((object) => {
    if (!isRenderableMesh(object)) return;
    object.castShadow = castShadow;
    object.receiveShadow = true;
  });

  return character;
}
