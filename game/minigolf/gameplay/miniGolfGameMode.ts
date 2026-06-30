import { Vector3 } from "three";
import { instanceEntityId } from "@engine/scene/legacyRoomLayoutAdapter";
import type { LayoutPlacement, RoomLayout } from "@engine/scene/layout";
import { readRotation, readScale } from "@engine/scene/transform";
import type { TransformComponent } from "@engine/scene/components";
import type { AssetCollisionDef, CollisionPrimitive } from "@engine/scene/collision";
import type { Aabb3 } from "@/game/collision";
import { computeMiniGolfAim, type MiniGolfAim, type Vec2 } from "./miniGolfAim";
import {
  miniGolfCourseSurfaceHeight,
  type MiniGolfAabb2,
  type MiniGolfCourse,
  type MiniGolfSurface,
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
const HOLE_TRANSITION_DELAY_SECONDS = 1.15;
const BALL_VISUAL_RADIUS = 0.035;
const BALL_MASS_KG = 0.045;
const MAX_PUTT_SPEED = 8;
const PUTT_POWER_EXPONENT = 1.35;
const REST_LINEAR_SPEED = 0.045;
const REST_ANGULAR_SPEED = 0.18;
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
const LOCAL_BEST_STORAGE_PREFIX = "minigolf.bestTotalStrokes";

interface MiniGolfBallRuntimeState {
  readonly pos: readonly [number, number, number];
  readonly resting: boolean;
  readonly inCup: boolean;
  readonly outOfBounds: boolean;
  readonly penaltyStrokes: number;
  readonly lastSafePos: readonly [number, number, number];
}

interface MiniGolfPlacementRef {
  readonly assetId: string;
  readonly placementIndex: number;
  readonly placement: LayoutPlacement;
}

interface MiniGolfHole {
  readonly number: number;
  readonly par: number;
  readonly tee: MiniGolfPlacementRef;
  readonly cup: MiniGolfPlacementRef | null;
}

export interface MiniGolfHoleResult {
  readonly number: number;
  readonly par: number;
  readonly strokes: number;
  readonly score: number;
}

export interface MiniGolfCourseSummary {
  readonly totalPar: number;
  readonly totalStrokes: number;
  readonly score: number;
}

class MiniGolfSingleHoleSession implements GameModeSession {
  readonly playerState: PlayerState = {
    pawnEntityId: null,
    possessed: false,
    pawnControlSuspended: false,
  };
  readonly gameState: GameState = { elapsedSeconds: 0 };

  private ballRef: MiniGolfPlacementRef | null = null;
  private ball: MiniGolfBallRuntimeState | null = null;
  private holes: readonly MiniGolfHole[] = [];
  private activeHoleIndex = 0;
  private course: MiniGolfCourse = {};
  private hud: MiniGolfHud | null = null;
  private scorecard: MiniGolfScorecard | null = null;
  private transitionCard: MiniGolfTransitionCard | null = null;
  private drag: { pointerId: number; start: Vec2; current: Vec2; aim: MiniGolfAim } | null = null;
  private holeStrokes = 0;
  private totalStrokes = 0;
  private scoreRelativeToPar = 0;
  private penaltyStrokes = 0;
  private par = 3;
  private transitionTimer = 0;
  private readonly completedHoles = new Set<number>();
  private readonly holeResults: MiniGolfHoleResult[] = [];
  private cameraYaw = 0;
  private readonly cameraForward = new Vector3();
  private pendingPutt: { direction: Vec2; power: number } | null = null;

  constructor(private readonly context: GameModeContext) {}

  spawnDefaultPawn(): void {
    this.ballRef = findPlacementByRole(this.context.layout, "ball-spawn");
    this.holes = collectMiniGolfHoles(this.context.layout);
    if (this.holes.length === 0) return;
    this.startHole(0);
  }

  possess(): void {
    this.context.setInputMode("game");
    this.context.setMouseCursorVisible(true);
    this.context.setPointerLookMode("right-drag");
    this.context.markCameraControlled();
    this.hud = new MiniGolfHud();
    this.scorecard = new MiniGolfScorecard();
    this.transitionCard = new MiniGolfTransitionCard();
    this.context.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.context.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.context.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.context.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.updateCamera(1);
    this.updateHud();
  }

  update(deltaSeconds: number): void {
    this.gameState.elapsedSeconds += deltaSeconds;
    if (this.transitionTimer > 0) {
      this.transitionTimer = Math.max(0, this.transitionTimer - deltaSeconds);
      if (this.transitionTimer === 0) this.startHole(this.activeHoleIndex + 1);
    }

    if (this.context.getInputMode() !== "ui") {
      const look = this.context.consumeLookDelta();
      this.cameraYaw += look.dx * ORBIT_SENSITIVITY;
    }

    const before = this.ball;
    this.syncBallFromPhysics();
    if (this.ball) this.dispatchPhysicsEvents(before, this.ball);

    this.updateCamera(deltaSeconds);
    this.updateHud();
  }

  beforeEngineUpdate(): void {
    if (!this.pendingPutt || !this.ballRef || !this.ball || this.ball.inCup) return;
    const ballEntityId = this.ballEntityId();
    if (!ballEntityId) return;
    const shot = this.pendingPutt;
    this.pendingPutt = null;
    const power = clamp(shot.power, 0, 1);
    const direction = normalize2(shot.direction);
    const speed = MAX_PUTT_SPEED * Math.pow(power, PUTT_POWER_EXPONENT);
    this.context.setLinearVelocity?.(ballEntityId, [0, 0, 0]);
    this.context.applyImpulse?.(ballEntityId, [
      direction[0] * BALL_MASS_KG * speed,
      0,
      direction[1] * BALL_MASS_KG * speed,
    ]);
    this.ball = {
      ...this.ball,
      resting: speed <= REST_LINEAR_SPEED,
      outOfBounds: false,
    };
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
    this.scorecard?.dispose();
    this.scorecard = null;
    this.transitionCard?.dispose();
    this.transitionCard = null;
    this.drag = null;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.context.getInputMode() === "ui") return;
    if (this.transitionTimer > 0) return;
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
    this.pendingPutt = { direction: aim.direction, power: aim.power };
    this.holeStrokes += 1;
    this.totalStrokes += 1;
    this.context.dispatchGameEvent({ kind: "add", variable: "strokes", amount: 1 });
    this.context.dispatchGameEvent({ kind: "add", variable: "totalStrokes", amount: 1 });
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
    const hole = this.currentHole();
    this.hud?.update({
      currentHole: hole?.number ?? 1,
      totalHoles: Math.max(1, this.holes.length),
      strokes: this.holeStrokes,
      totalStrokes: this.totalStrokes,
      scoreRelativeToPar: this.scoreRelativeToPar,
      par: this.par,
      power: this.drag?.aim.power ?? 0,
      dragging: Boolean(this.drag),
      inCup: this.ball?.inCup ?? false,
      transitioning: this.transitionTimer > 0,
      courseComplete: Boolean(this.ball?.inCup) && this.activeHoleIndex >= this.holes.length - 1,
      ballScreen: this.ballScreenPosition(),
      dragStart: this.drag?.start ?? null,
      dragCurrent: this.drag?.current ?? null,
    });
  }

  private dispatchPhysicsEvents(
    previous: MiniGolfBallRuntimeState | null,
    next: MiniGolfBallRuntimeState,
  ): void {
    if (!previous) return;
    const penaltyDelta = next.penaltyStrokes - this.penaltyStrokes;
    if (penaltyDelta > 0) {
      this.penaltyStrokes = next.penaltyStrokes;
      this.holeStrokes += penaltyDelta;
      this.totalStrokes += penaltyDelta;
      this.context.dispatchGameEvent({ kind: "add", variable: "strokes", amount: penaltyDelta });
      this.context.dispatchGameEvent({ kind: "add", variable: "totalStrokes", amount: penaltyDelta });
    }
    if (!previous.inCup && next.inCup) {
      this.completeCurrentHole();
    }
  }

  private startHole(index: number): void {
    const hole = this.holes[index];
    if (!hole) return;
    this.activeHoleIndex = index;
    this.par = hole.par;
    this.holeStrokes = 0;
    this.penaltyStrokes = 0;
    this.transitionTimer = 0;
    this.course = buildMiniGolfCourse(
      this.context.layout,
      this.context.getAssetCollisionDef,
      this.context.staticBlockerAabbs(),
      { hole: hole.number },
    );
    const pos = hole.tee.placement.position;
    const ballY = miniGolfCourseSurfaceHeight(this.course, pos[0], pos[2]);
    const spawn: [number, number, number] = [pos[0], ballY, pos[2]];
    this.ball = createMiniGolfRuntimeBall(spawn);
    this.pendingPutt = null;
    this.context.dispatchGameEvent({ kind: "set", variable: "strokes", value: 0 });
    this.context.dispatchGameEvent({ kind: "set", variable: "par", value: this.par });
    this.context.dispatchGameEvent({ kind: "set", variable: "currentHole", value: hole.number });
    this.teleportBall(spawn);
  }

  private completeCurrentHole(): void {
    const hole = this.currentHole();
    if (!hole || this.completedHoles.has(hole.number)) return;
    this.completedHoles.add(hole.number);
    const result: MiniGolfHoleResult = {
      number: hole.number,
      par: hole.par,
      strokes: this.holeStrokes,
      score: miniGolfScoreRelativeToPar(this.holeStrokes, hole.par),
    };
    this.holeResults[this.activeHoleIndex] = result;
    this.scoreRelativeToPar += result.score;
    this.context.dispatchGameEvent({ kind: "set", variable: "score", value: this.scoreRelativeToPar });
    this.context.dispatchGameEvent({ kind: "objective", id: `hole-${hole.number}` });
    this.transitionCard?.show(result, this.activeHoleIndex < this.holes.length - 1);
    if (this.activeHoleIndex < this.holes.length - 1) {
      this.transitionTimer = HOLE_TRANSITION_DELAY_SECONDS;
    } else {
      const summary = summarizeMiniGolfCourse(this.holeResults);
      const best = writeMiniGolfBestScore(this.context.layout.name, summary.totalStrokes);
      this.scorecard?.show({
        results: this.holeResults,
        summary,
        bestStrokes: best.bestStrokes,
        newBest: best.newBest,
      });
    }
  }

  private currentHole(): MiniGolfHole | null {
    return this.holes[this.activeHoleIndex] ?? null;
  }

  private ballEntityId(): string | null {
    if (!this.ballRef) return null;
    return instanceEntityId(this.ballRef.assetId, this.ballRef.placementIndex);
  }

  private teleportBall(position: readonly [number, number, number]): void {
    if (!this.ballRef) return;
    const entityId = this.ballEntityId();
    if (!entityId) return;
    const teleported =
      this.context.teleportBody?.(entityId, [position[0], position[1], position[2]], {
        zeroVelocity: true,
      }) ?? false;
    if (teleported) return;
    this.context.setEntityTransform(entityId, {
      position: [...position],
      rotation: readRotation(this.ballRef.placement),
      scale: readScale(this.ballRef.placement),
    } satisfies TransformComponent);
  }

  private syncBallFromPhysics(): void {
    if (!this.ball) return;
    const entityId = this.ballEntityId();
    const transform = entityId ? this.context.getEntityTransform?.(entityId) : null;
    const pos: [number, number, number] = transform
      ? [transform.position[0], transform.position[1], transform.position[2]]
      : [...this.ball.pos];
    const velocity = entityId ? this.context.getLinearVelocity?.(entityId) : null;
    const angularVelocity = entityId ? this.context.getAngularVelocity?.(entityId) : null;
    const speed = velocity ? Math.hypot(velocity[0], velocity[1], velocity[2]) : 0;
    const spin = angularVelocity
      ? Math.hypot(angularVelocity[0], angularVelocity[1], angularVelocity[2])
      : 0;
    let next = {
      ...this.ball,
      pos,
      resting:
        !this.pendingPutt &&
        !this.ball.inCup &&
        ((entityId ? (this.context.isBodySleeping?.(entityId) ?? false) : false) ||
          (speed <= REST_LINEAR_SPEED && spin <= REST_ANGULAR_SPEED)),
      outOfBounds: false,
    };
    if (!next.inCup && this.isBallOutOfBounds(pos)) {
      const reset = next.lastSafePos;
      this.teleportBall(reset);
      next = {
        ...next,
        pos: [reset[0], reset[1], reset[2]],
        resting: true,
        outOfBounds: true,
        penaltyStrokes: next.penaltyStrokes + 1,
      };
    } else if (!next.inCup && this.isBallInCup(pos, speed)) {
      const cup = this.course.cup!;
      const cupPos: [number, number, number] = [cup.center[0], cup.center[1], cup.center[2]];
      this.teleportBall(cupPos);
      next = { ...next, pos: cupPos, resting: true, inCup: true, lastSafePos: cupPos };
    } else if (next.resting && !next.outOfBounds) {
      next = { ...next, lastSafePos: pos };
    }
    this.ball = next;
  }

  private isBallOutOfBounds(pos: readonly [number, number, number]): boolean {
    const x = pos[0];
    const y = pos[1];
    const z = pos[2];
    if (y < -2) return true;
    const bounds = this.course.bounds;
    if (bounds && !containsMiniGolfAabb(bounds, x, z)) return true;
    return (this.course.hazards ?? []).some((hazard) => containsMiniGolfAabb(hazard, x, z));
  }

  private isBallInCup(pos: readonly [number, number, number], speed: number): boolean {
    const cup = this.course.cup;
    if (!cup) return false;
    if (speed > cup.captureSpeed) return false;
    return Math.hypot(pos[0] - cup.center[0], pos[2] - cup.center[2]) <= cup.radius;
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
    readonly currentHole: number;
    readonly totalHoles: number;
    readonly strokes: number;
    readonly totalStrokes: number;
    readonly scoreRelativeToPar: number;
    readonly par: number;
    readonly power: number;
    readonly dragging: boolean;
    readonly inCup: boolean;
    readonly transitioning: boolean;
    readonly courseComplete: boolean;
    readonly ballScreen: Vec2 | null;
    readonly dragStart: Vec2 | null;
    readonly dragCurrent: Vec2 | null;
  }): void {
    const score = state.scoreRelativeToPar > 0 ? `+${state.scoreRelativeToPar}` : `${state.scoreRelativeToPar}`;
    this.text.textContent = `Hole ${state.currentHole}/${state.totalHoles}  Par ${state.par}  Strokes ${state.strokes}  Total ${state.totalStrokes}  Score ${score}`;
    this.fill.style.width = `${Math.round(state.power * 100)}%`;
    this.hint.textContent = state.courseComplete
      ? "Course complete"
      : state.transitioning
        ? "Next hole"
        : state.inCup
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

class MiniGolfScorecard {
  private readonly root = document.createElement("div");
  private readonly title = document.createElement("div");
  private readonly summary = document.createElement("div");
  private readonly table = document.createElement("div");
  private readonly best = document.createElement("div");

  constructor() {
    this.root.style.cssText = [
      "position:fixed",
      "right:16px",
      "top:16px",
      "z-index:19",
      "width:min(360px,calc(100vw - 32px))",
      "max-height:calc(100vh - 32px)",
      "overflow:auto",
      "padding:14px",
      "border-radius:8px",
      "background:rgba(12,18,22,0.88)",
      "color:#fff",
      "font:600 13px system-ui,sans-serif",
      "letter-spacing:0",
      "pointer-events:none",
      "box-shadow:0 12px 32px rgba(0,0,0,0.32)",
      "display:none",
    ].join(";");
    this.title.style.cssText = "font-size:18px;font-weight:800;margin-bottom:8px";
    this.summary.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;color:rgba(255,255,255,0.88)";
    this.table.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0;border-top:1px solid rgba(255,255,255,0.18)";
    this.best.style.cssText = "margin-top:10px;color:rgba(255,255,255,0.76);font-weight:600";
    this.root.append(this.title, this.summary, this.table, this.best);
    document.body.append(this.root);
  }

  show(state: {
    readonly results: readonly MiniGolfHoleResult[];
    readonly summary: MiniGolfCourseSummary;
    readonly bestStrokes: number | null;
    readonly newBest: boolean;
  }): void {
    this.title.textContent = "Course Complete";
    this.summary.replaceChildren(
      scorecardMetric("Total", `${state.summary.totalStrokes}`),
      scorecardMetric("Par", `${state.summary.totalPar}`),
      scorecardMetric("Score", formatMiniGolfScore(state.summary.score)),
    );
    this.table.replaceChildren(
      scorecardCell("Hole", true),
      scorecardCell("Par", true),
      scorecardCell("Strokes", true),
      scorecardCell("Score", true),
      ...state.results.flatMap((result) => [
        scorecardCell(`${result.number}`),
        scorecardCell(`${result.par}`),
        scorecardCell(`${result.strokes}`),
        scorecardCell(formatMiniGolfScore(result.score)),
      ]),
    );
    this.best.textContent =
      state.bestStrokes === null
        ? "Best: --"
        : state.newBest
          ? `New best: ${state.bestStrokes}`
          : `Best: ${state.bestStrokes}`;
    this.root.style.display = "block";
  }

  dispose(): void {
    this.root.remove();
  }
}

class MiniGolfTransitionCard {
  private readonly root = document.createElement("div");
  private readonly title = document.createElement("div");
  private readonly detail = document.createElement("div");
  private hideTimer: number | null = null;

  constructor() {
    this.root.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:18px",
      "z-index:20",
      "min-width:min(320px,calc(100vw - 32px))",
      "padding:12px 16px",
      "border-radius:8px",
      "background:rgba(255,255,255,0.92)",
      "color:#172024",
      "font:700 14px system-ui,sans-serif",
      "letter-spacing:0",
      "pointer-events:none",
      "box-shadow:0 12px 28px rgba(0,0,0,0.22)",
      "transform:translate(-50%,-130%)",
      "transition:transform 180ms ease,opacity 180ms ease",
      "opacity:0",
    ].join(";");
    this.title.style.cssText = "font-size:18px;font-weight:850";
    this.detail.style.cssText = "margin-top:3px;color:rgba(23,32,36,0.72);font-weight:650";
    this.root.append(this.title, this.detail);
    document.body.append(this.root);
  }

  show(result: MiniGolfHoleResult, hasNextHole: boolean): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.title.textContent = `Hole ${result.number} - ${miniGolfResultName(result.score)}`;
    this.detail.textContent = `${result.strokes} strokes  Par ${result.par}  Score ${formatMiniGolfScore(result.score)}${hasNextHole ? "  Next hole" : ""}`;
    this.root.style.opacity = "1";
    this.root.style.transform = "translate(-50%,0)";
    this.hideTimer = window.setTimeout(() => {
      this.root.style.opacity = "0";
      this.root.style.transform = "translate(-50%,-130%)";
      this.hideTimer = null;
    }, hasNextHole ? 1100 : 2400);
  }

  dispose(): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.root.remove();
  }
}

