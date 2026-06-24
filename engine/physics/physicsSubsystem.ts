import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import {
  readColliderComponent,
  readTransformComponent,
  type ColliderComponent,
  type ColliderPrimitive,
  type TransformComponent,
} from "../scene/components";
import { interactionGroupsInteract } from "../scene/collision";
import type { Entity, EntityId } from "../scene/entity";
import type { PhysicsAabb, PhysicsContact, PhysicsQuery } from "../behavior/behaviorSubsystem";
import type { Vec3 } from "../scene/layout";
import {
  ragdollJointAngularLimits,
  RAGDOLL_COLLISION_GROUPS,
  type QuatXYZW,
  type RagdollGroupDesc,
  type RagdollJointDesc,
  type RagdollPose,
} from "./ragdoll";

/**
 * Raw Rapier joint-set angular-limit setter. `RawImpulseJointSet.jointSetLimits`
 * is typed but its `RawJointAxis` enum isn't exported, so we reach it through this
 * minimal structural type with plain axis indices (AngX=3, AngY=4, AngZ=5).
 */
interface RawAngularLimitSetter {
  jointSetLimits(handle: number, axis: number, min: number, max: number): void;
}
const RAW_JOINT_AXIS_ANG_X = 3;
const RAW_JOINT_AXIS_ANG_Y = 4;
const RAW_JOINT_AXIS_ANG_Z = 5;

export const PHYSICS_SUBSYSTEM_ID = "physics";
/** Collider surface defaults when no physical material is assigned. */
const DEFAULT_FRICTION = 0.8;
const DEFAULT_RESTITUTION = 0;
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
type RapierImpulseJoint = ReturnType<RapierWorld["createImpulseJoint"]>;

interface RapierBodyRecord {
  id: EntityId;
  body: RapierRigidBody;
  /** One or more colliders (compound when the entity has authored primitives). */
  colliders: RapierCollider[];
  isSensor: boolean;
}

/** A spawned ragdoll's live Rapier bodies, keyed by their desc name. */
interface RagdollGroupRecord {
  id: number;
  bodies: Map<string, RapierRigidBody>;
}

