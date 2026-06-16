import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import {
  readColliderComponent,
  readTransformComponent,
  type ColliderComponent,
  type TransformComponent,
} from "../scene/components";
import type { Entity, EntityId } from "../scene/entity";
import type { PhysicsAabb, PhysicsContact, PhysicsQuery } from "../behavior/behaviorSubsystem";

export const PHYSICS_SUBSYSTEM_ID = "physics";
export type PhysicsBackend = "placeholder" | "rapier";

export interface PhysicsSubsystemOptions {
  backend?: PhysicsBackend;
}

interface PhysicsBody {
  id: EntityId;
  transform: TransformComponent;
  collider: ColliderComponent;
}

interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

type RapierModule = typeof import("@dimforge/rapier3d-compat");
type RapierWorld = InstanceType<RapierModule["World"]>;
type RapierRigidBody = ReturnType<RapierWorld["createRigidBody"]>;
type RapierCollider = ReturnType<RapierWorld["createCollider"]>;

interface RapierBodyRecord {
  id: EntityId;
  body: RapierRigidBody;
  collider: RapierCollider;
  isSensor: boolean;
}

export class PhysicsSubsystem implements Subsystem, PhysicsQuery {
  readonly id = PHYSICS_SUBSYSTEM_ID;
  private readonly backend: PhysicsBackend;
  private bodies: PhysicsBody[] = [];
  private contacts: PhysicsContact[] = [];
  private rapierModule: RapierModule | null = null;
  private rapierWorld: RapierWorld | null = null;
  private rapierBodies = new Map<EntityId, RapierBodyRecord>();
  private rapierColliderToEntity = new Map<number, EntityId>();

  constructor(options: PhysicsSubsystemOptions = {}) {
    this.backend = options.backend ?? "placeholder";
  }

  /**
   * Loads the Rapier runtime only when the scene actually needs it. The heavy
   * Rapier WASM/compat module (the `vendor-physics` chunk, ~2 MB) is pulled in
   * here via dynamic import, so a physics-free game never fetches it.
   *
   * Backend `"rapier"` is a *preference*: the real load is derived from scene
   * content. If the entities passed to `setEntities()` yielded no collider
   * bodies we stay on the placeholder backend — `update()` falls back to AABB
   * overlap when there is no `rapierWorld` — so only scenes with colliders pay
   * the cost. Relies on `setEntities()` running before `init()`, which is the
   * SceneApp / RuntimeSceneApp load order.
   */
  async init(): Promise<void> {
    if (this.backend !== "rapier" || this.bodies.length === 0) return;
    this.rapierModule = await import("@dimforge/rapier3d-compat");
    await this.rapierModule.init();
    this.rebuildRapierWorld();
  }

  /** True once the Rapier runtime has been loaded (i.e. the scene had colliders). */
  usesRapier(): boolean {
    return this.rapierModule !== null;
  }

  setEntities(entities: readonly Entity[]): void {
    const bodies: PhysicsBody[] = [];
    for (const entity of entities) {
      const transform = readTransformComponent(entity);
      const collider = readColliderComponent(entity);
      if (!transform || !collider) continue;
      bodies.push({
        id: entity.id,
        transform: cloneTransform(transform),
        collider: cloneCollider(collider),
      });
    }
    this.bodies = bodies;
    this.contacts = [];
    if (this.rapierModule) this.rebuildRapierWorld();
  }

  setEntityTransform(entityId: EntityId, transform: TransformComponent): void {
    const body = this.bodies.find((candidate) => candidate.id === entityId);
    if (!body) return;
    body.transform = cloneTransform(transform);
    const rapier = this.rapierBodies.get(entityId);
    if (!rapier) return;
    const translation = vectorFromTransform(transform);
    if (rapier.body.isKinematic()) {
      rapier.body.setNextKinematicTranslation(translation);
    } else {
      rapier.body.setTranslation(translation, true);
    }
  }

  contactsForEntity(entityId: EntityId): readonly PhysicsContact[] {
    return this.contacts.filter((contact) => contact.a === entityId || contact.b === entityId);
  }

  /** World-space AABBs of every static, non-sensor collider — the movement blockers. */
  staticBlockerAabbs(): readonly PhysicsAabb[] {
    const blockers: PhysicsAabb[] = [];
    for (const body of this.bodies) {
      if (!body.collider.isStatic || body.collider.isSensor) continue;
      blockers.push(bodyAabb(body));
    }
    return blockers;
  }

  /** Half-extents (size*scale/2) of an entity's collider, or null if it has none. */
  colliderHalfExtents(entityId: EntityId): readonly [number, number, number] | null {
    const body = this.bodies.find((candidate) => candidate.id === entityId);
    if (!body) return null;
    return [
      Math.abs(body.transform.scale[0] ?? 1) * (body.collider.size[0] ?? 0) / 2,
      Math.abs(body.transform.scale[1] ?? 1) * (body.collider.size[1] ?? 0) / 2,
      Math.abs(body.transform.scale[2] ?? 1) * (body.collider.size[2] ?? 0) / 2,
    ];
  }

