import { Vector3 } from "three";
import { instanceEntityId } from "@engine/scene/legacyRoomLayoutAdapter";
import type { LayoutPlacement, RoomLayout } from "@engine/scene/layout";
import { readRotation, readScale } from "@engine/scene/transform";
import type { TransformComponent } from "@engine/scene/components";
import type { AssetCollisionDef, CollisionPrimitive } from "@engine/scene/collision";
import type { Aabb3 } from "@/game/collision";
import { computeMiniGolfAim, type MiniGolfAim } from "./miniGolfAim";
import {
  DEFAULT_MINI_GOLF_PHYSICS,
  applyMiniGolfPutt,
  createMiniGolfBallState,
  stepMiniGolfBall,
  type MiniGolfAabb2,
  type MiniGolfBallState,
  type MiniGolfCourse,
  type MiniGolfPhysicsConfig,
  type MiniGolfSurface,
  type Vec2,
} from "./miniGolfBallPhysics";
import type {
  GameModeContext,
  GameModeDefinition,
  GameModeSession,
  GameState,
  PlayerControllerDefinition,
  PlayerState,
} from "@/game/gameModes/types";

export const MINI_GOLF_GAME_MODE_ID = "minigolf.singleHole";

const MAX_DRAG_PIXELS = 180;
const BALL_HIT_RADIUS_PIXELS = 48;
const BALL_VISUAL_RADIUS = 0.035;
const ORBIT_DISTANCE = 5.8;
const ORBIT_HEIGHT = 3.2;
const ORBIT_SENSITIVITY = 0.006;
const SURFACE_BOX_MAX_HEIGHT = 0.075;
const WALL_TOP_CLEARANCE = 0.035;
const MESH_SURFACE_MAX_THICKNESS = 0.12;
const MESH_SURFACE_MIN_FOOTPRINT = 0.004;
const MESH_SURFACE_SAMPLE_PADDING = 0.002;
const MESH_SURFACE_SLOPE_SAMPLE_STEP = 0.12;
const MESH_SURFACE_MAX_SLOPE = 0.8;
const MINI_GOLF_RUNTIME_PHYSICS: Partial<MiniGolfPhysicsConfig> = {
  ...DEFAULT_MINI_GOLF_PHYSICS,
  ballRadius: BALL_VISUAL_RADIUS,
};

interface MiniGolfPlacementRef {
  readonly assetId: string;
  readonly placementIndex: number;
  readonly placement: LayoutPlacement;
}

class MiniGolfSingleHoleSession implements GameModeSession {
  readonly playerState: PlayerState = {
    pawnEntityId: null,
    possessed: false,
    pawnControlSuspended: false,
  };
  readonly gameState: GameState = { elapsedSeconds: 0 };

  private ballRef: MiniGolfPlacementRef | null = null;
  private ball: MiniGolfBallState | null = null;
  private course: MiniGolfCourse = {};
  private hud: MiniGolfHud | null = null;
  private drag: { pointerId: number; start: Vec2; current: Vec2; aim: MiniGolfAim } | null = null;
  private strokes = 0;
  private penaltyStrokes = 0;
  private par = 3;
  private cameraYaw = 0;
  private readonly cameraForward = new Vector3();

  constructor(private readonly context: GameModeContext) {}

  spawnDefaultPawn(): void {
    this.ballRef = findPlacementByRole(this.context.layout, "ball-spawn");
    const pos = this.ballRef?.placement.position ?? findPlacementByRole(this.context.layout, "tee")?.placement.position;
    if (!pos) return;
    this.course = buildMiniGolfCourse(
      this.context.layout,
      this.context.getAssetCollisionDef,
      this.context.staticBlockerAabbs(),
    );
    const surfaceHeight = this.course.defaultSurface?.height ?? 0;
    this.ball = createMiniGolfBallState([pos[0], surfaceHeight + BALL_VISUAL_RADIUS, pos[2]]);
    this.par = readPar(this.context.layout);
    if (this.ballRef) this.syncBallVisual();
  }