export class PhysicsSubsystem implements Subsystem, PhysicsQuery {
  readonly id = PHYSICS_SUBSYSTEM_ID;
  private readonly backend: PhysicsBackend;
  private bodies: PhysicsBody[] = [];
  private contacts: PhysicsContact[] = [];
  /** Cached movement blockers (static colliders don't move); rebuilt lazily. */
  private staticBlockerCache: Aabb[] | null = null;
  private rapierModule: RapierModule | null = null;
  private rapierWorld: RapierWorld | null = null;
  private rapierBodies = new Map<EntityId, RapierBodyRecord>();
  private rapierColliderToEntity = new Map<number, EntityId>();
  private ragdollGroups = new Map<number, RagdollGroupRecord>();
  private nextRagdollId = 1;
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
    this.staticBlockerCache = null;
    if (this.rapierModule) this.rebuildRapierWorld();
  }

  setEntityTransform(entityId: EntityId, transform: TransformComponent): void {
    const body = this.bodies.find((candidate) => candidate.id === entityId);
    if (!body) return;
    body.transform = cloneTransform(transform);
    // A static body moving (editor drag) invalidates the cached blocker AABBs.
    if (body.collider.isStatic) this.staticBlockerCache = null;
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

  /**
   * World-space AABBs of every static, non-sensor collider — the movement
   * blockers fed to `resolvePlanarMovement`. A compound collider contributes one
   * AABB per primitive, and a `trimesh` primitive (complexAsSimple) contributes
   * one AABB per triangle, so the player collides with the actual footprint (e.g.
   * walks into an L-shaped wall's concave corner) instead of an enclosing box.
   * Cached because static colliders don't move.
   */
  staticBlockerAabbs(): readonly PhysicsAabb[] {
    if (this.staticBlockerCache) return this.staticBlockerCache;
    const blockers: Aabb[] = [];
    for (const body of this.bodies) {
      if (!body.collider.isStatic || body.collider.isSensor) continue;
      appendBlockerAabbs(blockers, body);
    }
    this.staticBlockerCache = blockers;
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

  /**
   * Spawns a transient ragdoll: a dynamic Rapier body per desc body, linked by
   * spherical impulse joints, dropped into the live world. The bodies collide
   * with the level's static colliders but never each other (see
   * `RAGDOLL_COLLISION_GROUPS`); angular damping keeps them from flailing since
   * the spherical joints carry no cone/twist limit (rapier3d-compat 0.19).
   *
   * Returns an id for {@link sampleRagdoll}/{@link despawnRagdoll}, or null when
   * the Rapier backend isn't active (a scene with no colliders never loads it).
   * Game code owns the trigger (e.g. a death event) and the per-tick bone driving.
   * Rebuilding the world (`setEntities`) frees these bodies — a ragdoll is meant
   * to live within a play session, not across scene reloads.
   *
   * `options.detachEntityId` moves that entity's colliders into the ragdoll's
   * collision group so the (kinematic) player capsule never shoves its own
   * ragdoll — the capsule still collides with the level. Not restored on despawn
   * (ragdoll activation is terminal for the possessed pawn).
   */
  spawnRagdoll(desc: RagdollGroupDesc, options: { detachEntityId?: EntityId } = {}): number | null {
    const RAPIER = this.rapierModule;
    if (!RAPIER || !this.rapierWorld) return null;
    const bodies = new Map<string, RapierRigidBody>();
    const bodyQuats = new Map<string, QuatXYZW>();
    for (const bodyDesc of desc.bodies) {
      const rigidBody = this.rapierWorld.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(bodyDesc.position[0], bodyDesc.position[1], bodyDesc.position[2])
          .setRotation({
            x: bodyDesc.quaternion[0],
            y: bodyDesc.quaternion[1],
            z: bodyDesc.quaternion[2],
            w: bodyDesc.quaternion[3],
          })
          .setCcdEnabled(true)
          .setLinearDamping(0.05)
          .setAngularDamping(0.6),
      );
      this.rapierWorld.createCollider(
        colliderShapeDesc(RAPIER, bodyDesc.shape, bodyDesc.size)
          .setMass(bodyDesc.mass)
          .setFriction(DEFAULT_FRICTION)
          .setRestitution(DEFAULT_RESTITUTION)
          .setCollisionGroups(RAGDOLL_COLLISION_GROUPS),
        rigidBody,
      );
      bodies.set(bodyDesc.name, rigidBody);
      bodyQuats.set(bodyDesc.name, bodyDesc.quaternion);
    }
    for (const joint of desc.joints) {
      const a = bodies.get(joint.bodyA);
      const b = bodies.get(joint.bodyB);
      if (!a || !b) continue;
      const params = RAPIER.JointData.spherical(
        { x: joint.anchorA[0], y: joint.anchorA[1], z: joint.anchorA[2] },
        { x: joint.anchorB[0], y: joint.anchorB[1], z: joint.anchorB[2] },
      );
      const impulseJoint = this.rapierWorld.createImpulseJoint(params, a, b, true);
      const quatA = bodyQuats.get(joint.bodyA);
      const quatB = bodyQuats.get(joint.bodyB);
      if (quatA && quatB) this.applyRagdollJointLimits(impulseJoint, joint, quatA, quatB);
    }
    if (options.detachEntityId !== undefined) {
      const record = this.rapierBodies.get(options.detachEntityId);
      if (record) {
        for (const collider of record.colliders) collider.setCollisionGroups(RAGDOLL_COLLISION_GROUPS);
      }
    }
    const id = this.nextRagdollId;
    this.nextRagdollId += 1;
    this.ragdollGroups.set(id, { id, bodies });
    return id;
  }

  /**
   * Clamps a spherical ragdoll joint's swing (AngX/AngZ) and twist (AngY) — limbs
   * run along Y, so AngY is the twist axis. Limits go through the raw joint set
   * (`jointSetLimits`) because the typed `SphericalImpulseJoint` exposes none; the
   * values are rest-widened (`ragdollJointAngularLimits`) so the joint never
   * starts in violation. Feature-detected: a no-op (floppy) if the raw setter is
   * absent, so a Rapier version bump can't crash here.
   */
  private applyRagdollJointLimits(
    joint: RapierImpulseJoint,
    jointDesc: RagdollJointDesc,
    quatA: QuatXYZW,
    quatB: QuatXYZW,
  ): void {
    const rawSet = this.rapierWorld?.impulseJoints.raw as unknown as
      | Partial<RawAngularLimitSetter>
      | undefined;
    if (!rawSet || typeof rawSet.jointSetLimits !== "function") return;
    const limits = ragdollJointAngularLimits(quatA, quatB, jointDesc.swingRad, jointDesc.twistRad);
    const handle = joint.handle;
    rawSet.jointSetLimits(handle, RAW_JOINT_AXIS_ANG_X, -limits.swing, limits.swing);
    rawSet.jointSetLimits(handle, RAW_JOINT_AXIS_ANG_Y, -limits.twist, limits.twist);
    rawSet.jointSetLimits(handle, RAW_JOINT_AXIS_ANG_Z, -limits.swing, limits.swing);
  }

  /** World transforms of a spawned ragdoll's bodies, after the latest step. */
  sampleRagdoll(id: number): RagdollPose[] {
    const group = this.ragdollGroups.get(id);
    if (!group) return [];
    const poses: RagdollPose[] = [];
    for (const [name, body] of group.bodies) {
      const translation = body.translation();
      const rotation = body.rotation();
      poses.push({
        name,
        position: [translation.x, translation.y, translation.z],
        quaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
      });
    }
    return poses;
  }

  /** Removes a spawned ragdoll (its bodies, colliders, and joints). */
  despawnRagdoll(id: number): void {
    const group = this.ragdollGroups.get(id);
    if (!group) return;
    if (this.rapierWorld) {
      for (const body of group.bodies.values()) this.rapierWorld.removeRigidBody(body);
    }
    this.ragdollGroups.delete(id);
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
        if (!interactionGroupsInteract(a.collider.collisionGroups, b.collider.collisionGroups)) {
          continue;
        }
        if (!aabbOverlaps(bodyAabb(a), bodyAabb(b))) continue;
        contacts.push({
          a: a.id,
          b: b.id,
          isSensor: a.collider.isSensor || b.collider.isSensor,
        });
      }
    }
    this.contacts = this.reportableContacts(contacts);
  }

  /**
   * Drops contacts whose owners opted out of events: a sensor overlap needs a
   * sensor with `generateOverlapEvents !== false`, and a solid hit needs a body
   * with `simulationGeneratesHitEvents !== false`. Both flags default to on
   * (absent), so unannotated bodies keep reporting every contact.
   */
  private reportableContacts(contacts: PhysicsContact[]): PhysicsContact[] {
    return contacts.filter((contact) => {
      const a = this.bodies.find((body) => body.id === contact.a);
      const b = this.bodies.find((body) => body.id === contact.b);
      if (!a || !b) return true;
      if (contact.isSensor) {
        return (
          (a.collider.isSensor && a.collider.generateOverlapEvents !== false) ||
          (b.collider.isSensor && b.collider.generateOverlapEvents !== false)
        );
      }
      return (
        a.collider.simulationGeneratesHitEvents !== false ||
        b.collider.simulationGeneratesHitEvents !== false
      );
    });
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
    this.ragdollGroups.clear();
  }

  private rebuildRapierWorld(): void {
    const RAPIER = this.rapierModule;
    if (!RAPIER) return;
    this.rapierWorld?.free();
    this.rapierWorld = new RAPIER.World(vectorFromVec3(this.gravity));
    this.rapierBodies.clear();
    this.rapierColliderToEntity.clear();
    // Ragdoll bodies belonged to the freed world; their handles are now invalid.
    this.ragdollGroups.clear();

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
    this.addAabbSensorContacts(contacts, seen);
    this.contacts = this.reportableContacts(contacts);
  }

  private addAabbSensorContacts(contacts: PhysicsContact[], seen: Set<string>): void {
    for (let i = 0; i < this.bodies.length; i += 1) {
      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const a = this.bodies[i];
        const b = this.bodies[j];
        if (!a || !b) continue;
        if (!a.collider.isSensor && !b.collider.isSensor) continue;
        if (a.collider.isStatic && b.collider.isStatic) continue;
        if (!interactionGroupsInteract(a.collider.collisionGroups, b.collider.collisionGroups)) {
          continue;
        }
        if (!aabbOverlaps(bodyAabb(a), bodyAabb(b))) continue;
        const key = contactKey(a.id, b.id);
        if (seen.has(key)) continue;
        seen.add(key);
        contacts.push({
          a: a.id,
          b: b.id,
          isSensor: true,
        });
      }
    }
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
    const key = contactKey(left.id, right.id);
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({
      a: left.id,
      b: right.id,
      isSensor: left.isSensor || right.isSensor,
    });
  }
}

