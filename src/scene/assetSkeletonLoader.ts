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

export interface AssetSkeletonPreviewPrefs {
  selectedClip: string | null;
}

export interface AssetSkeletonDef {
  schema: 1;
  sockets: AssetSkeletonSocketDef[];
  animationSet: Partial<Record<AnimationSetRole, string>>;
  blendSpaces: unknown[];
  notifies: unknown[];
  montages: unknown[];
  preview: AssetSkeletonPreviewPrefs;
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
  return {
    schema: 1,
    sockets: normalizeSockets(input.sockets),
    animationSet: normalizeAnimationSet(input.animationSet),
    blendSpaces: Array.isArray(input.blendSpaces) ? input.blendSpaces : [],
    notifies: Array.isArray(input.notifies) ? input.notifies : [],
    montages: Array.isArray(input.montages) ? input.montages : [],
    preview: normalizePreview(input.preview),
  };
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
