import { readCharacterMovementComponent, readTransformComponent } from "@engine/scene/components";
import type { CharacterMovementComponent, TransformComponent } from "@engine/scene/components";
import type { EngineUpdateContext, Subsystem } from "@engine/core/Subsystem";
import type { Entity, EntityId } from "@engine/scene/entity";
import type { ActionMap } from "@engine/input/actionMap";
import type { PhysicsQuery, TransformSink } from "@engine/behavior/behaviorSubsystem";
import {
  facingYawFromMove,
  planarMoveStep,
  planarMoveStepRelativeToYaw,
  rotateYawToward,
} from "./playerMovement";
import { groundedAt, stepVerticalMotion, type VerticalMotionState } from "./verticalMotion";
import {
  filterWalkableBlockers,
  findGroundAt,
  findLandingGround,
  resolvePlanarMovement,
  type PlanarDelta,
} from "./collision";
import type { LocomotionInput } from "./locomotionAnimation";

export const CHARACTER_MOVEMENT_SUBSYSTEM_ID = "characterMovement";

interface CharacterMovementRuntime {
  id: EntityId;
  transform: TransformComponent;
  movement: CharacterMovementComponent;
}

interface CharacterVertical {
  state: VerticalMotionState;
  floorY: number;
}

export interface CharacterMovementSubsystemOptions {
  getGravityY?: () => number;
  getControlYaw?: (entityId: EntityId) => number | null | undefined;
  isPlayerControlled?: (entityId: EntityId) => boolean;
  reportLocomotion?: (entityId: EntityId, report: LocomotionInput) => void;
}

const DEFAULT_GRAVITY_Y = -9.81;
const DEFAULT_MAX_STEP_HEIGHT = 0.45;
const DEFAULT_MAX_STEP_DOWN = 0.2;

export class CharacterMovementSubsystem implements Subsystem {
  readonly id = CHARACTER_MOVEMENT_SUBSYSTEM_ID;
  private runtimes: CharacterMovementRuntime[] = [];
  private vertical = new Map<EntityId, CharacterVertical>();
  private readonly getGravityY: () => number;
  private readonly getControlYaw: (entityId: EntityId) => number | null | undefined;
  private readonly isPlayerControlled: (entityId: EntityId) => boolean;
  private readonly reportLocomotion: ((entityId: EntityId, report: LocomotionInput) => void) | undefined;

  constructor(
    private readonly actions: ActionMap,
    private readonly sink: TransformSink,
    private readonly physics?: PhysicsQuery,
    options: CharacterMovementSubsystemOptions = {},
  ) {
    this.getGravityY = options.getGravityY ?? (() => DEFAULT_GRAVITY_Y);
    this.getControlYaw = options.getControlYaw ?? (() => null);
    this.isPlayerControlled = options.isPlayerControlled ?? (() => true);
    this.reportLocomotion = options.reportLocomotion;
  }

  setEntities(entities: readonly Entity[]): void {
    this.vertical.clear();
    this.runtimes = [];
    for (const entity of entities) {
      const transform = readTransformComponent(entity);
      const movement = readCharacterMovementComponent(entity);
      if (!transform || !movement) continue;
      this.runtimes.push({
        id: entity.id,
        transform: cloneTransform(transform),
        movement,
      });
    }
  }

  clear(): void {
    this.runtimes = [];
    this.vertical.clear();
  }

  resetEntityTransform(entityId: EntityId, transform: TransformComponent): void {
    const runtime = this.runtimes.find((entry) => entry.id === entityId);
    if (!runtime) return;
    runtime.transform = cloneTransform(transform);
    const floorY = transform.position[1];
    this.vertical.set(entityId, { state: groundedAt(floorY), floorY });
  }

  update(engine: EngineUpdateContext): void {
    for (const runtime of this.runtimes) {
      if (!this.isPlayerControlled(runtime.id)) continue;
      this.updateRuntime(runtime, engine);
      this.sink(runtime.id, runtime.transform);
    }
  }

  dispose(): void {
    this.clear();
  }

  private updateRuntime(runtime: CharacterMovementRuntime, engine: EngineUpdateContext): void {
    const movement = runtime.movement;
    const speed = this.actions.held("sprint")
      ? movement.maxWalkSpeed * movement.sprintMultiplier
      : movement.maxWalkSpeed;
    const input = {
      forward: this.actions.held("move-forward"),
      back: this.actions.held("move-back"),
      left: this.actions.held("move-left"),
      right: this.actions.held("move-right"),
    };
    const controlYaw = this.getControlYaw(runtime.id);
    const planar =
      typeof controlYaw === "number" && Number.isFinite(controlYaw)
        ? planarMoveStepRelativeToYaw(input, speed, engine.deltaSeconds, controlYaw)
        : planarMoveStep(input, speed, engine.deltaSeconds);
    const { dx, dz } = this.resolvePlanarAgainstBlockers(runtime, planar);
    runtime.transform.position[0] += dx;
    runtime.transform.position[2] += dz;
    const yaw = facingYawFromMove(dx, dz);
    let targetYaw: number | null = null;
    if (
      movement.orientRotationToControl &&
      typeof controlYaw === "number" &&
      Number.isFinite(controlYaw)
    ) {
      targetYaw = controlYawToCharacterYaw(controlYaw);
    } else if (movement.orientRotationToMovement && yaw !== null) {
      targetYaw = yaw;
    }
    if (targetYaw !== null) {
      const yawRate = Math.max(0, movement.rotationRate[2]);
      runtime.transform.rotation[1] = rotateYawToward(
        runtime.transform.rotation[1],
        targetYaw,
        yawRate * engine.deltaSeconds,
      );
    }

    const vertical = this.updateVertical(runtime, engine);
    this.reportLocomotion?.(runtime.id, {
      planarSpeed:
        engine.deltaSeconds > 0 ? Math.hypot(planar.dx, planar.dz) / engine.deltaSeconds : 0,
      grounded: vertical.grounded,
      velocityY: vertical.velocityY,
    });
  }

