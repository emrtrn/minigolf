import type { Vec2 } from "./miniGolfBallPhysics";

export interface MiniGolfAimInput {
  readonly start: Vec2;
  readonly current: Vec2;
  readonly maxDragPixels: number;
  readonly cameraRight: Vec2;
  readonly cameraForward: Vec2;
}

export interface MiniGolfAim {
  readonly direction: Vec2;
  readonly power: number;
  readonly dragPixels: number;
}

export function computeMiniGolfAim(input: MiniGolfAimInput): MiniGolfAim {
  const dx = input.current[0] - input.start[0];
  const dy = input.current[1] - input.start[1];
  const dragPixels = Math.hypot(dx, dy);
  const maxDragPixels = Math.max(1, input.maxDragPixels);
  const power = clamp(dragPixels / maxDragPixels, 0, 1);
  const right = normalize(input.cameraRight);
  const forward = normalize(input.cameraForward);
  const dragWorld: Vec2 = [
    right[0] * dx + forward[0] * -dy,
    right[1] * dx + forward[1] * -dy,
  ];
  return {
    direction: normalize([-dragWorld[0], -dragWorld[1]]),
    power,
    dragPixels,
  };
}

function normalize(value: Vec2): Vec2 {
  const length = Math.hypot(value[0], value[1]);
  return length > 0 ? [value[0] / length, value[1] / length] : [0, 0];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