  possess(): void {
    this.context.setInputMode("game");
    this.context.setMouseCursorVisible(true);
    this.context.setPointerLookMode("right-drag");
    this.context.markCameraControlled();
    this.hud = new MiniGolfHud();
    this.context.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.context.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.context.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.context.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.updateCamera(1);
    this.updateHud();
  }

  update(deltaSeconds: number): void {
    this.gameState.elapsedSeconds += deltaSeconds;
    if (this.context.getInputMode() !== "ui") {
      const look = this.context.consumeLookDelta();
      this.cameraYaw += look.dx * ORBIT_SENSITIVITY;
    }

    const before = this.ball;
    if (this.ball && !this.ball.resting && !this.ball.inCup) {
      this.ball = stepMiniGolfBall(this.ball, this.course, deltaSeconds, MINI_GOLF_RUNTIME_PHYSICS);
      this.syncBallVisual();
      this.dispatchPhysicsEvents(before, this.ball);
    }

    this.updateCamera(deltaSeconds);
    this.updateHud();
  }

  getCameraDebug(): {
    readonly controlYawDeg: number | null;
    readonly controlPitchDeg: number | null;
    readonly cameraSource: string | null;
  } {
    return {
      controlYawDeg: this.cameraYaw * (180 / Math.PI),
      controlPitchDeg: null,
      cameraSource: "mini golf orbit",
    };
  }

  dispose(): void {
    this.context.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.context.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.context.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.context.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.hud?.dispose();
    this.hud = null;
    this.drag = null;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.context.getInputMode() === "ui") return;
    if (!this.ball || !this.ball.resting || this.ball.inCup) return;
    if (!this.pointerHitsBall(event.clientX, event.clientY)) return;
    event.preventDefault();
    const start: Vec2 = [event.clientX, event.clientY];
    const aim = this.aimFromPointer(start, start);
    this.drag = { pointerId: event.pointerId, start, current: start, aim };
    try {
      this.context.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; window focus loss still releases via pointercancel.
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    event.preventDefault();
    const current: Vec2 = [event.clientX, event.clientY];
    this.drag = {
      ...this.drag,
      current,
      aim: this.aimFromPointer(this.drag.start, current),
    };
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    event.preventDefault();
    const aim = this.drag.aim;
    this.drag = null;
    try {
      if (this.context.canvas.hasPointerCapture(event.pointerId)) {
        this.context.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be released.
    }
    if (!this.ball || aim.power < 0.03) return;
    this.ball = applyMiniGolfPutt(this.ball, aim.direction, aim.power);
    this.strokes += 1;
    this.context.dispatchGameEvent({ kind: "add", variable: "strokes", amount: 1 });
    this.syncBallVisual();
  };

  private aimFromPointer(start: Vec2, current: Vec2): MiniGolfAim {
    const basis = this.cameraPlanarBasis();
    return computeMiniGolfAim({
      start,
      current,
      maxDragPixels: MAX_DRAG_PIXELS,
      cameraRight: basis.right,
      cameraForward: basis.forward,
    });
  }

  private cameraPlanarBasis(): { right: Vec2; forward: Vec2 } {
    const elements = this.context.camera.matrixWorld.elements;
    const right: Vec2 = normalize2([elements[0] ?? 1, elements[2] ?? 0]);
    this.context.camera.getWorldDirection(this.cameraForward);
    const forward: Vec2 = normalize2([this.cameraForward.x, this.cameraForward.z]);
    return { right, forward };
  }

  private pointerHitsBall(clientX: number, clientY: number): boolean {
    const screen = this.ballScreenPosition();
    if (!screen) return false;
    return Math.hypot(clientX - screen[0], clientY - screen[1]) <= BALL_HIT_RADIUS_PIXELS;
  }

  private ballScreenPosition(): Vec2 | null {
    if (!this.ball) return null;
    const rect = this.context.canvas.getBoundingClientRect();
    const p = new Vector3(this.ball.pos[0], this.ball.pos[1], this.ball.pos[2]).project(this.context.camera);
    if (p.z < -1 || p.z > 1) return null;
    return [
      rect.left + ((p.x + 1) / 2) * rect.width,
      rect.top + ((1 - p.y) / 2) * rect.height,
    ];
  }

  private updateCamera(_deltaSeconds: number): void {
    const ball = this.ball;
    if (!ball) return;
    const x = ball.pos[0] + Math.sin(this.cameraYaw) * ORBIT_DISTANCE;
    const z = ball.pos[2] + Math.cos(this.cameraYaw) * ORBIT_DISTANCE;
    this.context.camera.position.set(x, ball.pos[1] + ORBIT_HEIGHT, z);
    this.context.camera.lookAt(ball.pos[0], ball.pos[1], ball.pos[2]);
    this.context.camera.updateMatrixWorld();
  }

  private updateHud(): void {
    this.hud?.update({
      strokes: this.strokes,
      par: this.par,
      power: this.drag?.aim.power ?? 0,
      dragging: Boolean(this.drag),
      inCup: this.ball?.inCup ?? false,
      ballScreen: this.ballScreenPosition(),
      dragStart: this.drag?.start ?? null,
      dragCurrent: this.drag?.current ?? null,
    });
  }

  private dispatchPhysicsEvents(previous: MiniGolfBallState | null, next: MiniGolfBallState): void {
    if (!previous) return;
    const penaltyDelta = next.penaltyStrokes - this.penaltyStrokes;
    if (penaltyDelta > 0) {
      this.penaltyStrokes = next.penaltyStrokes;
      this.strokes += penaltyDelta;
      this.context.dispatchGameEvent({ kind: "add", variable: "strokes", amount: penaltyDelta });
    }
    if (!previous.inCup && next.inCup) {
      this.context.dispatchGameEvent({ kind: "objective", id: "hole-1" });
    }
  }

  private syncBallVisual(): void {
    if (!this.ball || !this.ballRef) return;
    this.context.setEntityTransform(instanceEntityId(this.ballRef.assetId, this.ballRef.placementIndex), {
      position: [this.ball.pos[0], this.ball.pos[1], this.ball.pos[2]],
      rotation: readRotation(this.ballRef.placement),
      scale: readScale(this.ballRef.placement),
    } satisfies TransformComponent);
  }
}

class MiniGolfHud {
  private readonly root = document.createElement("div");
  private readonly text = document.createElement("div");
  private readonly fill = document.createElement("div");
  private readonly hint = document.createElement("div");
  private readonly aimLine = document.createElement("div");

