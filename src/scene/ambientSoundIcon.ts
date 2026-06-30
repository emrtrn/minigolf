import { type Sprite } from "three";

import { createActorBillboardIcon } from "@engine/render-three/actorIcon";

const AMBIENT_SOUND_ICON_BLUE = "#2b7fff";

/** Center billboard icon for selecting/identifying an Ambient Sound emitter. */
export function createAmbientSoundIcon(): Sprite {
  return createActorBillboardIcon("ambient-sound", drawSpeakerGlyph, 0.28);
}

/** A speaker cone with two emanating sound waves. */
function drawSpeakerGlyph(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 36, 58, 0.92)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = AMBIENT_SOUND_ICON_BLUE;
  ctx.stroke();

  // Speaker body (small rectangle) + cone, pointing right.
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx - 11, cy - 5);
  ctx.lineTo(cx - 5, cy - 5);
  ctx.lineTo(cx + 2, cy - 11);
  ctx.lineTo(cx + 2, cy + 11);
  ctx.lineTo(cx - 5, cy + 5);
  ctx.lineTo(cx - 11, cy + 5);
  ctx.closePath();
  ctx.fill();

  // Two sound-wave arcs.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx + 2, cy, 8, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 2, cy, 13, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();
}