function contactKey(a: EntityId, b: EntityId): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
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

/**
 * Appends one or more movement-blocker AABBs for a static body. Plain colliders
 * yield their single body AABB; compound colliders yield one per primitive; a
 * `trimesh` primitive yields one per triangle. Rotation is ignored, matching the
 * AABB movement model (`bodyAabb`).
 */
function appendBlockerAabbs(out: Aabb[], body: PhysicsBody): void {
  const primitives = body.collider.primitives;
  if (!primitives || primitives.length === 0) {
    out.push(bodyAabb(body));
    return;
  }
  const origin = body.transform.position;
  for (const primitive of primitives) {
    if (
      primitive.shape === "trimesh" &&
      primitive.vertices &&
      primitive.vertices.length >= 3 &&
      primitive.indices &&
      primitive.indices.length >= 3
    ) {
      appendTriangleAabbs(out, origin, primitive.vertices, primitive.indices);
    } else {
      out.push(primitiveAabb(origin, primitive));
    }
  }
}

/** World AABB of a single non-trimesh primitive (body origin + local center ± size/2). */
function primitiveAabb(origin: readonly number[], primitive: ColliderPrimitive): Aabb {
  const center = primitive.center ?? [0, 0, 0];
  const hx = primitive.size[0] / 2;
  const hy = primitive.size[1] / 2;
  const hz = primitive.size[2] / 2;
  const cx = (origin[0] ?? 0) + (center[0] ?? 0);
  const cy = (origin[1] ?? 0) + (center[1] ?? 0);
  const cz = (origin[2] ?? 0) + (center[2] ?? 0);
  return { min: [cx - hx, cy - hy, cz - hz], max: [cx + hx, cy + hy, cz + hz] };
}