  constructor() {
    this.root.style.cssText = [
      "position:fixed",
      "left:16px",
      "bottom:16px",
      "z-index:18",
      "width:260px",
      "padding:10px 12px",
      "border-radius:8px",
      "background:rgba(14,20,24,0.78)",
      "color:#fff",
      "font:600 14px system-ui,sans-serif",
      "letter-spacing:0",
      "pointer-events:none",
      "box-shadow:0 8px 24px rgba(0,0,0,0.25)",
    ].join(";");
    const track = document.createElement("div");
    track.style.cssText = [
      "height:8px",
      "margin-top:8px",
      "border-radius:999px",
      "background:rgba(255,255,255,0.24)",
      "overflow:hidden",
    ].join(";");
    this.fill.style.cssText = [
      "height:100%",
      "width:0%",
      "background:linear-gradient(90deg,#3ecf72,#f2d24b,#ef5b4d)",
      "transition:width 80ms linear",
    ].join(";");
    this.hint.style.cssText = "margin-top:7px;color:rgba(255,255,255,0.72);font-weight:500";
    track.append(this.fill);
    this.root.append(this.text, track, this.hint);
    this.aimLine.style.cssText = [
      "position:fixed",
      "z-index:17",
      "height:4px",
      "border-radius:999px",
      "background:#ffffff",
      "box-shadow:0 0 10px rgba(0,0,0,0.35)",
      "transform-origin:0 50%",
      "pointer-events:none",
      "display:none",
    ].join(";");
    document.body.append(this.root, this.aimLine);
  }

