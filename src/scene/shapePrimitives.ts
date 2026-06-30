/**
 * Procedural geometry for built-in shape actors. Wraps a primitive mesh in a
 * minimal GLTF-shaped object so shapes flow through the exact same instanced
 * model pipeline (render / bounds / colliders / save) as imported assets — the
 * downstream code only reads `gltf.scene`.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import type { BufferGeometry } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  isAmbientSoundAssetId,
  isPlayerStartAssetId,
  parseShapeAssetId,
  SHAPE_PLANE_SIZE,
  SHAPE_PRIMITIVE_SIZE,
  type ShapePrimitiveType,
} from "@engine/scene/shapes";
import {
  createAmbientSoundMarkerGltf,
  createPlayerStartMarkerGltf,
} from "./markerPrimitives";

/** Neutral, lit material colour shared by every primitive shape. */
const SHAPE_PRIMITIVE_COLOR = "#b9c0c6";

/**
 * Base size for solid primitives, in world units. The scene scale is ~1 unit ≈
 * 2 m (a doorway is ~1.0 units tall, the lounge sofa ~0.98 wide), so 0.5 units
 * ≈ 1 m keeps a spawned cube furniture-sized rather than door-height.
 */
function createShapeGeometry(type: ShapePrimitiveType): BufferGeometry {
  switch (type) {
    case "cube":
      return new BoxGeometry(SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE);
    case "sphere":
      return new SphereGeometry(SHAPE_PRIMITIVE_SIZE / 2, 32, 16);
    case "cylinder":
      return new CylinderGeometry(
        SHAPE_PRIMITIVE_SIZE / 2,
        SHAPE_PRIMITIVE_SIZE / 2,
        SHAPE_PRIMITIVE_SIZE,
        32,
      );
    case "cone":
      return new ConeGeometry(SHAPE_PRIMITIVE_SIZE / 2, SHAPE_PRIMITIVE_SIZE, 32);
    case "plane": {
      // PlaneGeometry faces +Z; lay it flat on the ground (XZ plane).
      const geometry = new PlaneGeometry(SHAPE_PLANE_SIZE, SHAPE_PLANE_SIZE);
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    }
  }
}

/**
 * Build a minimal GLTF-shaped object wrapping a primitive mesh. Only `scene`
 * (and `animations`) are consumed by the scene builders; the remaining GLTF
 * fields are stubbed so the synthetic asset satisfies the type without a loader.
 */
export function createShapePrimitiveGltf(type: ShapePrimitiveType): GLTF {
  const material = new MeshStandardMaterial({
    color: SHAPE_PRIMITIVE_COLOR,
    roughness: 0.7,
    metalness: 0,
  });
  // A plane is single-sided by default; show it from below too.
  if (type === "plane") material.side = DoubleSide;

  const mesh = new Mesh(createShapeGeometry(type), material);
  mesh.name = `shape-${type}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const scene = new Group();
  scene.name = `shape-${type}-root`;
  scene.add(mesh);

  return {
    scene,
    scenes: [scene],
    animations: [],
    cameras: [],
    asset: { version: "2.0", generator: "forge-shape-primitive" },
    userData: {},
  } as unknown as GLTF;
}

/**
 * Build the procedural GLTF for a synthetic asset id (a `shape:<type>` primitive
 * or the `marker:playerStart` Player Start marker), or null for a manifest asset.
 * The single dispatch point both shells use to register procedural models.
 */
export function createProceduralAssetGltf(assetId: string): GLTF | null {
  if (isPlayerStartAssetId(assetId)) return createPlayerStartMarkerGltf();
  if (isAmbientSoundAssetId(assetId)) return createAmbientSoundMarkerGltf();
  const type = parseShapeAssetId(assetId);
  return type ? createShapePrimitiveGltf(type) : null;
}