/** One AABB per triangle of a trimesh primitive, translated by the body origin. */
function appendTriangleAabbs(
  out: Aabb[],
  origin: readonly number[],
  vertices: readonly Vec3[],
  indices: readonly number[],
): void {
  const ox = origin[0] ?? 0;
  const oy = origin[1] ?? 0;
  const oz = origin[2] ?? 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = vertices[indices[t]!];
    const b = vertices[indices[t + 1]!];
    const c = vertices[indices[t + 2]!];
    if (!a || !b || !c) continue;
    out.push({
      min: [
        ox + Math.min(a[0], b[0], c[0]),
        oy + Math.min(a[1], b[1], c[1]),
        oz + Math.min(a[2], b[2], c[2]),
      ],
      max: [
        ox + Math.max(a[0], b[0], c[0]),
        oy + Math.max(a[1], b[1], c[1]),
        oz + Math.max(a[2], b[2], c[2]),
      ],
    });
  }
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
  if (collider.friction !== undefined) clone.friction = collider.friction;
  if (collider.restitution !== undefined) clone.restitution = collider.restitution;
  if (collider.generateOverlapEvents !== undefined) {
    clone.generateOverlapEvents = collider.generateOverlapEvents;
  }
  if (collider.simulationGeneratesHitEvents !== undefined) {
    clone.simulationGeneratesHitEvents = collider.simulationGeneratesHitEvents;
  }
  if (collider.collisionGroups !== undefined) clone.collisionGroups = collider.collisionGroups;
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
  if (primitive.points) copy.points = primitive.points.map((point) => [...point] as typeof point);
  // Trimesh (complexAsSimple) data — must be carried through, or the Rapier
  // collider and the movement blockers both fall back to a box.
  if (primitive.vertices) copy.vertices = primitive.vertices.map((point) => [...point] as typeof point);
  if (primitive.indices) copy.indices = [...primitive.indices];
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
  const friction = body.collider.friction ?? DEFAULT_FRICTION;
  const restitution = body.collider.restitution ?? DEFAULT_RESTITUTION;
  const groups = body.collider.collisionGroups;
  return primitives.map((primitive) => {
    const desc = primitiveColliderDesc(RAPIER, primitive).setFriction(friction).setRestitution(restitution);
    if (groups !== undefined) desc.setCollisionGroups(groups);
    return desc;
  });
}

