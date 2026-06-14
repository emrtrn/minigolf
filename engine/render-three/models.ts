import { Group, InstancedMesh, Matrix4, Object3D } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { LayoutCharacter, LayoutPlacement } from "@engine/scene/layout";
import { readRotation, readScale } from "@engine/scene/transform";
import { isRenderableMesh } from "./materials";
import { applyEulerDegrees, composePlacementMatrix } from "./transforms";

const HIDDEN_INSTANCE_MATRIX = new Matrix4().makeScale(0, 0, 0);

export interface InstancedModelGroup {
  group: Group;
  meshes: InstancedMesh[];
}

export interface CreateInstancedModelGroupOptions {
  assetId: string;
  gltf: GLTF;
  placements: LayoutPlacement[];
  castShadow: boolean;
  receiveShadow: boolean;
}

export function createInstancedModelGroup(
  options: CreateInstancedModelGroupOptions,
): InstancedModelGroup {
  const { assetId, gltf, placements, castShadow, receiveShadow } = options;
  const group = new Group();
  const meshes: InstancedMesh[] = [];
  group.name = `instanced-${assetId}`;

  gltf.scene.updateMatrixWorld(true);
  const placementMatrices = placements.map((placement) => composePlacementMatrix(placement));

  gltf.scene.traverse((object) => {
    if (!isRenderableMesh(object)) return;

    const instanced = new InstancedMesh(
      object.geometry,
      object.material,
      placementMatrices.length,
    );
    instanced.name = `${assetId}-${object.name || "mesh"}`;
    instanced.frustumCulled = false;
    instanced.castShadow = castShadow;
    instanced.receiveShadow = receiveShadow;
    instanced.userData.assetId = assetId;

    for (let index = 0; index < placementMatrices.length; index += 1) {
      const placementMatrix = placementMatrices[index];
      if (!placementMatrix) continue;
      if (placements[index]?.hidden) {
        instanced.setMatrixAt(index, HIDDEN_INSTANCE_MATRIX);
        continue;
      }
      const matrix = placementMatrix.clone().multiply(object.matrixWorld);
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
