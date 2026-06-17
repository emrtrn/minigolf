/**
 * Engine-generic collision model, mirroring Unreal's collision concepts in a
 * web-first, simplified form:
 *
 * - `CollisionEnabled`    — what kind of collision a body participates in.
 * - object/trace channels — a fixed, built-in set (no project-defined channels).
 * - `CollisionResponse`   — per-channel Block / Overlap / Ignore.
 * - `CollisionPreset`     — named profiles bundling the above (+ `custom`).
 * - `CollisionComplexity` — how the collision geometry is resolved.
 * - `CollisionPrimitive`  — a simple collision shape authored in the Static Mesh
 *   editor; an asset owns a list of them (`AssetCollisionDef`).
 *
 * Project-specific rules (which channel blocks what) live in game runtime/data;
 * this module only defines the generic surface and the built-in preset catalog.
 *
 * Keep this module dependency-light (only `./layout` types) so the editor,
 * runtime, tools, and tests can all import it.
 */
import type { Vec3 } from "./layout";

/** Unreal "Collision Enabled": which collision interactions a body runs. */
export type CollisionEnabled = "none" | "query" | "physics" | "queryAndPhysics";

export const COLLISION_ENABLED_VALUES: readonly CollisionEnabled[] = [
  "none",
  "query",
  "physics",
  "queryAndPhysics",
];

/** Unreal "Collision Complexity": how collision geometry is resolved. */
export type CollisionComplexity =
  | "projectDefault"
  | "simpleAndComplex"
  | "simpleAsComplex"
  | "complexAsSimple";

export const COLLISION_COMPLEXITY_VALUES: readonly CollisionComplexity[] = [
  "projectDefault",
  "simpleAndComplex",
  "simpleAsComplex",
  "complexAsSimple",
];

/** Per-channel response (Unreal Block / Overlap / Ignore). */
export type CollisionResponse = "ignore" | "overlap" | "block";

export const COLLISION_RESPONSE_VALUES: readonly CollisionResponse[] = [
  "ignore",
  "overlap",
  "block",
];

/** Built-in object channels: a body's collision identity + what it responds to. */
export type CollisionObjectChannel =
  | "worldStatic"
  | "worldDynamic"
  | "pawn"
  | "physicsBody"
  | "trigger";

export const COLLISION_OBJECT_CHANNELS: readonly CollisionObjectChannel[] = [
  "worldStatic",
  "worldDynamic",
  "pawn",
  "physicsBody",
  "trigger",
];

/** Built-in trace channels for queries (raycast / camera). */
export type CollisionTraceChannel = "visibility" | "camera";

export const COLLISION_TRACE_CHANNELS: readonly CollisionTraceChannel[] = [
  "visibility",
  "camera",
];

export type CollisionChannel = CollisionObjectChannel | CollisionTraceChannel;

export const COLLISION_CHANNELS: readonly CollisionChannel[] = [
  ...COLLISION_OBJECT_CHANNELS,
  ...COLLISION_TRACE_CHANNELS,
];

/** Sparse per-channel overrides; an absent channel falls back to the preset. */
export type CollisionResponseMap = Partial<Record<CollisionChannel, CollisionResponse>>;

/** Full per-channel response table (every channel resolved). */
export type CollisionResponseTable = Record<CollisionChannel, CollisionResponse>;

/** Built-in collision presets (Unreal-style named profiles) + `custom`. */
export type CollisionPresetId =
  | "noCollision"
  | "blockAll"
  | "overlapAll"
  | "blockAllDynamic"
  | "overlapAllDynamic"
  | "pawn"
  | "physicsActor"
  | "trigger"
  | "custom";

export const COLLISION_PRESET_IDS: readonly CollisionPresetId[] = [
  "noCollision",
  "blockAll",
  "overlapAll",
  "blockAllDynamic",
  "overlapAllDynamic",
  "pawn",
  "physicsActor",
  "trigger",
  "custom",
];

/** A fully resolved collision profile (what the runtime ultimately consumes). */
export interface CollisionProfile {
  collisionEnabled: CollisionEnabled;
  objectType: CollisionObjectChannel;
  responses: CollisionResponseTable;
}