function collectMiniGolfHoles(layout: RoomLayout): readonly MiniGolfHole[] {
  const tees = findPlacementsByRole(layout, "tee");
  if (tees.length === 0) return [];
  return tees
    .map((tee, index) => {
      const number = holeNumber(tee.placement) ?? index + 1;
      return {
        number,
        par: numberMeta(tee.placement, "par", readPar(layout, number)),
        tee,
        cup: findPlacementByRole(layout, "cup", number),
      };
    })
    .sort((a, b) => a.number - b.number);
}

function createMiniGolfRuntimeBall(pos: readonly [number, number, number]): MiniGolfBallRuntimeState {
  return {
    pos: [...pos],
    resting: true,
    inCup: false,
    outOfBounds: false,
    penaltyStrokes: 0,
    lastSafePos: [...pos],
  };
}

function containsMiniGolfAabb(aabb: MiniGolfAabb2, x: number, z: number): boolean {
  return x >= aabb.min[0] && x <= aabb.max[0] && z >= aabb.min[1] && z <= aabb.max[1];
}

function findPlacementByRole(
  layout: RoomLayout,
  role: string,
  hole?: number,
): MiniGolfPlacementRef | null {
  return findPlacementsByRole(layout, role, hole)[0] ?? null;
}

function findPlacementsByRole(
  layout: RoomLayout,
  role: string,
  hole?: number,
): MiniGolfPlacementRef[] {
  const refs: MiniGolfPlacementRef[] = [];
  for (const instance of layout.instances) {
    for (let placementIndex = 0; placementIndex < instance.placements.length; placementIndex += 1) {
      const placement = instance.placements[placementIndex]!;
      if (placement.metadata?.minigolfRole !== role) continue;
      if (hole !== undefined && holeNumber(placement) !== hole) continue;
      refs.push({ assetId: instance.assetId, placementIndex, placement });
    }
  }
  return refs;
}

