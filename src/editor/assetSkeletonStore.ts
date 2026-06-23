/**
 * Editor-side saving of asset-level skeletal metadata sidecars
 * (`*.skeleton.json`).
 */
import {
  normalizeAssetSkeleton,
  skeletonSidecarPath,
  type AssetSkeletonDef,
} from "@/scene/assetSkeletonLoader";

export {
  ANIMATION_SET_ROLES,
  defaultAssetSkeleton,
  loadAssetSkeleton,
  normalizeAssetSkeleton,
  skeletonSidecarPath,
} from "@/scene/assetSkeletonLoader";
export type {
  AnimationSetRole,
  AssetSkeletonDef,
  AssetSkeletonPreviewPrefs,
  AssetSkeletonSocketDef,
} from "@/scene/assetSkeletonLoader";

export async function saveAssetSkeleton(
  modelPath: string,
  skeleton: AssetSkeletonDef,
): Promise<{ path: string; changed: boolean }> {
  const path = skeletonSidecarPath(modelPath);
  const response = await fetch("/__save-skeleton", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, skeleton: normalizeAssetSkeleton(skeleton) }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    path?: string;
    changed?: boolean;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Skeleton metadata save failed: HTTP ${response.status}`);
  }
  return { path: body.path ?? path, changed: body.changed ?? false };
}
