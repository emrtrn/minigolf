/**
 * Asset-level skeletal metadata (`*.skeleton.json` sidecars).
 *
 * Runtime reads are plain static fetches from `public/`; editor-only writes live
 * in `src/editor/assetSkeletonStore.ts`.
 */
import type { Vec3 } from "@engine/scene/layout";
import { projectFileUrl } from "@/project/ProjectSystem";

export const ANIMATION_SET_ROLES = ["idle", "walk", "run", "jump", "fall"] as const;
export type AnimationSetRole = (typeof ANIMATION_SET_ROLES)[number];

export interface AssetSkeletonSocketDef {
  name: string;
  bone: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  previewAssetId?: string;
}

export const PHYSICS_BODY_SHAPES = ["capsule", "sphere", "box"] as const;
export type PhysicsBodyShape = (typeof PHYSICS_BODY_SHAPES)[number];

/**
 * A collision body rigidly attached to a bone/node — the data form of an Unreal
 * Physics Asset body. A primitive shape (`shape` + `size`) at a bone-local
 * offset; sized like {@link AssetSkeletonSocketDef} via a full-extent `size`
 * Vec3 (box: extents; sphere: diameter from the max axis; capsule: radius from
 * X/Z, total height from Y — matching the runtime collider builder). Authored in
 * the editor's Physics mode and consumed by a future Rapier ragdoll. Generic: no
 * game rules.
 */
export interface AssetSkeletonPhysicsBodyDef {
  /** Unique name within the asset. */
  name: string;
  /** Bone/node name this body is rigidly attached to. */
  bone: string;
  shape: PhysicsBodyShape;
  /** Bone-local offset. */
  position: Vec3;
  /** Bone-local rotation (XYZ degrees). */
  rotation: Vec3;
  /** Full local size (box: extents; sphere/capsule: see the interface doc). */
  size: Vec3;
}

/**
 * A joint linking two physics bodies — the data form of an Unreal Physics
 * Constraint, simplified to a cone-twist for ragdolls. The runtime anchors the
 * joint at `bodyB`'s bone and limits angular motion to a `swingDeg` cone plus
 * `twistDeg` of roll. Authored in the editor's Physics mode.
 */
export interface AssetSkeletonPhysicsConstraintDef {
  /** Unique name within the asset. */
  name: string;
  /** Parent body name (the more-rooted limb). */
  bodyA: string;
  /** Child body name (swings/twists relative to A). */
  bodyB: string;
  /** Cone swing half-angle limit in degrees, clamped to [0, 180]. */
  swingDeg: number;
  /** Twist (roll) limit in degrees, clamped to [0, 180]. */
  twistDeg: number;
}

export const BLEND_SPACE_TYPES = ["1d", "2d"] as const;
export type BlendSpaceType = (typeof BLEND_SPACE_TYPES)[number];

/** A parameter axis of a blend space (e.g. planar Speed, aim Yaw). */
export interface BlendSpaceAxisDef {
  /** Display name shown in the editor (e.g. "Speed"). */
  name: string;
  /** Inclusive domain minimum. */
  min: number;
  /** Inclusive domain maximum; normalization keeps it strictly above `min`. */
  max: number;
}

/** A single clip placed at a coordinate inside the blend space. */
export interface BlendSpaceSampleDef {
  /** Clip name carried by the asset. */
  clip: string;
  /** Position on axis X within `[axisX.min, axisX.max]`. */
  x: number;
  /** Position on axis Y (2D blend spaces only). */
  y?: number;
}

/**
 * A continuous, weighted blend of clips parameterized by one or two axes — the
 * data form of an Unreal Blend Space (no node graph). Runtime resolves a param
 * value to per-clip weights (`resolveBlendSpaceWeights`) and drives the mixer.
 */
export interface AssetSkeletonBlendSpaceDef {
  /** Unique name within the asset (referenced by game/runtime data). */
  name: string;
  type: BlendSpaceType;
  axisX: BlendSpaceAxisDef;
  /** Present only for `2d` blend spaces. */
  axisY?: BlendSpaceAxisDef;
  samples: BlendSpaceSampleDef[];
}