  private updateVertical(
    runtime: CharacterMovementRuntime,
    engine: EngineUpdateContext,
  ): VerticalMotionState {
    const movement = runtime.movement;
    if (movement.movementMode !== "walking" && movement.movementMode !== "falling") {
      return { y: runtime.transform.position[1], velocityY: 0, grounded: true };
    }
    let vertical = this.vertical.get(runtime.id);
    if (!vertical) {
      const floorY = runtime.transform.position[1];
      vertical = { state: groundedAt(floorY), floorY };
      this.vertical.set(runtime.id, vertical);
    }
    const previousY = vertical.state.y;
    const ground = this.groundAt(runtime);
    if (vertical.state.grounded) {
      if (this.actions.pressed("jump")) {
        vertical.floorY = ground?.floorY ?? vertical.floorY;
      } else if (ground) {
        vertical.floorY = ground.floorY;
        vertical.state = groundedAt(ground.floorY);
      } else if (!this.hasGroundProbe()) {
        vertical.state = groundedAt(vertical.floorY);
      } else {
        vertical.floorY = previousY;
        vertical.state = { y: previousY, velocityY: 0, grounded: false };
      }
    }
    vertical.state = stepVerticalMotion(vertical.state, {
      gravityY: this.getGravityY() * movement.gravityScale,
      jumpSpeed: movement.jumpSpeed,
      floorY: vertical.state.grounded ? vertical.floorY : null,
      dt: engine.deltaSeconds,
      jump: this.actions.pressed("jump"),
    });
    if (!vertical.state.grounded) {
      const landing = this.landingGround(runtime, previousY, vertical.state.y);
      if (landing) {
        vertical.floorY = landing.floorY;
        vertical.state = groundedAt(landing.floorY);
      } else if (
        !this.hasGroundProbe() &&
        previousY >= vertical.floorY &&
        vertical.state.y <= vertical.floorY
      ) {
        vertical.state = groundedAt(vertical.floorY);
      }
    }
    runtime.transform.position[1] = vertical.state.y;
    return vertical.state;
  }

  private resolvePlanarAgainstBlockers(
    runtime: CharacterMovementRuntime,
    planar: PlanarDelta,
  ): PlanarDelta {
    if (!this.physics) return planar;
    const blockers = filterWalkableBlockers(
      runtime.transform.position[1],
      this.physics.staticBlockerAabbs(),
      this.maxStepHeight(runtime),
    );
    if (blockers.length === 0) return planar;
    const half = this.physics.colliderHalfExtents(runtime.id);
    if (!half) return planar;
    const centerPosition: [number, number, number] = [
      runtime.transform.position[0],
      runtime.transform.position[1] + half[1],
      runtime.transform.position[2],
    ];
    return resolvePlanarMovement(centerPosition, planar, half, blockers);
  }

  private groundAt(runtime: CharacterMovementRuntime) {
    const blockers = this.physics?.staticBlockerAabbs();
    if (!blockers || blockers.length === 0) return null;
    return findGroundAt(runtime.transform.position, blockers, {
      footprintHalf: this.footprintHalf(runtime),
      maxStepUp: this.maxStepHeight(runtime),
      maxStepDown: DEFAULT_MAX_STEP_DOWN,
    });
  }

  private landingGround(
    runtime: CharacterMovementRuntime,
    previousY: number,
    nextY: number,
  ) {
    const blockers = this.physics?.staticBlockerAabbs();
    if (!blockers || blockers.length === 0) return null;
    return findLandingGround(previousY, nextY, runtime.transform.position, blockers, {
      footprintHalf: this.footprintHalf(runtime),
      maxStepUp: this.maxStepHeight(runtime),
      maxStepDown: DEFAULT_MAX_STEP_DOWN,
    });
  }

  private hasGroundProbe(): boolean {
    const blockers = this.physics?.staticBlockerAabbs();
    return !!blockers && blockers.length > 0;
  }

  private footprintHalf(runtime: CharacterMovementRuntime): [number, number] {
    const radius = Math.max(runtime.movement.capsuleRadius, 0.001);
    return [radius, radius];
  }

  private maxStepHeight(runtime: CharacterMovementRuntime): number {
    return Math.max(runtime.movement.maxStepHeight ?? DEFAULT_MAX_STEP_HEIGHT, 0);
  }
}

function controlYawToCharacterYaw(yaw: number): number {
  return facingYawFromMove(-Math.sin(yaw), -Math.cos(yaw)) ?? 0;
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}
