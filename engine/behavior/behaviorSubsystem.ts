/**
 * Generic behavior subsystem: ticks registered behavior scripts against a live
 * set of entities derived from the scene.
 *
 * This is where the `SceneDocument` begins to act as a runtime source of truth:
 * the host derives entities once, the subsystem holds a mutable transform per
 * behaviored entity, behaviors mutate those transforms each tick, and a host
 * sink syncs the result back to the rendered objects.
 *
 * Pure: no Three.js or DOM. Value imports use relative paths because the
 * engine-test bundler (tools/run-engine-tests.mjs) resolves no path aliases.
 */
import { readAudioComponent, readBehaviorComponent, readTransformComponent } from "../scene/components";
import type { AudioComponent, TransformComponent } from "../scene/components";
import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import type { Entity, EntityId, SceneJsonValue } from "../scene/entity";
import type { ActionMap } from "../input/actionMap";
import type { AudioBus } from "../audio/audioSubsystem";

/** Stable registry id for the behavior subsystem. */
export const BEHAVIOR_SUBSYSTEM_ID = "behavior";

/** Per-tick context handed to a behavior update function. */
export interface BehaviorContext {
  readonly entityId: EntityId;
  readonly engine: EngineUpdateContext;
  readonly actions: ActionMap;
  readonly physics?: PhysicsQuery;
  readonly audio?: AudioBus;
  readonly audioComponent?: AudioComponent;
  readonly params: Record<string, SceneJsonValue>;
  /** This entity's transform; behaviors mutate it in place. */
  readonly transform: TransformComponent;
}

export type BehaviorUpdate = (context: BehaviorContext) => void;

export interface PhysicsContact {
  readonly a: EntityId;
  readonly b: EntityId;
  readonly isSensor: boolean;
}

/** A world-space axis-aligned bounding box. */
export interface PhysicsAabb {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface PhysicsQuery {
  contactsForEntity(entityId: EntityId): readonly PhysicsContact[];
  /** World-space AABBs of every static, non-sensor collider (movement blockers). */
  staticBlockerAabbs(): readonly PhysicsAabb[];
  /** Half-extents (size*scale/2) of an entity's collider, or null if it has none. */
  colliderHalfExtents(entityId: EntityId): readonly [number, number, number] | null;
}

/** Resolves a script id to its update function. Runtime/game-owned. */
export interface BehaviorRegistry {
  get(scriptId: string): BehaviorUpdate | undefined;
}

/** Invoked after each behaviored entity ticks, to sync its transform to render. */
export type TransformSink = (entityId: EntityId, transform: TransformComponent) => void;

interface BehaviorInstance {
  id: EntityId;
  update: BehaviorUpdate;
  params: Record<string, SceneJsonValue>;
  transform: TransformComponent;
  audioComponent: AudioComponent | undefined;
}

export class BehaviorSubsystem implements Subsystem {
  readonly id = BEHAVIOR_SUBSYSTEM_ID;
  private instances: BehaviorInstance[] = [];

  constructor(
    private readonly registry: BehaviorRegistry,
    private readonly actions: ActionMap,
    private readonly sink: TransformSink,
    private readonly physics?: PhysicsQuery,
    private readonly audio?: AudioBus,
  ) {}

  /**
   * Derives the live behavior set from a scene's entities. An entity becomes a
   * runtime instance when it has a Behavior whose scriptId resolves in the
   * registry and a Transform to mutate. Each instance gets its own mutable
   * transform copy (the runtime source of truth behaviors edit).
   */
  setEntities(entities: readonly Entity[]): void {
    const instances: BehaviorInstance[] = [];
    for (const entity of entities) {
      const behavior = readBehaviorComponent(entity);
      if (!behavior) continue;
      const update = this.registry.get(behavior.scriptId);
      if (!update) continue;
      const transform = readTransformComponent(entity);
      if (!transform) continue;
      instances.push({
        id: entity.id,
        update,
        params: behavior.params ?? {},
        transform: cloneTransform(transform),
        audioComponent: readAudioComponent(entity),
      });
    }
    this.instances = instances;
  }

  /** Drops all behavior instances (e.g. on scene teardown/reload). */
  clear(): void {
    this.instances = [];
  }

  update(engine: EngineUpdateContext): void {
    for (const instance of this.instances) {
      const context: BehaviorContext = {
        entityId: instance.id,
        engine,
        actions: this.actions,
        params: instance.params,
        transform: instance.transform,
      };
      if (this.physics) {
        (context as BehaviorContext & { physics: PhysicsQuery }).physics = this.physics;
      }
      if (this.audio) {
        (context as BehaviorContext & { audio: AudioBus }).audio = this.audio;
      }
      if (instance.audioComponent) {
        (context as BehaviorContext & { audioComponent: AudioComponent }).audioComponent =
          instance.audioComponent;
      }
      instance.update(context);
      this.sink(instance.id, instance.transform);
    }
  }

  dispose(): void {
    this.clear();
  }
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}