/** A clip plus its resolved blend weight for a given parameter value. */
export interface BlendSampleWeight {
  clip: string;
  weight: number;
}

export const MONTAGE_SLOTS = ["upperBody", "fullBody"] as const;
export type MontageSlot = (typeof MONTAGE_SLOTS)[number];

/**
 * A named marker placed at a time on an animation clip — the data form of an
 * Unreal Animation Notify. The runtime fires `name` as the clip's playhead
 * crosses `time` (footstep, hit window, effect trigger); game code decides what
 * the name does, keeping the asset generic.
 */
export interface AssetSkeletonNotifyDef {
  /** Marker name emitted to the runtime (e.g. "footstep", "hit-window"). */
  name: string;
  /** Clip this notify lives on. */
  clip: string;
  /** Time in seconds from the clip start. */
  time: number;
}

/**
 * A one-shot or held action clip layered over the base locomotion — the data
 * form of an Unreal Animation Montage played into a slot. `upperBody` montages
 * blend only over the bones at/under {@link AssetSkeletonDef.upperBodyBone}
 * (Unreal's "Layered Blend Per Bone" + Slot), so legs keep walking while the
 * upper body fires/reloads/aims.
 */
export interface AssetSkeletonMontageDef {
  /** Unique name within the asset; runtime/game data triggers by this name. */
  name: string;
  /** Clip the montage plays. */
  clip: string;
  /** Which body region the montage drives. */
  slot: MontageSlot;
  /** Loop while held (aim poses), or play once (fire/reload). */
  loop: boolean;
  /** Crossfade-in seconds when the montage starts. */
  blendInSeconds: number;
  /** Crossfade-out seconds when it ends/returns to base. */
  blendOutSeconds: number;
}

export const ROOT_MOTION_MODES = ["preserve", "lockXZ", "lockXYZ"] as const;
export type RootMotionMode = (typeof ROOT_MOTION_MODES)[number];

/**
 * Per-clip root-motion playback policy. `lockXZ` keeps vertical root bob/jumps
 * but removes horizontal drift; `lockXYZ` fully pins the root translation to
 * the clip's first frame. The source GLTF is not rewritten.
 */
export interface AssetSkeletonRootMotionDef {
  /** Clip name carried by the asset. */
  clip: string;
  mode: RootMotionMode;
  /** Optional animated node to pin; absent means auto-detect a root-like node. */
  rootNode?: string;
}

export interface AssetSkeletonPreviewPrefs {
  selectedClip: string | null;
}

export interface AssetSkeletonDef {
  schema: 1;
  sockets: AssetSkeletonSocketDef[];
  animationSet: Partial<Record<AnimationSetRole, string>>;
  blendSpaces: AssetSkeletonBlendSpaceDef[];
  notifies: AssetSkeletonNotifyDef[];
  montages: AssetSkeletonMontageDef[];
  /** Clip-level root motion handling for in-place playback. */
  rootMotion: AssetSkeletonRootMotionDef[];
  /** Bone-attached collision bodies (PhAT-lite); consumed by a future ragdoll. */
  physicsBodies: AssetSkeletonPhysicsBodyDef[];
  /** Joints linking physics bodies (ragdoll articulation). */
  physicsConstraints: AssetSkeletonPhysicsConstraintDef[];
  /**
   * Bone/node name that roots the upper-body mask for `upperBody` montages.
   * Everything in its subtree blends to the montage; the rest keeps locomotion.
   * Absent disables upper-body layering (montages fall back to full-body).
   */
  upperBodyBone?: string;
  preview: AssetSkeletonPreviewPrefs;
}

export function defaultBlendSpaceAxis(name: string): BlendSpaceAxisDef {
  return { name, min: 0, max: 1 };
}

export function skeletonSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const withoutExt = normalized.replace(/\.[^./]+$/, "");
  return `${withoutExt}.skeleton.json`;
}

