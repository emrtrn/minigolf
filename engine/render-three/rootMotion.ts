import { AnimationClip, PropertyBinding } from "three";
import type { KeyframeTrack } from "three";

export type RootMotionMode = "preserve" | "lockXZ" | "lockXYZ";

export interface RootMotionClipSetting {
  readonly clip: string;
  readonly mode: RootMotionMode;
  readonly rootNode?: string;
}

const ROOT_NODE_CANDIDATES = [
  "Root",
  "root",
  "Armature",
  "armature",
  "Hips",
  "hips",
  "mixamorigHips",
  "mixamorig:Hips",
];

export function applyRootMotionToClips(
  clips: readonly AnimationClip[],
  settings: readonly RootMotionClipSetting[] | undefined,
): AnimationClip[] {
  return clips.map((clip) => applyRootMotionToClip(clip, rootMotionSettingForClip(settings, clip.name)));
}

export function applyRootMotionToClip(
  clip: AnimationClip,
  setting: RootMotionClipSetting | undefined,
): AnimationClip {
  if (!setting || setting.clip !== clip.name || setting.mode === "preserve") return clip;
  const mode: Exclude<RootMotionMode, "preserve"> = setting.mode === "lockXYZ" ? "lockXYZ" : "lockXZ";
  const rootNode = resolveRootMotionNode(clip, setting.rootNode);
  if (!rootNode) return clip;
  let changed = false;
  const tracks = clip.tracks.map((track) => {
    const parsed = PropertyBinding.parseTrackName(track.name);
    if (parsed.nodeName !== rootNode || parsed.propertyName !== "position") return track;
    const next = lockPositionTrack(track, mode);
    changed ||= next !== track;
    return next;
  });
  return changed ? new AnimationClip(clip.name, clip.duration, tracks) : clip;
}

export function rootMotionSettingForClip(
  settings: readonly RootMotionClipSetting[] | undefined,
  clipName: string,
): RootMotionClipSetting | undefined {
  return settings?.find((setting) => setting.clip === clipName);
}

export function rootMotionPositionNodes(clip: AnimationClip): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const track of clip.tracks) {
    const parsed = PropertyBinding.parseTrackName(track.name);
    if (parsed.propertyName !== "position" || !parsed.nodeName || seen.has(parsed.nodeName)) continue;
    seen.add(parsed.nodeName);
    names.push(parsed.nodeName);
  }
  return names;
}

function resolveRootMotionNode(clip: AnimationClip, authoredNode: string | undefined): string | null {
  const nodes = rootMotionPositionNodes(clip);
  if (nodes.length === 0) return null;
  if (authoredNode && nodes.includes(authoredNode)) return authoredNode;
  return ROOT_NODE_CANDIDATES.find((candidate) => nodes.includes(candidate)) ?? nodes[0] ?? null;
}

function lockPositionTrack(track: KeyframeTrack, mode: Exclude<RootMotionMode, "preserve">): KeyframeTrack {
  if (track.values.length < 3) return track;
  const next = track.clone();
  const values = next.values;
  const baseX = Number(values[0] ?? 0);
  const baseY = Number(values[1] ?? 0);
  const baseZ = Number(values[2] ?? 0);
  for (let index = 0; index + 2 < values.length; index += 3) {
    values[index] = baseX;
    if (mode === "lockXYZ") values[index + 1] = baseY;
    values[index + 2] = baseZ;
  }
  return next;
}
