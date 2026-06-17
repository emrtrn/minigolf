import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import {
  readColliderComponent,
  readTransformComponent,
  type ColliderComponent,
  type ColliderPrimitive,
  type TransformComponent,
} from "../scene/components";
import type { Entity, EntityId } from "../scene/entity";
import type { PhysicsAabb, PhysicsContact, PhysicsQuery } from "../behavior/behaviorSubsystem";
import type { Vec3 } from "../scene/layout";

export const PHYSICS_SUBSYSTEM_ID = "physics";
export type PhysicsBackend = "placeholder" | "rapier";
export type PhysicsTransformSink = (entityId: EntityId, transform: TransformComponent) => void;

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
  /** One or more colliders (compound when the entity has authored primitives). */
  colliders: RapierCollider[];
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
  private gravity: Vec3 = [0, -9.81, 0];
  private transformSink: PhysicsTransformSink | null = null;
  private enabled = true;

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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setGravity(gravity: Vec3): void {
    this.gravity = [...gravity];
    if (this.rapierWorld) {
      this.rapierWorld.gravity = vectorFromVec3(this.gravity);
    }
  }

  setTransformSink(sink: PhysicsTransformSink | null): void {
    this.transformSink = sink;
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
    const rotation = quaternionFromEulerDegrees(transform.rotation);
    if (rapier.body.isKinematic()) {
      rapier.body.setNextKinematicTranslation(translation);
      rapier.body.setNextKinematicRotation(rotation);
    } else {
      rapier.body.setTranslation(translation, true);
      rapier.body.setRotation(rotation, true);
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

  /**
   * Half-extents of an entity's collider, or null if it has none. The collider
   * `size` already has placement scale baked at scene-build, so this is just
   * `size / 2`.
   */
  colliderHalfExtents(entityId: EntityId): readonly [number, number, number] | null {
    const body = this.bodies.find((candidate) => candidate.id === entityId);
    if (!body) return null;
    return [
      (body.collider.size[0] ?? 0) / 2,
      (body.collider.size[1] ?? 0) / 2,
      (body.collider.size[2] ?? 0) / 2,
    ];
  }

  update(_context: EngineUpdateContext): void {
    if (!this.enabled) {
      this.contacts = [];
      return;
    }
    if (this.rapierWorld) {
      const deltaSeconds = Math.max(0, Math.min(_context.deltaSeconds, 1 / 20));
      if (deltaSeconds > 0) this.rapierWorld.timestep = deltaSeconds;
      this.rapierWorld.step();
      this.updateRapierContacts();
      this.syncRapierDynamicTransforms();
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
    this.rapierWorld = new RAPIER.World(vectorFromVec3(this.gravity));
    this.rapierBodies.clear();
    this.rapierColliderToEntity.clear();

    for (const body of this.bodies) {
      const desc = rigidBodyDescForBody(RAPIER, body);
      desc.setTranslation(
        body.transform.position[0],
        body.transform.position[1],
        body.transform.position[2],
      );
      desc.setRotation(quaternionFromEulerDegrees(body.transform.rotation));
      const rigidBody = this.rapierWorld.createRigidBody(desc);
      const colliders = colliderDescsForBody(RAPIER, body).map((colliderDesc) =>
        this.rapierWorld!.createCollider(
          colliderDesc.setSensor(body.collider.isSensor),
          rigidBody,
        ),
      );
      this.rapierBodies.set(body.id, {
        id: body.id,
        body: rigidBody,
        colliders,
        isSensor: body.collider.isSensor,
      });
      for (const collider of colliders) this.rapierColliderToEntity.set(collider.handle, body.id);
    }
  }

  private updateRapierContacts(): void {
    if (!this.rapierWorld) return;
    const contacts: PhysicsContact[] = [];
    const seen = new Set<string>();
    for (const record of this.rapierBodies.values()) {
      for (const collider of record.colliders) {
        this.rapierWorld.contactPairsWith(collider, (other) => {
          this.addRapierContact(contacts, seen, record, other);
        });
        this.rapierWorld.intersectionPairsWith(collider, (other) => {
          this.addRapierContact(contacts, seen, record, other);
        });
      }
    }
    this.contacts = contacts;
  }

  private syncRapierDynamicTransforms(): void {
    if (!this.transformSink) return;
    for (const [entityId, rapier] of this.rapierBodies.entries()) {
      const body = this.bodies.find((candidate) => candidate.id === entityId);
      if (!body?.collider.simulatePhysics) continue;
      const translation = rapier.body.translation();
      const rotation = eulerDegreesFromQuaternion(rapier.body.rotation());
      const transform: TransformComponent = {
        position: [translation.x, translation.y, translation.z],
        rotation,
        scale: [...body.transform.scale],
      };
      body.transform = cloneTransform(transform);
      this.transformSink(entityId, transform);
    }
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
  // `size` and `center` are world-space (placement scale baked at scene-build),
  // so the AABB is centered at position + center with half-extents size / 2.
  const half = body.collider.size.map((size) => size / 2);
  const center = body.collider.center ?? [0, 0, 0];
  const point = body.transform.position.map(
    (axis, index) => axis + (center[index] ?? 0),
  );
  return {
    min: [
      (point[0] ?? 0) - (half[0] ?? 0),
      (point[1] ?? 0) - (half[1] ?? 0),
      (point[2] ?? 0) - (half[2] ?? 0),
    ],
    max: [
      (point[0] ?? 0) + (half[0] ?? 0),
      (point[1] ?? 0) + (half[1] ?? 0),
      (point[2] ?? 0) + (half[2] ?? 0),
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
  const clone: ColliderComponent = {
    shape: collider.shape,
    size: [...collider.size],
    isStatic: collider.isStatic,
    isSensor: collider.isSensor,
  };
  if (collider.center) clone.center = [...collider.center];
  if (collider.primitives) clone.primitives = collider.primitives.map(clonePrimitive);
  if (collider.simulatePhysics !== undefined) clone.simulatePhysics = collider.simulatePhysics;
  if (collider.massKg !== undefined) clone.massKg = collider.massKg;
  if (collider.linearDamping !== undefined) clone.linearDamping = collider.linearDamping;
  if (collider.angularDamping !== undefined) clone.angularDamping = collider.angularDamping;
  if (collider.enableGravity !== undefined) clone.enableGravity = collider.enableGravity;
  if (collider.lockPosition !== undefined) clone.lockPosition = [...collider.lockPosition];
  if (collider.lockRotation !== undefined) clone.lockRotation = [...collider.lockRotation];
  return clone;
}

function clonePrimitive(primitive: ColliderPrimitive): ColliderPrimitive {
  const copy: ColliderPrimitive = { shape: primitive.shape, size: [...primitive.size] };
  if (primitive.center) copy.center = [...primitive.center];
  if (primitive.rotation) copy.rotation = [...primitive.rotation];
  return copy;
}

/**
 * Collider descriptors for a body: one per authored primitive (a compound
 * collider) when present, otherwise the single box derived from the collider's
 * size/center. Each primitive carries its own local translation + rotation.
 */
function colliderDescsForBody(RAPIER: RapierModule, body: PhysicsBody) {
  const primitives = body.collider.primitives;
  if (!primitives || primitives.length === 0) return [colliderDescForBody(RAPIER, body)];
  return primitives.map((primitive) => {
    const center = primitive.center ?? [0, 0, 0];
    const desc = colliderShapeDesc(RAPIER, primitive.shape, primitive.size)
      .setTranslation(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0)
      .setFriction(0.8)
      .setRestitution(0);
    if (primitive.rotation) desc.setRotation(quaternionFromEulerDegrees(primitive.rotation));
    return desc;
  });
}

function colliderDescForBody(RAPIER: RapierModule, body: PhysicsBody) {
  // `size` is world-space (placement scale already baked); the `center` offset
  // is applied as the collider's translation relative to the body position.
  const size = body.collider.size;
  const center = body.collider.center ?? [0, 0, 0];
  const desc = colliderShapeDesc(RAPIER, body.collider.shape, size);
  const colliderDesc = desc
    .setTranslation(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0)
    .setFriction(0.8)
    .setRestitution(0);
  if (body.collider.simulatePhysics && body.collider.massKg !== undefined) {
    return colliderDesc.setMass(body.collider.massKg);
  }
  return colliderDesc;
}

function rigidBodyDescForBody(RAPIER: RapierModule, body: PhysicsBody) {
  if (body.collider.isStatic) return RAPIER.RigidBodyDesc.fixed();
  if (body.collider.simulatePhysics) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setCcdEnabled(true)
      .setLinearDamping(body.collider.linearDamping ?? 0.12)
      .setAngularDamping(body.collider.angularDamping ?? 0.45)
      .setGravityScale(body.collider.enableGravity === false ? 0 : 1);
    const lockPosition = body.collider.lockPosition;
    if (lockPosition) {
      desc.restrictTranslations(!lockPosition[0], !lockPosition[1], !lockPosition[2]);
    }
    const lockRotation = body.collider.lockRotation;
    if (lockRotation) {
      desc.restrictRotations(!lockRotation[0], !lockRotation[1], !lockRotation[2]);
    }
    return desc;
  }
  return RAPIER.RigidBodyDesc.kinematicPositionBased();
}

function colliderShapeDesc(
  RAPIER: RapierModule,
  shape: ColliderComponent["shape"],
  size: readonly number[],
) {
  if (shape === "sphere") {
    return RAPIER.ColliderDesc.ball(Math.max(size[0] ?? 1, size[1] ?? 1, size[2] ?? 1) / 2);
  }
  if (shape === "capsule") {
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

function vectorFromVec3(vec: Vec3): { x: number; y: number; z: number } {
  return {
    x: vec[0],
    y: vec[1],
    z: vec[2],
  };
}

function quaternionFromEulerDegrees(rotation: Vec3): { x: number; y: number; z: number; w: number } {
  const x = degreesToRadians(rotation[0]) / 2;
  const y = degreesToRadians(rotation[1]) / 2;
  const z = degreesToRadians(rotation[2]) / 2;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function eulerDegreesFromQuaternion(rotation: {
  x: number;
  y: number;
  z: number;
  w: number;
}): Vec3 {
  const x = rotation.x;
  const y = rotation.y;
  const z = rotation.z;
  const w = rotation.w;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);

  const ry = Math.asin(clamp(m13, -1, 1));
  let rx: number;
  let rz: number;
  if (Math.abs(m13) < 0.9999999) {
    rx = Math.atan2(-m23, m33);
    rz = Math.atan2(-m12, m11);
  } else {
    rx = Math.atan2(m32, m22);
    rz = 0;
  }
  return [radiansToDegrees(rx), radiansToDegrees(ry), radiansToDegrees(rz)];
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