export function defaultAssetSkeleton(): AssetSkeletonDef {
  return {
    schema: 1,
    sockets: [],
    animationSet: {},
    blendSpaces: [],
    notifies: [],
    montages: [],
    rootMotion: [],
    physicsBodies: [],
    physicsConstraints: [],
    preview: { selectedClip: null },
  };
}

export async function loadAssetSkeleton(modelPath: string): Promise<AssetSkeletonDef> {
  const url = projectFileUrl(skeletonSidecarPath(modelPath));
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return defaultAssetSkeleton();
    return normalizeAssetSkeleton(await response.json());
  } catch {
    return defaultAssetSkeleton();
  }
}

export function normalizeAssetSkeleton(value: unknown): AssetSkeletonDef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultAssetSkeleton();
  const input = value as Record<string, unknown>;
  const result: AssetSkeletonDef = {
    schema: 1,
    sockets: normalizeSockets(input.sockets),
    animationSet: normalizeAnimationSet(input.animationSet),
    blendSpaces: normalizeBlendSpaces(input.blendSpaces),
    notifies: normalizeNotifies(input.notifies),
    montages: normalizeMontages(input.montages),
    rootMotion: normalizeRootMotion(input.rootMotion),
    physicsBodies: normalizePhysicsBodies(input.physicsBodies),
    physicsConstraints: normalizePhysicsConstraints(input.physicsConstraints),
    preview: normalizePreview(input.preview),
  };
  if (typeof input.upperBodyBone === "string" && input.upperBodyBone.length > 0) {
    result.upperBodyBone = input.upperBodyBone;
  }
  return result;
}

function normalizeMontages(value: unknown): AssetSkeletonMontageDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonMontageDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.clip !== "string" || input.clip.length === 0) continue;
    if (names.has(input.name)) continue;
    names.add(input.name);
    const montage: AssetSkeletonMontageDef = {
      name: input.name,
      clip: input.clip,
      slot: input.slot === "fullBody" ? "fullBody" : "upperBody",
      loop: input.loop === true,
      blendInSeconds: normalizeBlendSeconds(input.blendInSeconds, 0.12),
      blendOutSeconds: normalizeBlendSeconds(input.blendOutSeconds, 0.2),
    };
    result.push(montage);
  }
  return result;
}

function normalizeRootMotion(value: unknown): AssetSkeletonRootMotionDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonRootMotionDef[] = [];
  const clips = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.clip !== "string" || input.clip.length === 0) continue;
    if (!ROOT_MOTION_MODES.includes(input.mode as RootMotionMode)) continue;
    if (clips.has(input.clip)) continue;
    clips.add(input.clip);
    const entry: AssetSkeletonRootMotionDef = {
      clip: input.clip,
      mode: input.mode as RootMotionMode,
    };
    if (typeof input.rootNode === "string" && input.rootNode.length > 0) {
      entry.rootNode = input.rootNode;
    }
    result.push(entry);
  }
  return result;
}

function normalizePhysicsBodies(value: unknown): AssetSkeletonPhysicsBodyDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonPhysicsBodyDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.bone !== "string" || input.bone.length === 0) continue;
    if (names.has(input.name)) continue;
    names.add(input.name);
    result.push({
      name: input.name,
      bone: input.bone,
      shape: PHYSICS_BODY_SHAPES.includes(input.shape as PhysicsBodyShape)
        ? (input.shape as PhysicsBodyShape)
        : "capsule",
      position: normalizeVec3(input.position, [0, 0, 0]),
      rotation: normalizeVec3(input.rotation, [0, 0, 0]),
      size: normalizePhysicsSize(input.size),
    });
  }
  return result;
}

