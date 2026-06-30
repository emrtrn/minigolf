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
import {
  readAudioComponent,
  readBehaviorComponent,
  readInteractionComponent,
  readMessageBindingsComponent,
  readScriptActorComponent,
  readScriptDispatchersComponent,
  readScriptInterfacesComponent,
  readScriptReferencesComponent,
  readTransformComponent,
} from "../scene/components";
import type { AudioComponent, InteractionComponent, TransformComponent } from "../scene/components";
import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import type { Entity, EntityId, SceneJsonValue } from "../scene/entity";
import type { ActionMap } from "../input/actionMap";
import type { AudioBus } from "../audio/audioSubsystem";
import {
  ScriptMessageBus,
  type ScriptMessageEnvelope,
  type ScriptMessageFlushResult,
  type ScriptMessagePayload,
  type ScriptMessageTraceEntry,
  type ScriptMessageWarning,
} from "./scriptMessages";

/** Stable registry id for the behavior subsystem. */
export const BEHAVIOR_SUBSYSTEM_ID = "behavior";

export type EntityRef = EntityId;

export interface ScriptMessages {
  send(target: EntityRef, type: string, payload?: ScriptMessagePayload): void;
  emit(type: string, payload?: ScriptMessagePayload): void;
}

export interface ScriptWorld {
  self(): EntityRef;
  ref(key: string): EntityRef | null;
  byName(name: string): EntityRef | null;
  byTag(tag: string): EntityRef[];
  byClassRef(classRef: string): EntityRef[];
  withInterface(name: string): EntityRef[];
  nearestWithInterface(
    name: string,
    from: EntityRef,
    maxDistance?: number,
  ): EntityRef | null;
}

export interface ScriptState {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  toggle(key: string, fallback?: boolean): boolean;
}

/** Per-tick context handed to a behavior update function. */
export interface BehaviorContext {
  readonly entityId: EntityId;
  readonly engine: EngineUpdateContext;
  readonly actions: ActionMap;
  readonly messages: ScriptMessages;
  readonly world: ScriptWorld;
  readonly state: ScriptState;
  readonly physics?: PhysicsQuery;
  readonly audio?: AudioBus;
  readonly audioComponent?: AudioComponent;
  /** This entity's authored interaction marker, when it carries one. */
  readonly interactionComponent?: InteractionComponent;
  readonly params: Record<string, SceneJsonValue>;
  /** Present when this behavior was invoked by a script message binding. */
  readonly message?: ScriptMessageEnvelope;
  /** This entity's transform; behaviors mutate it in place. */
  readonly transform: TransformComponent;
}

export type BehaviorUpdate = (context: BehaviorContext) => void;

export interface PhysicsContact {
  readonly a: EntityId;
  readonly b: EntityId;
  readonly isSensor: boolean;
  /** Largest normal impulse reported by the physics backend for this contact. */
  readonly maxImpulse?: number;
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

export interface BehaviorSubsystemOptions {
  readonly messageBus?: ScriptMessageBus;
  readonly messageTraceLimit?: number;
  readonly onMessageWarnings?: (warnings: readonly ScriptMessageWarning[]) => void;
}

export interface ScriptMessageSubscriberDebugInfo {
  readonly entityId: EntityId;
  readonly message: string;
  readonly scriptId: string;
  readonly target: "self" | "any";
}

export interface ScriptActorDebugInfo {
  readonly entityId: EntityId;
  readonly name?: string;
  readonly classRef?: string;
  readonly nodeId?: string;
  readonly interfaces: readonly string[];
  readonly dispatchers: readonly { readonly name: string; readonly payload: Record<string, string> }[];
  readonly subscribers: readonly ScriptMessageSubscriberDebugInfo[];
}

export interface ScriptMessageDebugSnapshot {
  readonly lastFlush: ScriptMessageFlushResult;
  readonly recentMessages: readonly ScriptMessageTraceEntry[];
  readonly subscribers: readonly ScriptMessageSubscriberDebugInfo[];
}

interface RuntimeEntityState {
  id: EntityId;
  entity: Entity;
  transform: TransformComponent;
  audioComponent: AudioComponent | undefined;
  interactionComponent: InteractionComponent | undefined;
}

interface BehaviorInstance {
  runtime: RuntimeEntityState;
  update: BehaviorUpdate;
  params: Record<string, SceneJsonValue>;
}

export class BehaviorSubsystem implements Subsystem {
  readonly id = BEHAVIOR_SUBSYSTEM_ID;
  private instances: BehaviorInstance[] = [];
  private runtimeEntities = new Map<EntityId, RuntimeEntityState>();
  private nameIndex = new Map<string, EntityId>();
  private tagIndex = new Map<string, Set<EntityId>>();
  private classRefIndex = new Map<string, Set<EntityId>>();
  private nodeIdIndex = new Map<string, EntityId>();
  private interfaceIndex = new Map<string, Set<EntityId>>();
  private messageSubscriptions: Array<() => void> = [];
  private messageSubscriberInfo: ScriptMessageSubscriberDebugInfo[] = [];
  private runtimeState = new Map<EntityId, Map<string, unknown>>();
  private readonly messageBus: ScriptMessageBus;
  private lastMessageFlushResult: ScriptMessageFlushResult = {
    processed: 0,
    delivered: 0,
    warnings: [],
  };
  private enabled = true;