  update(state: {
    readonly strokes: number;
    readonly par: number;
    readonly power: number;
    readonly dragging: boolean;
    readonly inCup: boolean;
    readonly ballScreen: Vec2 | null;
    readonly dragStart: Vec2 | null;
    readonly dragCurrent: Vec2 | null;
  }): void {
    this.text.textContent = `Hole 1  Par ${state.par}  Strokes ${state.strokes}`;
    this.fill.style.width = `${Math.round(state.power * 100)}%`;
    this.hint.textContent = state.inCup
      ? "In cup"
      : state.dragging
        ? "Release to putt"
        : "Drag from the ball";
    this.updateAimLine(state);
  }

  dispose(): void {
    this.root.remove();
    this.aimLine.remove();
  }

  private updateAimLine(state: {
    readonly dragging: boolean;
    readonly ballScreen: Vec2 | null;
    readonly dragStart: Vec2 | null;
    readonly dragCurrent: Vec2 | null;
  }): void {
    if (!state.dragging || !state.ballScreen || !state.dragStart || !state.dragCurrent) {
      this.aimLine.style.display = "none";
      return;
    }
    const dx = state.dragStart[0] - state.dragCurrent[0];
    const dy = state.dragStart[1] - state.dragCurrent[1];
    const length = Math.min(MAX_DRAG_PIXELS, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    this.aimLine.style.display = "block";
    this.aimLine.style.left = `${state.ballScreen[0]}px`;
    this.aimLine.style.top = `${state.ballScreen[1]}px`;
    this.aimLine.style.width = `${length}px`;
    this.aimLine.style.transform = `rotate(${angle}rad)`;
  }
}

function findPlacementByRole(layout: RoomLayout, role: string): MiniGolfPlacementRef | null {
  for (const instance of layout.instances) {
    const placementIndex = instance.placements.findIndex(
      (placement) => placement.metadata?.minigolfRole === role,
    );
    if (placementIndex >= 0) {
      return {
        assetId: instance.assetId,
        placementIndex,
        placement: instance.placements[placementIndex]!,
      };
    }
  }
  return null;
}

export function buildMiniGolfCourse(
  layout: RoomLayout,
  getAssetCollisionDef: (assetId: string) => AssetCollisionDef | undefined,
  staticBlockers: readonly Aabb3[] = [],
): MiniGolfCourse {
  const cup = findPlacementByRole(layout, "cup")?.placement;
  const collisionBoxes = collectCourseCollisionBoxes(layout, getAssetCollisionDef);
  const surfaceBoxes = collisionBoxes.filter((box) => box.kind === "surface");
  const surfaceHeight = collisionBoxes
    .filter((box) => box.kind === "surface")
    .reduce((height, box) => Math.max(height, box.top), 0);
  const surfaces = [
    ...surfaceBoxes.map((box) => surfaceFromCourseBox(box)),
    ...meshSurfacesFromBlockers(staticBlockers, collisionBoxes),
  ];
  const walls = collisionBoxes
    .filter((box) => box.kind === "wall" && box.top > surfaceHeight + WALL_TOP_CLEARANCE)
    .map((box) => ({
      bounds: box.bounds,
      ...(box.restitution !== undefined ? { restitution: box.restitution } : {}),
    }));
  const playable = layout.instances
    .flatMap((instance) => instance.placements)
    .filter((placement) => placement.metadata?.role !== "camera-start");
  const xs = playable.map((placement) => placement.position[0]);
  const zs = playable.map((placement) => placement.position[2]);
  return {
    bounds: {
      min: [Math.min(...xs, -1) - 0.55, Math.min(...zs, -8) - 1],
      max: [Math.max(...xs, 1) + 0.55, Math.max(...zs, 1) + 1],
    },
    walls,
    surfaces,
    defaultSurface: { height: surfaceHeight + BALL_VISUAL_RADIUS, friction: 1 },
    ...(cup
      ? {
          cup: {
            center: [cup.position[0], surfaceHeight + BALL_VISUAL_RADIUS, cup.position[2]],
            radius: numberMeta(cup, "radius", 0.35),
            captureSpeed: numberMeta(cup, "captureSpeed", 0.75),
          },
        }
      : {}),
  };
}

interface CourseCollisionBox {
  readonly kind: "surface" | "wall";
  readonly bounds: MiniGolfAabb2;
  readonly top: number;
  readonly restitution?: number;
}

function collectCourseCollisionBoxes(
  layout: RoomLayout,
  getAssetCollisionDef: (assetId: string) => AssetCollisionDef | undefined,
): CourseCollisionBox[] {
  const boxes: CourseCollisionBox[] = [];
  for (const instance of layout.instances) {
    const def = getAssetCollisionDef(instance.assetId);
    if (!def) continue;
    for (const placement of instance.placements) {
      if (placement.hidden || placement.collision === false) continue;
      for (const primitive of def.primitives) {
        const box = primitiveCourseBox(primitive, placement);
        if (box) boxes.push(box);
      }
    }
  }
  return boxes;
}

function primitiveCourseBox(
  primitive: CollisionPrimitive,
  placement: LayoutPlacement,
): CourseCollisionBox | null {
  if (primitive.shape !== "box") return null;
  const scale = readScale(placement);
  const halfX = Math.abs(primitive.size[0] * scale[0]) / 2;
  const halfZ = Math.abs(primitive.size[2] * scale[2]) / 2;
  if (halfX <= 0 || halfZ <= 0) return null;
  const center = primitive.center ?? [0, 0, 0];
  const rotation = readRotation(placement);
  const yaw = degreesToRadians(rotation[1] + (primitive.rotation?.[1] ?? 0));
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const localX = center[0] * scale[0];
  const localZ = center[2] * scale[2];
  const centerX = placement.position[0] + localX * cos + localZ * sin;
  const centerZ = placement.position[2] + -localX * sin + localZ * cos;
  const extX = Math.abs(cos) * halfX + Math.abs(sin) * halfZ;
  const extZ = Math.abs(sin) * halfX + Math.abs(cos) * halfZ;
  const sizeY = Math.abs(primitive.size[1] * scale[1]);
  const centerY = placement.position[1] + center[1] * scale[1];
  const top = centerY + sizeY / 2;
  return {
    kind: sizeY <= SURFACE_BOX_MAX_HEIGHT ? "surface" : "wall",
    bounds: {
      min: [centerX - extX, centerZ - extZ],
      max: [centerX + extX, centerZ + extZ],
    },
    top,
    restitution: 0.65,
  };
}

function surfaceFromCourseBox(box: CourseCollisionBox): MiniGolfSurface {
  return {
    bounds: box.bounds,
    height: box.top + BALL_VISUAL_RADIUS,
    friction: 1,
  };
}

function meshSurfacesFromBlockers(
  staticBlockers: readonly Aabb3[],
  authoredBoxes: readonly CourseCollisionBox[],
): MiniGolfSurface[] {
  const blockers = staticBlockers.filter(
    (blocker) => isMeshSurfaceBlocker(blocker) && !matchesAuthoredCourseBox(blocker, authoredBoxes),
  );
  if (blockers.length === 0) return [];
  const bounds = unionBlockerBounds(blockers);
  const surface: MiniGolfSurface = {
    bounds,
    friction: 1,
    heightAt: (x, z) => heightFromMeshBlockers(blockers, x, z),
    slopeAt: (x, z) => slopeFromMeshBlockers(blockers, x, z),
  };
  return [surface];
}

function isMeshSurfaceBlocker(blocker: Aabb3): boolean {
  const sizeX = blocker.max[0] - blocker.min[0];
  const sizeY = blocker.max[1] - blocker.min[1];
  const sizeZ = blocker.max[2] - blocker.min[2];
  return (
    Number.isFinite(sizeX) &&
    Number.isFinite(sizeY) &&
    Number.isFinite(sizeZ) &&
    sizeX > MESH_SURFACE_MIN_FOOTPRINT &&
    sizeZ > MESH_SURFACE_MIN_FOOTPRINT &&
    sizeY >= 0 &&
    sizeY <= MESH_SURFACE_MAX_THICKNESS
  );
}

function matchesAuthoredCourseBox(blocker: Aabb3, boxes: readonly CourseCollisionBox[]): boolean {
  return boxes.some(
    (box) =>
      nearlyEqual(blocker.min[0], box.bounds.min[0]) &&
      nearlyEqual(blocker.max[0], box.bounds.max[0]) &&
      nearlyEqual(blocker.min[2], box.bounds.min[1]) &&
      nearlyEqual(blocker.max[2], box.bounds.max[1]) &&
      nearlyEqual(blocker.max[1], box.top),
  );
}

function unionBlockerBounds(blockers: readonly Aabb3[]): MiniGolfAabb2 {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const blocker of blockers) {
    minX = Math.min(minX, blocker.min[0]);
    minZ = Math.min(minZ, blocker.min[2]);
    maxX = Math.max(maxX, blocker.max[0]);
    maxZ = Math.max(maxZ, blocker.max[2]);
  }
  return { min: [minX, minZ], max: [maxX, maxZ] };
}

function heightFromMeshBlockers(
  blockers: readonly Aabb3[],
  x: number,
  z: number,
): number | null {
  let height: number | null = null;
  for (const blocker of blockers) {
    if (
      x < blocker.min[0] - MESH_SURFACE_SAMPLE_PADDING ||
      x > blocker.max[0] + MESH_SURFACE_SAMPLE_PADDING ||
      z < blocker.min[2] - MESH_SURFACE_SAMPLE_PADDING ||
      z > blocker.max[2] + MESH_SURFACE_SAMPLE_PADDING
    ) {
      continue;
    }
    const candidate = blocker.max[1] + BALL_VISUAL_RADIUS;
    height = height === null ? candidate : Math.max(height, candidate);
  }
  return height;
}

function slopeFromMeshBlockers(blockers: readonly Aabb3[], x: number, z: number): Vec2 | null {
  const center = heightFromMeshBlockers(blockers, x, z);
  if (center === null) return null;
  const step = MESH_SURFACE_SLOPE_SAMPLE_STEP;
  const hx0 = heightFromMeshBlockers(blockers, x - step, z) ?? center;
  const hx1 = heightFromMeshBlockers(blockers, x + step, z) ?? center;
  const hz0 = heightFromMeshBlockers(blockers, x, z - step) ?? center;
  const hz1 = heightFromMeshBlockers(blockers, x, z + step) ?? center;
  return [
    clamp((hx1 - hx0) / (step * 2), -MESH_SURFACE_MAX_SLOPE, MESH_SURFACE_MAX_SLOPE),
    clamp((hz1 - hz0) / (step * 2), -MESH_SURFACE_MAX_SLOPE, MESH_SURFACE_MAX_SLOPE),
  ];
}

function numberMeta(placement: LayoutPlacement, key: string, fallback: number): number {
  const value = placement.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readPar(layout: RoomLayout): number {
  const par = layout.worldSettings?.gameRules?.variables?.find((variable) => variable.id === "par");
  return par?.initial ?? 3;
}

function normalize2(value: Vec2): Vec2 {
  const length = Math.hypot(value[0], value[1]);
  return length > 0 ? [value[0] / length, value[1] / length] : [0, 0];
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-4;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const MINI_GOLF_PLAYER_CONTROLLER: PlayerControllerDefinition = {
  id: "minigolf.dragPuttController",
  inputActions: ["aim", "fire"],
  inputMode: "game",
  pointerLookMode: "right-drag",
  mouseCursor: "show",
  possess: "camera-pawn",
};

export const miniGolfGameMode: GameModeDefinition = {
  id: MINI_GOLF_GAME_MODE_ID,
  displayName: "Mini Golf",
  description: "Single-hole drag-power putting with an orbit camera.",
  defaultPawn: {
    id: "minigolf.ballPawn",
    kind: "camera",
  },
  playerController: MINI_GOLF_PLAYER_CONTROLLER,
  createSession: (context) => new MiniGolfSingleHoleSession(context),
};