function normalizePhysicsConstraints(value: unknown): AssetSkeletonPhysicsConstraintDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonPhysicsConstraintDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.bodyA !== "string" || input.bodyA.length === 0) continue;
    if (typeof input.bodyB !== "string" || input.bodyB.length === 0) continue;
    if (input.bodyA === input.bodyB) continue;
    if (names.has(input.name)) continue;
    names.add(input.name);
    result.push({
      name: input.name,
      bodyA: input.bodyA,
      bodyB: input.bodyB,
      swingDeg: normalizeAngleDeg(input.swingDeg, 45),
      twistDeg: normalizeAngleDeg(input.twistDeg, 30),
    });
  }
  return result;
}

function normalizeAngleDeg(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Number(Math.min(Math.max(Number(value), 0), 180).toFixed(2));
}

function normalizePhysicsSize(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((axis) => Number.isFinite(axis))) {
    return [0.2, 0.5, 0.2];
  }
  return value.map((axis) => Number(Math.max(Number(axis), 0.01).toFixed(4))) as Vec3;
}

function normalizeNotifies(value: unknown): AssetSkeletonNotifyDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonNotifyDef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.clip !== "string" || input.clip.length === 0) continue;
    const time = Number.isFinite(input.time) ? Math.max(0, Number(input.time)) : 0;
    result.push({ name: input.name, clip: input.clip, time: Number(time.toFixed(4)) });
  }
  return result;
}

function normalizeBlendSeconds(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Number(Math.min(Math.max(Number(value), 0), 4).toFixed(3));
}

function normalizeAnimationSet(value: unknown): Partial<Record<AnimationSetRole, string>> {
  const result: Partial<Record<AnimationSetRole, string>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  for (const role of ANIMATION_SET_ROLES) {
    const clip = input[role];
    if (typeof clip === "string" && clip.length > 0) result[role] = clip;
  }
  return result;
}

function normalizeSockets(value: unknown): AssetSkeletonSocketDef[] {
  if (!Array.isArray(value)) return [];
  const sockets: AssetSkeletonSocketDef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.bone !== "string" || input.bone.length === 0) continue;
    const socket: AssetSkeletonSocketDef = {
      name: input.name,
      bone: input.bone,
      position: normalizeVec3(input.position, [0, 0, 0]),
      rotation: normalizeVec3(input.rotation, [0, 0, 0]),
      scale: normalizeVec3(input.scale, [1, 1, 1]),
    };
    if (typeof input.previewAssetId === "string" && input.previewAssetId.length > 0) {
      socket.previewAssetId = input.previewAssetId;
    }
    sockets.push(socket);
  }
  return sockets;
}

function normalizeBlendSpaces(value: unknown): AssetSkeletonBlendSpaceDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonBlendSpaceDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (names.has(input.name)) continue;
    const type: BlendSpaceType = input.type === "2d" ? "2d" : "1d";
    const axisX = normalizeBlendAxis(input.axisX, "Speed");
    const axisY = type === "2d" ? normalizeBlendAxis(input.axisY, "Direction") : undefined;
    const blendSpace: AssetSkeletonBlendSpaceDef = {
      name: input.name,
      type,
      axisX,
      samples: normalizeBlendSamples(input.samples, type, axisX, axisY),
    };
    if (axisY) blendSpace.axisY = axisY;
    names.add(input.name);
    result.push(blendSpace);
  }
  return result;
}

function normalizeBlendAxis(value: unknown, fallbackName: string): BlendSpaceAxisDef {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const name = typeof input.name === "string" && input.name.length > 0 ? input.name : fallbackName;
  const min = Number.isFinite(input.min) ? roundAxis(Number(input.min)) : 0;
  let max = Number.isFinite(input.max) ? roundAxis(Number(input.max)) : 1;
  if (max <= min) max = min + 1;
  return { name, min, max };
}

function normalizeBlendSamples(
  value: unknown,
  type: BlendSpaceType,
  axisX: BlendSpaceAxisDef,
  axisY: BlendSpaceAxisDef | undefined,
): BlendSpaceSampleDef[] {
  if (!Array.isArray(value)) return [];
  const samples: BlendSpaceSampleDef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.clip !== "string" || input.clip.length === 0) continue;
    const x = clampAxis(input.x, axisX);
    const sample: BlendSpaceSampleDef = { clip: input.clip, x };
    if (type === "2d" && axisY) sample.y = clampAxis(input.y, axisY);
    samples.push(sample);
  }
  return samples;
}