  constructor(
    private readonly registry: BehaviorRegistry,
    private readonly actions: ActionMap,
    private readonly sink: TransformSink,
    private readonly physics?: PhysicsQuery,
    private readonly audio?: AudioBus,
    options: BehaviorSubsystemOptions = {},
  ) {
    this.messageBus =
      options.messageBus ??
      new ScriptMessageBus({
        targetExists: (target) => this.runtimeEntities.has(target),
        ...(options.messageTraceLimit !== undefined
          ? { recentTraceLimit: options.messageTraceLimit }
          : {}),
      });
    this.onMessageWarnings = options.onMessageWarnings;
  }

  private readonly onMessageWarnings:
    | ((warnings: readonly ScriptMessageWarning[]) => void)
    | undefined;

  /**
   * Derives the live behavior set from a scene's entities. An entity becomes a
   * runtime instance when it has a Behavior whose scriptId resolves in the
   * registry and a Transform to mutate. Each instance gets its own mutable
   * transform copy (the runtime source of truth behaviors edit).
   */
  setEntities(entities: readonly Entity[]): void {
    this.resetMessageSubscriptions();
    this.messageBus.clear();
    const instances: BehaviorInstance[] = [];
    this.runtimeEntities.clear();
    this.nameIndex.clear();
    this.tagIndex.clear();
    this.classRefIndex.clear();
    this.nodeIdIndex.clear();
    this.interfaceIndex.clear();
    this.runtimeState.clear();

    for (const entity of entities) {
      const transform = readTransformComponent(entity);
      if (!transform) continue;
      const runtime: RuntimeEntityState = {
        id: entity.id,
        entity,
        transform: cloneTransform(transform),
        audioComponent: readAudioComponent(entity),
        interactionComponent: readInteractionComponent(entity),
      };
      this.runtimeEntities.set(entity.id, runtime);
      if (entity.name) this.nameIndex.set(entity.name, entity.id);
      for (const tag of entity.tags ?? []) this.addToIndex(this.tagIndex, tag, entity.id);
      const scriptActor = readScriptActorComponent(entity);
      if (scriptActor) {
        this.addToIndex(this.classRefIndex, scriptActor.classRef, entity.id);
        if (scriptActor.nodeId) this.nodeIdIndex.set(scriptActor.nodeId, entity.id);
      }
      const interfaces = readScriptInterfacesComponent(entity);
      for (const name of interfaces?.interfaces ?? []) {
        this.addToIndex(this.interfaceIndex, name, entity.id);
      }
    }

    for (const entity of entities) {
      const behavior = readBehaviorComponent(entity);
      if (!behavior) continue;
      const update = this.registry.get(behavior.scriptId);
      if (!update) continue;
      const runtime = this.runtimeEntities.get(entity.id);
      if (!runtime) continue;
      instances.push({
        runtime,
        update,
        params: behavior.params ?? {},
      });
    }
    this.instances = instances;

    for (const entity of entities) {
      const runtime = this.runtimeEntities.get(entity.id);
      if (!runtime) continue;
      const messageBindings = readMessageBindingsComponent(entity);
      for (const binding of messageBindings?.bindings ?? []) {
        const update = this.registry.get(binding.scriptId);
        if (!update) continue;
        const unsubscribe = this.messageBus.subscribe(
          binding.message,
          (envelope) => {
            const engine = this.currentEngine;
            if (!engine) return;
            const context = this.createContext(
              runtime,
              engine,
              binding.params ?? {},
              envelope,
            );
            update(context);
            this.sink(runtime.id, runtime.transform);
          },
          binding.target === "self" ? { target: runtime.id } : {},
        );
        this.messageSubscriptions.push(unsubscribe);
        this.messageSubscriberInfo.push({
          entityId: runtime.id,
          message: binding.message,
          scriptId: binding.scriptId,
          target: binding.target,
        });
      }
    }
  }

