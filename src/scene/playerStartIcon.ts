import { type Sprite } from "three";

import { createActorBillboardIcon } from "@engine/render-three/actorIcon";

const PLAYER_START_ICON_BLUE = "#2b7fff";

/** Center billboard icon for selecting/identifying a Player Start marker. */
export function createPlayerStartIcon(): Sprite {
  return createActorBillboardIcon("player-start", drawPlayerStartGlyph, 0.28);
}

function drawPlayerStartGlyph(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 36, 58, 0.92)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PLAYER_START_ICON_BLUE;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy - 9, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, cy - 2);
  ctx.lineTo(cx - 9, cy + 15);
  ctx.lineTo(cx + 9, cy + 15);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}
