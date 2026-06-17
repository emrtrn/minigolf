/**
 * Editor-side saving of asset-level collision definitions (`*.collision.json`)
 * via the dev-only `/__save-collision` endpoint (see vite.config.ts). Loading /
 * parsing lives in the runtime-safe `@/scene/assetCollisionLoader`; re-exported
 * here so existing editor imports keep working.
 */
import type { AssetCollisionDef } from "@engine/scene/collision";
import { collisionSidecarPath } from "@/scene/assetCollisionLoader";

export {
  collisionSidecarPath,
  loadAssetCollision,
  normalizeAssetCollisionDef,
} from "@/scene/assetCollisionLoader";

/** Posts an asset collision definition to the dev save endpoint. */
export async function saveAssetCollision(
  modelPath: string,
  def: AssetCollisionDef,
): Promise<{ path: string; changed: boolean }> {
  const path = collisionSidecarPath(modelPath);
  const response = await fetch("/__save-collision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, collision: def }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    path?: string;
    changed?: boolean;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Collision save failed: HTTP ${response.status}`);
  }
  return { path: body.path ?? path, changed: body.changed ?? false };
}
