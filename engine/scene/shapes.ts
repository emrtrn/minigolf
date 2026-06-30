/**
 * Built-in primitive shape descriptors (Cube/Sphere/Cylinder/Cone/Plane).
 *
 * Shape actors are stored as ordinary model instances whose `assetId` is a
 * synthetic `shape:<type>` id rather than a manifest asset. This module is the
 * dependency-free (no three.js) source of truth for the id encoding + labels so
 * both the editor UI chunk and the render layer can share it. The three.js
 * geometry builder lives in `src/scene/shapePrimitives.ts`.
 */
import type { AssetCollisionDef } from "./collision";

export const SHAPE_PRIMITIVE_TYPES = [
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "plane",
] as const;

export type ShapePrimitiveType = (typeof SHAPE_PRIMITIVE_TYPES)[number];

const SHAPE_ASSET_PREFIX = "shape:";
/** Base size for solid Add Actor primitives, in world units. */
export const SHAPE_PRIMITIVE_SIZE = 0.5;
/** Plane actor footprint, matching the core floor tile scale. */
export const SHAPE_PLANE_SIZE = 1;
/** Thin collision thickness for plane actors so they have a usable volume. */
export const SHAPE_PLANE_COLLISION_THICKNESS = 0.02;

/** Encode a primitive type as the synthetic asset id stored in the layout. */
export function shapeAssetId(type: ShapePrimitiveType): string {
  return `${SHAPE_ASSET_PREFIX}${type}`;
}

/** Decode a `shape:<type>` asset id back to its primitive type, or null. */
export function parseShapeAssetId(assetId: string): ShapePrimitiveType | null {
  if (!assetId.startsWith(SHAPE_ASSET_PREFIX)) return null;
  const type = assetId.slice(SHAPE_ASSET_PREFIX.length);
  return (SHAPE_PRIMITIVE_TYPES as readonly string[]).includes(type)
    ? (type as ShapePrimitiveType)
    : null;
}

export function isShapeAssetId(assetId: string): boolean {
  return parseShapeAssetId(assetId) !== null;
}

/**
 * Synthetic asset id for a Player Start marker. Like `shape:*`, it is a
 * procedural actor stored as an ordinary instance placement (so it reuses the
 * editor's selection / gizmo / outliner / save pipeline), but it renders only in
 * the editor — the runtime skips it and reads its transform as the spawn point.
 */
export const PLAYER_START_ASSET_ID = "marker:playerStart";

export function isPlayerStartAssetId(assetId: string): boolean {
  return assetId === PLAYER_START_ASSET_ID;
}

/**
 * Synthetic asset id for an Ambient Sound emitter (Unreal's AmbientSound). Like
 * the Player Start marker it persists as an ordinary instance placement (so it
 * reuses selection / gizmo / outliner / save), and its placement carries an
 * `audio` component that the runtime plays. The editor draws a speaker gizmo;
 * the runtime skips rendering the gizmo but still plays the authored audio.
 */
export const AMBIENT_SOUND_ASSET_ID = "marker:ambientSound";

export function isAmbientSoundAssetId(assetId: string): boolean {
  return assetId === AMBIENT_SOUND_ASSET_ID;
}

/** True for any editor-only marker gizmo the runtime must not render as a mesh. */
export function isMarkerAssetId(assetId: string): boolean {
  return isPlayerStartAssetId(assetId) || isAmbientSoundAssetId(assetId);
}

/**
 * True for any synthetic, procedurally-built asset id (shapes + markers). These
 * are registered locally rather than loaded from the manifest, so loaders must
 * exclude them.
 */
export function isProceduralAssetId(assetId: string): boolean {
  return isShapeAssetId(assetId) || isMarkerAssetId(assetId);
}

export function isShapePrimitiveType(value: unknown): value is ShapePrimitiveType {
  return (
    typeof value === "string" &&
    (SHAPE_PRIMITIVE_TYPES as readonly string[]).includes(value)
  );
}

export function formatShapeType(type: ShapePrimitiveType): string {
  switch (type) {
    case "cube":
      return "Cube";
    case "sphere":
      return "Sphere";
    case "cylinder":
      return "Cylinder";
    case "cone":
      return "Cone";
    case "plane":
      return "Plane";
  }
}

/** Default asset-level collision for a built-in Add Actor primitive. */
export function shapePrimitiveCollisionDef(type: ShapePrimitiveType): AssetCollisionDef {
  const solid: [number, number, number] = [
    SHAPE_PRIMITIVE_SIZE,
    SHAPE_PRIMITIVE_SIZE,
    SHAPE_PRIMITIVE_SIZE,
  ];
  switch (type) {
    case "cube":
      return shapeCollisionDef("box", solid);
    case "sphere":
      return shapeCollisionDef("sphere", solid);
    case "cylinder":
      return shapeCollisionDef("cylinder", solid);
    case "cone":
      return shapeCollisionDef("cone", solid);
    case "plane":
      return shapeCollisionDef("box", [
        SHAPE_PLANE_SIZE,
        SHAPE_PLANE_COLLISION_THICKNESS,
        SHAPE_PLANE_SIZE,
      ]);
  }
}

/** Default collision for a synthetic `shape:<type>` asset id, if applicable. */
export function shapeAssetCollisionDef(assetId: string): AssetCollisionDef | null {
  const type = parseShapeAssetId(assetId);
  return type ? shapePrimitiveCollisionDef(type) : null;
}

function shapeCollisionDef(
  shape: AssetCollisionDef["primitives"][number]["shape"],
  size: [number, number, number],
): AssetCollisionDef {
  return {
    primitives: [{ shape, size }],
    complexity: "projectDefault",
    preset: "blockAll",
  };
}