/**
 * A collider descriptor for one primitive. A convex primitive builds a Rapier
 * convex hull from its (already body-local) points; everything else is a
 * translated/rotated box/sphere/capsule. A degenerate hull falls back to the
 * primitive's bounding box.
 */
function primitiveColliderDesc(RAPIER: RapierModule, primitive: ColliderPrimitive) {
  if (
    primitive.shape === "trimesh" &&
    primitive.vertices &&
    primitive.vertices.length >= 3 &&
    primitive.indices &&
    primitive.indices.length >= 3
  ) {
    const vertices = new Float32Array(primitive.vertices.length * 3);
    primitive.vertices.forEach((point, index) => {
      vertices[index * 3] = point[0];
      vertices[index * 3 + 1] = point[1];
      vertices[index * 3 + 2] = point[2];
    });
    const indices = new Uint32Array(primitive.indices);
    return RAPIER.ColliderDesc.trimesh(vertices, indices);
  }
  if (primitive.shape === "convex" && primitive.points && primitive.points.length >= 4) {
    const flat = new Float32Array(primitive.points.length * 3);
    primitive.points.forEach((point, index) => {
      flat[index * 3] = point[0];
      flat[index * 3 + 1] = point[1];
      flat[index * 3 + 2] = point[2];
    });
    const hull = RAPIER.ColliderDesc.convexHull(flat);
    if (hull) return hull; // points are absolute (body-local) — no extra translation
  }
  const center = primitive.center ?? [0, 0, 0];
  const shape = primitive.shape === "convex" || primitive.shape === "trimesh" ? "box" : primitive.shape;
  const desc = colliderShapeDesc(RAPIER, shape, primitive.size).setTranslation(
    center[0] ?? 0,
    center[1] ?? 0,
    center[2] ?? 0,
  );
  if (primitive.rotation) desc.setRotation(quaternionFromEulerDegrees(primitive.rotation));
  return desc;
}

function colliderDescForBody(RAPIER: RapierModule, body: PhysicsBody) {
  // `size` is world-space (placement scale already baked); the `center` offset
  // is applied as the collider's translation relative to the body position.
  const size = body.collider.size;
  const center = body.collider.center ?? [0, 0, 0];
  const desc = colliderShapeDesc(RAPIER, body.collider.shape, size);
  const colliderDesc = desc
    .setTranslation(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0)
    .setFriction(body.collider.friction ?? DEFAULT_FRICTION)
    .setRestitution(body.collider.restitution ?? DEFAULT_RESTITUTION);
  if (body.collider.collisionGroups !== undefined) {
    colliderDesc.setCollisionGroups(body.collider.collisionGroups);
  }
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
  if (shape === "cylinder") {
    const radius = Math.max(size[0] ?? 1, size[2] ?? 1) / 2;
    return RAPIER.ColliderDesc.cylinder((size[1] ?? 1) / 2, radius);
  }
  if (shape === "cone") {
    const radius = Math.max(size[0] ?? 1, size[2] ?? 1) / 2;
    return RAPIER.ColliderDesc.cone((size[1] ?? 1) / 2, radius);
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