  /** Drops all behavior instances (e.g. on scene teardown/reload). */
  clear(): void {
    this.instances = [];
    this.messageBus.clear();
    this.runtimeEntities.clear();
    this.nameIndex.clear();
    this.tagIndex.clear();
    this.classRefIndex.clear();
    this.nodeIdIndex.clear();
    this.interfaceIndex.clear();
    this.runtimeState.clear();
    this.resetMessageSubscriptions();
  }

  /**
   * Enables or disables behavior simulation. When disabled, update() is a no-op
   * so edit-mode hosts can keep authored scenes static until Play mode runs.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getLastMessageFlushResult(): ScriptMessageFlushResult {
    return this.lastMessageFlushResult;
  }

  getScriptMessageDebugSnapshot(): ScriptMessageDebugSnapshot {
    return {
      lastFlush: this.lastMessageFlushResult,
      recentMessages: this.messageBus.getRecentTrace(),
      subscribers: this.messageSubscriberInfo,
    };
  }

  getScriptActorDebugInfo(entityId: EntityId): ScriptActorDebugInfo | null {
    const runtime = this.runtimeEntities.get(entityId);
    if (!runtime) return null;
    const actor = readScriptActorComponent(runtime.entity);
    const info: ScriptActorDebugInfo = {
      entityId,
      ...(runtime.entity.name ? { name: runtime.entity.name } : {}),
      ...(actor?.classRef ? { classRef: actor.classRef } : {}),
      ...(actor?.nodeId ? { nodeId: actor.nodeId } : {}),
      interfaces: readScriptInterfacesComponent(runtime.entity)?.interfaces ?? [],
      dispatchers: readScriptDispatchersComponent(runtime.entity)?.dispatchers ?? [],
      subscribers: this.messageSubscriberInfo.filter((subscriber) => subscriber.entityId === entityId),
    };
    return info;
  }

  private currentEngine: EngineUpdateContext | null = null;
  private lastEngineFrame = 0;

  /**
   * Enqueues a script message from a non-behavior runtime source (e.g. a Game
   * Mode emitting an animation notify). Delivered on the next message flush.
   */
  emitScriptMessage(
    type: string,
    source: EntityId,
    payload?: ScriptMessagePayload,
    target?: EntityId,
  ): void {
    this.messageBus.send({
      frame: this.lastEngineFrame,
      type,
      source,
      ...(target !== undefined ? { target } : {}),
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  /**
   * Subscribes a non-behavior runtime source (e.g. a Game Mode reacting to a
   * `death`/`ragdoll` event) to a script message type, optionally scoped to one
   * target entity. Returns an unsubscribe handle the caller must release on
   * teardown. Unlike actor-script message bindings this is not tracked in the
   * debug subscriber index; the caller owns the lifetime. Note that `clear()`
   * (scene teardown/reload) drops all subscriptions, so re-subscribe after a
   * rebuild if needed.
   */
  subscribeScriptMessage(
    type: string,
    handler: (envelope: ScriptMessageEnvelope) => void,
    options: { readonly target?: EntityId } = {},
  ): () => void {
    return this.messageBus.subscribe(
      type,
      handler,
      options.target !== undefined ? { target: options.target } : {},
    );
  }

  update(engine: EngineUpdateContext): void {
    if (!this.enabled) return;
    this.currentEngine = engine;
    this.lastEngineFrame = engine.frame;
    for (const instance of this.instances) {
      const context = this.createContext(instance.runtime, engine, instance.params);
      instance.update(context);
      this.sink(instance.runtime.id, instance.runtime.transform);
    }
    this.lastMessageFlushResult = this.messageBus.flush();
    if (this.lastMessageFlushResult.warnings.length > 0) {
      this.onMessageWarnings?.(this.lastMessageFlushResult.warnings);
    }
    this.currentEngine = null;
  }

  dispose(): void {
    this.clear();
  }

  private createContext(
    runtime: RuntimeEntityState,
    engine: EngineUpdateContext,
    params: Record<string, SceneJsonValue>,
    message?: ScriptMessageEnvelope,
  ): BehaviorContext {
    const context: BehaviorContext = {
      entityId: runtime.id,
      engine,
      actions: this.actions,
      messages: this.scriptMessages(runtime.id, engine),
      world: this.scriptWorld(runtime.id),
      state: this.scriptState(runtime.id),
      params,
      transform: runtime.transform,
    };
    if (this.physics) {
      (context as BehaviorContext & { physics: PhysicsQuery }).physics = this.physics;
    }
    if (this.audio) {
      (context as BehaviorContext & { audio: AudioBus }).audio = this.audio;
    }
    if (runtime.audioComponent) {
      (context as BehaviorContext & { audioComponent: AudioComponent }).audioComponent =
        runtime.audioComponent;
    }
    if (runtime.interactionComponent) {
      (context as BehaviorContext & { interactionComponent: InteractionComponent }).interactionComponent =
        runtime.interactionComponent;
    }
    if (message) {
      (context as BehaviorContext & { message: ScriptMessageEnvelope }).message = message;
    }
    return context;
  }

  private scriptMessages(source: EntityId, engine: EngineUpdateContext): ScriptMessages {
    return {
      send: (target, type, payload) => {
        const input = { frame: engine.frame, type, source, target };
        this.messageBus.send(payload === undefined ? input : { ...input, payload });
      },
      emit: (type, payload) => {
        const input = { frame: engine.frame, type, source };
        this.messageBus.emit(payload === undefined ? input : { ...input, payload });
      },
    };
  }

  private scriptWorld(self: EntityId): ScriptWorld {
    return {
      self: () => self,
      ref: (key) => this.resolveReference(self, key),
      byName: (name) => this.nameIndex.get(name) ?? null,
      byTag: (tag) => [...(this.tagIndex.get(tag) ?? [])],
      byClassRef: (classRef) => [...(this.classRefIndex.get(classRef) ?? [])],
      withInterface: (name) => [...(this.interfaceIndex.get(name) ?? [])],
      nearestWithInterface: (name, from, maxDistance) =>
        this.nearestWithInterface(name, from, maxDistance),
    };
  }

  private scriptState(entityId: EntityId): ScriptState {
    const getStore = (): Map<string, unknown> => {
      let store = this.runtimeState.get(entityId);
      if (!store) {
        store = new Map();
        this.runtimeState.set(entityId, store);
      }
      return store;
    };
    return {
      get: (key, fallback) => (getStore().has(key) ? (getStore().get(key) as typeof fallback) : fallback),
      set: (key, value) => {
        getStore().set(key, value);
      },
      toggle: (key, fallback = false) => {
        const store = getStore();
        const next = !(store.has(key) ? Boolean(store.get(key)) : fallback);
        store.set(key, next);
        return next;
      },
    };
  }

  private nearestWithInterface(
    name: string,
    from: EntityId,
    maxDistance: number | undefined,
  ): EntityId | null {
    const source = this.runtimeEntities.get(from);
    if (!source) return null;
    let best: EntityId | null = null;
    let bestDistanceSq = Infinity;
    const maxDistanceSq = maxDistance === undefined ? Infinity : maxDistance * maxDistance;
    for (const targetId of this.interfaceIndex.get(name) ?? []) {
      if (targetId === from) continue;
      const target = this.runtimeEntities.get(targetId);
      if (!target) continue;
      const dx = target.transform.position[0] - source.transform.position[0];
      const dy = target.transform.position[1] - source.transform.position[1];
      const dz = target.transform.position[2] - source.transform.position[2];
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > maxDistanceSq || distanceSq >= bestDistanceSq) continue;
      best = targetId;
      bestDistanceSq = distanceSq;
    }
    return best;
  }

  private resolveReference(sourceEntityId: EntityId, key: string): EntityId | null {
    const source = this.runtimeEntities.get(sourceEntityId);
    if (!source) return null;
    const references = readScriptReferencesComponent(source.entity);
    const reference = references?.references.find((entry) => entry.key === key);
    if (!reference) return null;
    const selector = reference.selector;
    if (selector.byNodeId) return this.nodeIdIndex.get(selector.byNodeId) ?? null;
    if (selector.byName) return this.nameIndex.get(selector.byName) ?? null;
    if (selector.byTag) return this.firstSorted(this.tagIndex.get(selector.byTag));
    if (selector.byClassRef) return this.firstSorted(this.classRefIndex.get(selector.byClassRef));
    if (selector.byInterface) return this.firstSorted(this.interfaceIndex.get(selector.byInterface));
    return null;
  }

  private firstSorted(values: Set<EntityId> | undefined): EntityId | null {
    if (!values || values.size === 0) return null;
    return [...values].sort((a, b) => a.localeCompare(b))[0] ?? null;
  }

  private addToIndex(index: Map<string, Set<EntityId>>, key: string, entityId: EntityId): void {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(entityId);
  }

  private resetMessageSubscriptions(): void {
    for (const unsubscribe of this.messageSubscriptions) unsubscribe();
    this.messageSubscriptions = [];
    this.messageSubscriberInfo = [];
  }
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}