/** Simple collision primitive shapes authored in the Static Mesh editor. */
export type CollisionPrimitiveShape = "box" | "sphere" | "capsule" | "convex";

export const COLLISION_PRIMITIVE_SHAPES: readonly CollisionPrimitiveShape[] = [
  "box",
  "sphere",
  "capsule",
  "convex",
];

/**
 * A single simple-collision shape in the asset's local space (before placement
 * scale). `convex` carries baked hull `points` (deferred phase) and ignores
 * `size`.
 */
export interface CollisionPrimitive {
  shape: CollisionPrimitiveShape;
  /** Full local size for box/sphere/capsule (sphere/capsule use the max axis). */
  size: Vec3;
  /** Local center offset from the model origin. Absent means origin. */
  center?: Vec3;
  /** Local rotation in degrees for oriented primitives. Absent means axis-aligned. */
  rotation?: Vec3;
  /** Baked convex hull points (only for `shape === "convex"`). */
  points?: Vec3[];
}

/**
 * Asset-level collision setup (the default for every placement of the asset).
 * Persisted as a `*.collision.json` sidecar next to the model file.
 */
export interface AssetCollisionDef {
  /** Authored simple collision shapes. Empty means "no simple collision". */
  primitives: CollisionPrimitive[];
  complexity: CollisionComplexity;
  preset: CollisionPresetId;
  /** Per-channel overrides; only meaningful when `preset === "custom"`. */
  responses?: CollisionResponseMap;
  /** Physical material reference (friction/restitution/density source). */
  physicalMaterialId?: string;
  /** Use complex (per-poly) collision from both triangle sides. */
  doubleSided?: boolean;
  /** Emit begin/end overlap events for sensors. Absent means true. */
  generateOverlapEvents?: boolean;
  /** Emit hit events while simulating physics. Absent means true. */
  simulationGeneratesHitEvents?: boolean;
}

export const DEFAULT_COLLISION_PRESET: CollisionPresetId = "blockAll";
export const DEFAULT_COLLISION_COMPLEXITY: CollisionComplexity = "projectDefault";

/** Surface response of a physical material: Rapier friction + restitution. */
export interface PhysicalMaterialDef {
  friction: number;
  restitution: number;
}

export const DEFAULT_PHYSICAL_MATERIAL: PhysicalMaterialDef = { friction: 0.8, restitution: 0 };

/** Built-in physical materials referenced by `AssetCollisionDef.physicalMaterialId`. */
export const PHYSICAL_MATERIALS: Record<string, PhysicalMaterialDef> = {
  default: DEFAULT_PHYSICAL_MATERIAL,
  slippery: { friction: 0.05, restitution: 0 },
  rubber: { friction: 0.9, restitution: 0.7 },
  metal: { friction: 0.4, restitution: 0.1 },
  wood: { friction: 0.6, restitution: 0 },
  stone: { friction: 0.7, restitution: 0.05 },
};

export const PHYSICAL_MATERIAL_IDS: readonly string[] = Object.keys(PHYSICAL_MATERIALS);

/** Resolves a physical-material id to its surface response, defaulting safely. */
export function resolvePhysicalMaterial(id: string | undefined): PhysicalMaterialDef {
  if (id && Object.prototype.hasOwnProperty.call(PHYSICAL_MATERIALS, id)) {
    return PHYSICAL_MATERIALS[id]!;
  }
  return DEFAULT_PHYSICAL_MATERIAL;
}

/** A fresh, empty asset collision definition (block-all, no shapes yet). */
export function defaultAssetCollisionDef(): AssetCollisionDef {
  return {
    primitives: [],
    complexity: DEFAULT_COLLISION_COMPLEXITY,
    preset: DEFAULT_COLLISION_PRESET,
  };
}

interface PresetSeed {
  collisionEnabled: CollisionEnabled;
  objectType: CollisionObjectChannel;
  /** Default response applied to every channel. */
  base: CollisionResponse;
  /** Per-channel overrides on top of `base`. */
  overrides?: CollisionResponseMap;
}