export function buildMiniGolfCourse(
  layout: RoomLayout,
  getAssetCollisionDef: (assetId: string) => AssetCollisionDef | undefined,
  staticBlockers: readonly Aabb3[] = [],
  options: { readonly hole?: number } = {},
): MiniGolfCourse {
  const cup = findPlacementByRole(layout, "cup", options.hole)?.placement;
  const collisionBoxes = collectCourseCollisionBoxes(layout, getAssetCollisionDef, options.hole);
  const courseBounds = courseBoundsFromPlacements(layout, options.hole);
  const surfaceBoxes = collisionBoxes.filter((box) => box.kind === "surface");
  const surfaceHeight = collisionBoxes
    .filter((box) => box.kind === "surface")
    .reduce((height, box) => Math.max(height, box.top), 0);
  const surfaces = [
    ...surfaceBoxes.map((box) => surfaceFromCourseBox(box)),
    ...meshSurfacesFromBlockers(staticBlockers, collisionBoxes, courseBounds),
  ];
  const walls = collisionBoxes
    .filter((box) => box.kind === "wall" && box.top > surfaceHeight + WALL_TOP_CLEARANCE)
    .map((box) => ({
      bounds: box.bounds,
      ...(box.restitution !== undefined ? { restitution: box.restitution } : {}),
    }));
  const hazards = collectHazards(layout, options.hole);
  return {
    bounds: courseBounds,
    hazards,
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
  hole?: number,
): CourseCollisionBox[] {
  const boxes: CourseCollisionBox[] = [];
  for (const instance of layout.instances) {
    const def = getAssetCollisionDef(instance.assetId);
    if (!def) continue;
    for (const placement of instance.placements) {
      if (placement.hidden || placement.collision === false) continue;
      if (!placementBelongsToHole(placement, hole)) continue;
      for (const primitive of def.primitives) {
        const box = primitiveCourseBox(primitive, placement);
        if (box) boxes.push(box);
      }
    }
  }
  return boxes;
}

function collectHazards(layout: RoomLayout, hole: number | undefined): MiniGolfAabb2[] {
  const hazards: MiniGolfAabb2[] = [];
  for (const instance of layout.instances) {
    for (const placement of instance.placements) {
      const role = placement.metadata?.minigolfRole;
      if (role !== "hazard" && role !== "water") continue;
      if (!placementBelongsToHole(placement, hole)) continue;
      hazards.push(hazardAabbFromPlacement(placement));
    }
  }
  return hazards;
}

function hazardAabbFromPlacement(placement: LayoutPlacement): MiniGolfAabb2 {
  const halfWidth = numberMeta(placement, "hazardHalfWidth", 0.45);
  const halfDepth = numberMeta(placement, "hazardHalfDepth", 0.45);
  return {
    min: [placement.position[0] - halfWidth, placement.position[2] - halfDepth],
    max: [placement.position[0] + halfWidth, placement.position[2] + halfDepth],
  };
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
  courseBounds?: MiniGolfAabb2,
): MiniGolfSurface[] {
  const blockers = staticBlockers.filter(
    (blocker) =>
      isMeshSurfaceBlocker(blocker) &&
      !matchesAuthoredCourseBox(blocker, authoredBoxes) &&
      (!courseBounds || blockerIntersectsAabb2(blocker, courseBounds)),
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

function courseBoundsFromPlacements(layout: RoomLayout, hole: number | undefined): MiniGolfAabb2 {
  const nonCameraPlacements = layout.instances
    .flatMap((instance) => instance.placements)
    .filter((placement) => placement.metadata?.role !== "camera-start");
  const holePlacements =
    hole === undefined
      ? nonCameraPlacements
      : nonCameraPlacements.filter((placement) => holeNumber(placement) === hole);
  const boundedPlacements = holePlacements.length > 0 ? holePlacements : nonCameraPlacements;
  const xs = boundedPlacements.map((placement) => placement.position[0]);
  const zs = boundedPlacements.map((placement) => placement.position[2]);
  return {
    min: [Math.min(...xs, -1) - 0.55, Math.min(...zs, -8) - 1],
    max: [Math.max(...xs, 1) + 0.55, Math.max(...zs, 1) + 1],
  };
}

function readPar(layout: RoomLayout, hole?: number): number {
  const parId = hole !== undefined ? `par-${hole}` : "par";
  const par = layout.worldSettings?.gameRules?.variables?.find((variable) => variable.id === parId);
  if (par) return par.initial ?? 3;
  const sharedPar = layout.worldSettings?.gameRules?.variables?.find((variable) => variable.id === "par");
  return sharedPar?.initial ?? 3;
}

function holeNumber(placement: LayoutPlacement): number | null {
  const value = placement.metadata?.hole;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : null;
}

function placementBelongsToHole(placement: LayoutPlacement, hole: number | undefined): boolean {
  if (hole === undefined) return true;
  const placementHole = holeNumber(placement);
  return placementHole === null || placementHole === hole;
}

function blockerIntersectsAabb2(blocker: Aabb3, bounds: MiniGolfAabb2): boolean {
  return (
    blocker.max[0] >= bounds.min[0] &&
    blocker.min[0] <= bounds.max[0] &&
    blocker.max[2] >= bounds.min[1] &&
    blocker.min[2] <= bounds.max[1]
  );
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

export function miniGolfScoreRelativeToPar(strokes: number, par: number): number {
  return Math.trunc(strokes) - Math.trunc(par);
}

export function summarizeMiniGolfCourse(results: readonly MiniGolfHoleResult[]): MiniGolfCourseSummary {
  return results.reduce<MiniGolfCourseSummary>(
    (summary, result) => ({
      totalPar: summary.totalPar + result.par,
      totalStrokes: summary.totalStrokes + result.strokes,
      score: summary.score + result.score,
    }),
    { totalPar: 0, totalStrokes: 0, score: 0 },
  );
}

export function formatMiniGolfScore(score: number): string {
  return score > 0 ? `+${score}` : `${score}`;
}

export function miniGolfResultName(score: number): string {
  if (score <= -2) return "Eagle";
  if (score === -1) return "Birdie";
  if (score === 0) return "Par";
  if (score === 1) return "Bogey";
  if (score === 2) return "Double Bogey";
  return `${formatMiniGolfScore(score)}`;
}

function scorecardMetric(label: string, value: string): HTMLElement {
  const element = document.createElement("div");
  element.style.cssText = "min-width:72px";
  const labelElement = document.createElement("div");
  labelElement.style.cssText = "font-size:11px;color:rgba(255,255,255,0.58);font-weight:700;text-transform:uppercase";
  labelElement.textContent = label;
  const valueElement = document.createElement("div");
  valueElement.style.cssText = "font-size:18px;font-weight:800";
  valueElement.textContent = value;
  element.append(labelElement, valueElement);
  return element;
}

function scorecardCell(text: string, heading = false): HTMLElement {
  const element = document.createElement("div");
  element.textContent = text;
  element.style.cssText = [
    "padding:6px 4px",
    "border-bottom:1px solid rgba(255,255,255,0.12)",
    heading ? "color:rgba(255,255,255,0.62);font-size:11px;text-transform:uppercase" : "color:#fff",
    "text-align:right",
  ].join(";");
  return element;
}

function writeMiniGolfBestScore(
  courseName: string,
  totalStrokes: number,
): { readonly bestStrokes: number | null; readonly newBest: boolean } {
  const key = `${LOCAL_BEST_STORAGE_PREFIX}.${courseName}`;
  try {
    const previous = window.localStorage.getItem(key);
    const previousScore = previous !== null ? Number.parseInt(previous, 10) : null;
    if (previousScore === null || !Number.isFinite(previousScore) || totalStrokes < previousScore) {
      window.localStorage.setItem(key, `${totalStrokes}`);
      return { bestStrokes: totalStrokes, newBest: true };
    }
    return { bestStrokes: previousScore, newBest: false };
  } catch {
    return { bestStrokes: null, newBest: false };
  }
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