  update(_context: EngineUpdateContext): void {
    if (this.rapierWorld) {
      this.updateRapierContacts();
      return;
    }
    const contacts: PhysicsContact[] = [];
    for (let i = 0; i < this.bodies.length; i += 1) {
      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const a = this.bodies[i];
        const b = this.bodies[j];
        if (!a || !b) continue;
        if (a.collider.isStatic && b.collider.isStatic) continue;
        if (!aabbOverlaps(bodyAabb(a), bodyAabb(b))) continue;
        contacts.push({
          a: a.id,
          b: b.id,
          isSensor: a.collider.isSensor || b.collider.isSensor,
        });
      }
    }
    this.contacts = contacts;
  }

  clear(): void {
    this.bodies = [];
    this.contacts = [];
  }

  dispose(): void {
    this.clear();
    this.rapierWorld?.free();
    this.rapierWorld = null;
    this.rapierBodies.clear();
    this.rapierColliderToEntity.clear();
  }

  private rebuildRapierWorld(): void {
    const RAPIER = this.rapierModule;
    if (!RAPIER) return;
    this.rapierWorld?.free();
    this.rapierWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.rapierBodies.clear();
    this.rapierColliderToEntity.clear();

    for (const body of this.bodies) {
      const desc = body.collider.isStatic
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.kinematicPositionBased();
      desc.setTranslation(
        body.transform.position[0],
        body.transform.position[1],
        body.transform.position[2],
      );
      const rigidBody = this.rapierWorld.createRigidBody(desc);
      const collider = this.rapierWorld.createCollider(
        colliderDescForBody(RAPIER, body).setSensor(body.collider.isSensor),
        rigidBody,
      );
      this.rapierBodies.set(body.id, {
        id: body.id,
        body: rigidBody,
        collider,
        isSensor: body.collider.isSensor,
      });
      this.rapierColliderToEntity.set(collider.handle, body.id);
    }
  }

  private updateRapierContacts(): void {
    if (!this.rapierWorld) return;
    this.rapierWorld.step();
    const contacts: PhysicsContact[] = [];
    const seen = new Set<string>();
    for (const record of this.rapierBodies.values()) {
      this.rapierWorld.contactPairsWith(record.collider, (other) => {
        this.addRapierContact(contacts, seen, record, other);
      });
      this.rapierWorld.intersectionPairsWith(record.collider, (other) => {
        this.addRapierContact(contacts, seen, record, other);
      });
    }
    this.contacts = contacts;
  }

  private addRapierContact(
    contacts: PhysicsContact[],
    seen: Set<string>,
    a: RapierBodyRecord,
    bCollider: RapierCollider,
  ): void {
    const bId = this.rapierColliderToEntity.get(bCollider.handle);
    if (!bId || bId === a.id) return;
    const b = this.rapierBodies.get(bId);
    if (!b) return;
    const [left, right] = a.id < b.id ? [a, b] : [b, a];
    const key = `${left.id}\n${right.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({
      a: left.id,
      b: right.id,
      isSensor: left.isSensor || right.isSensor,
    });
  }
}

function bodyAabb(body: PhysicsBody): Aabb {
  const half = body.collider.size.map((size, axis) => {
    const scale = Math.abs(body.transform.scale[axis] ?? 1);
    return (size * scale) / 2;
  });
  return {
    min: [
      body.transform.position[0] - (half[0] ?? 0),
      body.transform.position[1] - (half[1] ?? 0),
      body.transform.position[2] - (half[2] ?? 0),
    ],
    max: [
      body.transform.position[0] + (half[0] ?? 0),
      body.transform.position[1] + (half[1] ?? 0),
      body.transform.position[2] + (half[2] ?? 0),
    ],
  };
}

function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return (
    a.min[0] <= b.max[0] &&
    a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] &&
    a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] &&
    a.max[2] >= b.min[2]
  );
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function cloneCollider(collider: ColliderComponent): ColliderComponent {
  return {
    shape: collider.shape,
    size: [...collider.size],
    isStatic: collider.isStatic,
    isSensor: collider.isSensor,
  };
}

function colliderDescForBody(RAPIER: RapierModule, body: PhysicsBody) {
  const size = body.collider.size.map((value, axis) => {
    const scale = Math.abs(body.transform.scale[axis] ?? 1);
    return value * scale;
  });
  if (body.collider.shape === "sphere") {
    return RAPIER.ColliderDesc.ball(Math.max(size[0] ?? 1, size[1] ?? 1, size[2] ?? 1) / 2);
  }
  if (body.collider.shape === "capsule") {
    const radius = Math.max(size[0] ?? 1, size[2] ?? 1) / 2;
    const halfHeight = Math.max(0, ((size[1] ?? 1) / 2) - radius);
    return RAPIER.ColliderDesc.capsule(halfHeight, radius);
  }
  return RAPIER.ColliderDesc.cuboid(
    (size[0] ?? 1) / 2,
    (size[1] ?? 1) / 2,
    (size[2] ?? 1) / 2,
  );
}

function vectorFromTransform(transform: TransformComponent): { x: number; y: number; z: number } {
  return {
    x: transform.position[0],
    y: transform.position[1],
    z: transform.position[2],
  };
}
