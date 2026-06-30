/**
 * Sound Cue asset I/O for the editor (dev-only).
 *
 * Loads `*.soundcue.json` assets from the project public root and saves them
 * back through the dev `/__save-soundcue` endpoint, which re-validates and
 * normalises the payload server-side (see `tools/saveValidator.ts`). Mirrors
 * the pattern of `materialStore.ts` and `uiWidgetStore.ts`.
 */
import type { SoundCueAsset } from "@engine/audio/soundCueTypes";
import { projectFileUrl } from "@/project/ProjectSystem";

/** Returns a minimal valid SoundCue as a fallback when the file is missing/corrupt. */
function fallbackCue(name: string): SoundCueAsset {
  return {
    schema: 1,
    type: "soundCue",
    name,
    output: { volume: 1, pitch: 1, bus: "sfx" },
    nodes: [{ id: "output", kind: "output", volume: 1, pitch: 1 }],
    connections: [],
  };
}

export async function loadSoundCueAsset(
  path: string,
  fallbackName = "Sound Cue",
): Promise<SoundCueAsset> {
  try {
    const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
    if (!response.ok) return fallbackCue(fallbackName);
    const data = (await response.json()) as SoundCueAsset;
    if (data?.schema !== 1 || data?.type !== "soundCue") return fallbackCue(fallbackName);
    return data;
  } catch {
    return fallbackCue(fallbackName);
  }
}

export async function saveSoundCueAsset(
  path: string,
  cue: SoundCueAsset,
): Promise<{ path: string; changed: boolean }> {
  const response = await fetch("/__save-soundcue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, cue }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    path?: string;
    changed?: boolean;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Sound Cue save failed: HTTP ${response.status}`);
  }
  return { path: body.path ?? path, changed: body.changed ?? false };
}