function buildResponses(seed: PresetSeed): CollisionResponseTable {
  const table = {} as CollisionResponseTable;
  for (const channel of COLLISION_CHANNELS) {
    table[channel] = seed.overrides?.[channel] ?? seed.base;
  }
  return table;
}

/**
 * Built-in preset seeds. `custom` is intentionally absent: it is resolved from
 * an explicit object type + response map rather than a fixed profile.
 */
const PRESET_SEEDS: Record<Exclude<CollisionPresetId, "custom">, PresetSeed> = {
  noCollision: { collisionEnabled: "none", objectType: "worldStatic", base: "ignore" },
  blockAll: { collisionEnabled: "queryAndPhysics", objectType: "worldStatic", base: "block" },
  overlapAll: { collisionEnabled: "query", objectType: "worldStatic", base: "overlap" },
  blockAllDynamic: {
    collisionEnabled: "queryAndPhysics",
    objectType: "worldDynamic",
    base: "block",
  },
  overlapAllDynamic: {
    collisionEnabled: "query",
    objectType: "worldDynamic",
    base: "overlap",
  },
  pawn: { collisionEnabled: "queryAndPhysics", objectType: "pawn", base: "block" },
  physicsActor: {
    collisionEnabled: "queryAndPhysics",
    objectType: "physicsBody",
    base: "block",
  },
  trigger: {
    collisionEnabled: "query",
    objectType: "trigger",
    base: "overlap",
    overrides: { visibility: "ignore", camera: "ignore" },
  },
};

/**
 * Resolves a preset id (plus optional `custom` object type / response overrides)
 * into a full `CollisionProfile`. For built-in presets the overrides default to
 * the preset's own values; for `custom` they are required-ish (fall back to a
 * block-all world-static profile so callers always get a usable table).
 */
export function resolveCollisionProfile(
  preset: CollisionPresetId,
  custom?: {
    collisionEnabled?: CollisionEnabled;
    objectType?: CollisionObjectChannel;
    responses?: CollisionResponseMap;
  },
): CollisionProfile {
  if (preset !== "custom") {
    const seed = PRESET_SEEDS[preset];
    return {
      collisionEnabled: seed.collisionEnabled,
      objectType: seed.objectType,
      responses: buildResponses(seed),
    };
  }
  const seed: PresetSeed = {
    collisionEnabled: custom?.collisionEnabled ?? "queryAndPhysics",
    objectType: custom?.objectType ?? "worldStatic",
    base: "block",
  };
  if (custom?.responses) seed.overrides = custom.responses;
  return {
    collisionEnabled: seed.collisionEnabled,
    objectType: seed.objectType,
    responses: buildResponses(seed),
  };
}

export function isCollisionEnabled(value: unknown): value is CollisionEnabled {
  return typeof value === "string" && COLLISION_ENABLED_VALUES.includes(value as CollisionEnabled);
}

export function isCollisionComplexity(value: unknown): value is CollisionComplexity {
  return (
    typeof value === "string" &&
    COLLISION_COMPLEXITY_VALUES.includes(value as CollisionComplexity)
  );
}

export function isCollisionPresetId(value: unknown): value is CollisionPresetId {
  return typeof value === "string" && COLLISION_PRESET_IDS.includes(value as CollisionPresetId);
}

export function isCollisionResponse(value: unknown): value is CollisionResponse {
  return (
    typeof value === "string" && COLLISION_RESPONSE_VALUES.includes(value as CollisionResponse)
  );
}

export function isCollisionPrimitiveShape(value: unknown): value is CollisionPrimitiveShape {
  return (
    typeof value === "string" &&
    COLLISION_PRIMITIVE_SHAPES.includes(value as CollisionPrimitiveShape)
  );
}

export function isCollisionObjectChannel(value: unknown): value is CollisionObjectChannel {
  return (
    typeof value === "string" &&
    COLLISION_OBJECT_CHANNELS.includes(value as CollisionObjectChannel)
  );
}