function clampAxis(value: unknown, axis: BlendSpaceAxisDef): number {
  const raw = Number.isFinite(value) ? Number(value) : axis.min;
  return roundAxis(Math.min(Math.max(raw, axis.min), axis.max));
}

function roundAxis(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Resolves a blend-space parameter to per-clip weights summing to 1.
 *
 * 1D: piecewise-linear interpolation between the two bracketing samples
 * (clamped at the ends) — the classic locomotion idle↔walk↔run blend.
 * 2D: normalized inverse-distance-squared (Shepard) weighting over all samples,
 * with an exact-sample short-circuit. Pure and deterministic; clips appearing on
 * multiple samples have their weights merged (insertion order preserved).
 */
export function resolveBlendSpaceWeights(
  blendSpace: AssetSkeletonBlendSpaceDef,
  params: { x: number; y?: number },
): BlendSampleWeight[] {
  const samples = blendSpace.samples;
  if (samples.length === 0) return [];
  if (samples.length === 1) return [{ clip: samples[0]!.clip, weight: 1 }];
  const raw =
    blendSpace.type === "2d"
      ? resolveWeights2d(samples, clampAxis(params.x, blendSpace.axisX), clampAxis(params.y, blendSpace.axisY ?? blendSpace.axisX))
      : resolveWeights1d(samples, clampAxis(params.x, blendSpace.axisX));
  return mergeWeights(raw);
}

function resolveWeights1d(samples: BlendSpaceSampleDef[], x: number): BlendSampleWeight[] {
  const sorted = [...samples].sort((a, b) => a.x - b.x);
  const clamped = Math.min(Math.max(x, sorted[0]!.x), sorted[sorted.length - 1]!.x);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (clamped < a.x || clamped > b.x) continue;
    const span = b.x - a.x;
    if (span <= 1e-9) return [{ clip: a.clip, weight: 1 }];
    const t = (clamped - a.x) / span;
    return [
      { clip: a.clip, weight: 1 - t },
      { clip: b.clip, weight: t },
    ];
  }
  return [{ clip: sorted[sorted.length - 1]!.clip, weight: 1 }];
}

function resolveWeights2d(samples: BlendSpaceSampleDef[], x: number, y: number): BlendSampleWeight[] {
  const distances = samples.map((sample) => {
    const dx = sample.x - x;
    const dy = (sample.y ?? 0) - y;
    return dx * dx + dy * dy;
  });
  const exact = distances.findIndex((d) => d <= 1e-9);
  if (exact >= 0) return [{ clip: samples[exact]!.clip, weight: 1 }];
  return samples.map((sample, index) => ({ clip: sample.clip, weight: 1 / distances[index]! }));
}

function mergeWeights(weights: BlendSampleWeight[]): BlendSampleWeight[] {
  const order: string[] = [];
  const byClip = new Map<string, number>();
  let total = 0;
  for (const { clip, weight } of weights) {
    if (weight <= 0) continue;
    if (!byClip.has(clip)) order.push(clip);
    byClip.set(clip, (byClip.get(clip) ?? 0) + weight);
    total += weight;
  }
  if (total <= 0) return [];
  return order.map((clip) => ({ clip, weight: (byClip.get(clip) ?? 0) / total }));
}

function normalizePreview(value: unknown): AssetSkeletonPreviewPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { selectedClip: null };
  }
  const selectedClip = (value as Record<string, unknown>).selectedClip;
  return { selectedClip: typeof selectedClip === "string" && selectedClip.length > 0 ? selectedClip : null };
}

function normalizeVec3(value: unknown, fallback: Vec3): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((axis) => Number.isFinite(axis))
  ) {
    return [...fallback] as Vec3;
  }
  return value.map((axis) => Number(Number(axis).toFixed(4))) as Vec3;
}
