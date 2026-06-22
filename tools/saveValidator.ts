/**
 * Save-payload validator for the `/__save-layout` dev endpoint.
 *
 * Extracted from `vite.config.ts` so it can be unit-tested headlessly (see
 * tools/engine-tests.ts) â€” the validator is an **allowlist**: every field that
 * survives a save is copied explicitly here. A new `LayoutPlacement` /
 * `LayoutCharacter` / `LayoutLightActor` field that is NOT added to
 * `applyTransformFields` / `validateLightActor` is silently dropped on save.
 * Keep this module dependency-free (no vite/node) so both the config and the
 * tests can import it.
 */

import {
  COLLISION_CHANNELS,
  isCollisionComplexity,
  isCollisionPresetId,
  isCollisionPrimitiveShape,
  isCollisionResponse,
  type CollisionChannel,
} from "../engine/scene/collision";
import {
  defaultPlacementForAsset,
  inferAssetTypeFromPath,
  isModelAssetType,
  type AssetRecord,
  type AssetType,
} from "../engine/assets/manifest";
import {
  defaultForgeMaterialDef,
  isForgeMaterialPreset,
  isForgeMaterialAlphaMode,
  isForgeMaterialSide,
  isForgeMaterialType,
  type ForgeMaterialPreset,
} from "../engine/assets/material";
import {
  isParentClass,
  normalizeActorScriptDef,
  type ParentClass,
} from "../engine/scene/actorScript";

/** The editor snap/grid settings the save endpoint persists into the manifest. */
export interface EditorSettingsPatch {
  gridSize?: number;
  gridEnabled?: boolean;
  snapRotationDeg?: number;
  snapRotationEnabled?: boolean;
  snapScale?: number;
  snapScaleEnabled?: boolean;
}

const UVW_MAP_TYPES = ["planar", "box", "sphere", "cylinder"] as const;
type UvwMapType = (typeof UVW_MAP_TYPES)[number];

export function isNumberTuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => Number.isFinite(item))
  );
}

function validateRotationDeg(value: unknown, label: string): number {
  const degrees = Number(value);
  if (!Number.isFinite(degrees) || degrees < -360 || degrees > 360) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(degrees.toFixed(1));
}

function validateScaleValue(value: unknown, label: string): number {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(scale.toFixed(3));
}

function validatePositiveSnap(value: unknown, label: string, max: number): number {
  const snap = Number(value);
  if (!Number.isFinite(snap) || snap <= 0 || snap > max) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(snap.toFixed(3));
}

function validateOptionalNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(number.toFixed(3));
}

function validateBooleanTuple(value: unknown, label: string): [boolean, boolean, boolean] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((item) => typeof item === "boolean")
  ) {
    throw new Error(`invalid ${label}`);
  }
  const [x, y, z] = value as [boolean, boolean, boolean];
  return [x, y, z];
}

function validatePhysics(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} physics must be an object`);
  }
  const input = value as Record<string, unknown>;
  const physics: Record<string, unknown> = {};
  const massKg = validateOptionalNumber(input.massKg, `${label} physics.massKg`, 0.001, 1_000_000);
  if (massKg !== undefined) physics.massKg = massKg;
  const linearDamping = validateOptionalNumber(
    input.linearDamping,
    `${label} physics.linearDamping`,
    0,
    100,
  );
  if (linearDamping !== undefined) physics.linearDamping = linearDamping;
  const angularDamping = validateOptionalNumber(
    input.angularDamping,
    `${label} physics.angularDamping`,
    0,
    100,
  );
  if (angularDamping !== undefined) physics.angularDamping = angularDamping;
  if (input.enableGravity !== undefined) {
    if (typeof input.enableGravity !== "boolean") {
      throw new Error(`${label} physics.enableGravity must be boolean`);
    }
    physics.enableGravity = input.enableGravity;
  }
  if (input.lockPosition !== undefined) {
    physics.lockPosition = validateBooleanTuple(input.lockPosition, `${label} physics.lockPosition`);
  }
  if (input.lockRotation !== undefined) {
    physics.lockRotation = validateBooleanTuple(input.lockRotation, `${label} physics.lockRotation`);
  }
  return Object.keys(physics).length > 0 ? physics : undefined;
}

/** Validates a schema-driven gameplay metadata blob (string/number/boolean/string[]). */
function validateMetadata(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} metadata must be an object`);
  }
  const input = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw === "string" || typeof raw === "boolean") {
      metadata[key] = raw;
    } else if (typeof raw === "number") {
      if (!Number.isFinite(raw)) throw new Error(`invalid ${label} metadata number: ${key}`);
      metadata[key] = raw;
    } else if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
      metadata[key] = [...raw];
    } else {
      throw new Error(`invalid ${label} metadata value for ${key}`);
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/** Validates an optional behavior reference (`{ script, params? }`). */
function validateBehavior(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} behavior must be an object`);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.script !== "string" || input.script.length === 0) {
    throw new Error(`${label} behavior.script must be a non-empty string`);
  }
  const behavior: Record<string, unknown> = { script: input.script };
  const params = validateMetadata(input.params, `${label} behavior.params`);
  if (params) behavior.params = params;
  return behavior;
}

/** Validates an optional audio cue reference (`{ clipId, volume?, loop?, spatial? }`). */
function validateAudio(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} audio must be an object`);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.clipId !== "string" || input.clipId.length === 0) {
    throw new Error(`${label} audio.clipId must be a non-empty string`);
  }
  const audio: Record<string, unknown> = { clipId: input.clipId };
  const volume = validateOptionalNumber(input.volume, `${label} audio.volume`, 0, 1);
  if (volume !== undefined) audio.volume = volume;
  if (input.loop !== undefined) {
    if (typeof input.loop !== "boolean") throw new Error(`${label} audio.loop must be boolean`);
    audio.loop = input.loop;
  }
  if (input.spatial !== undefined) {
    if (typeof input.spatial !== "boolean") throw new Error(`${label} audio.spatial must be boolean`);
    audio.spatial = input.spatial;
  }
  if (input.autoPlay !== undefined) {
    if (typeof input.autoPlay !== "boolean") throw new Error(`${label} audio.autoPlay must be boolean`);
    audio.autoPlay = input.autoPlay;
  }
  return audio;
}

const PARTICLE_MATERIAL_MODES = new Set(["additive", "alpha"]);

/** Validates an optional particle emitter (`{ effectId, ...emitter params }`). */
function validateParticleEmitter(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} particle must be an object`);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.effectId !== "string" || input.effectId.length === 0) {
    throw new Error(`${label} particle.effectId must be a non-empty string`);
  }
  const particle: Record<string, unknown> = { effectId: input.effectId };
  for (const flag of ["loop", "worldSpace", "autoPlay"] as const) {
    if (input[flag] === undefined) continue;
    if (typeof input[flag] !== "boolean") throw new Error(`${label} particle.${flag} must be boolean`);
    particle[flag] = input[flag];
  }
  const rate = validateOptionalNumber(input.rate, `${label} particle.rate`, 0, 10000);
  if (rate !== undefined) particle.rate = rate;
  const lifetime = validateOptionalNumber(input.lifetime, `${label} particle.lifetime`, 0, 60);
  if (lifetime !== undefined) particle.lifetime = lifetime;
  const startSize = validateOptionalNumber(input.startSize, `${label} particle.startSize`, 0, 100);
  if (startSize !== undefined) particle.startSize = startSize;
  const endSize = validateOptionalNumber(input.endSize, `${label} particle.endSize`, 0, 100);
  if (endSize !== undefined) particle.endSize = endSize;
  const spread = validateOptionalNumber(input.spread, `${label} particle.spread`, 0, 10);
  if (spread !== undefined) particle.spread = spread;
  if (input.velocity !== undefined) {
    if (!isNumberTuple(input.velocity)) {
      throw new Error(`${label} particle.velocity must be a [x, y, z] number tuple`);
    }
    particle.velocity = input.velocity.map((axis) => Number(axis.toFixed(3)));
  }
  if (input.materialMode !== undefined) {
    if (typeof input.materialMode !== "string" || !PARTICLE_MATERIAL_MODES.has(input.materialMode)) {
      throw new Error(`${label} particle.materialMode must be additive or alpha`);
    }
    particle.materialMode = input.materialMode;
  }
  return particle;
}

/** Validates an optional interaction marker (`{ action, prompt?, enabled?, requires?, cooldown? }`). */
function validateInteraction(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} interaction must be an object`);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.action !== "string" || input.action.length === 0) {
    throw new Error(`${label} interaction.action must be a non-empty string`);
  }
  const interaction: Record<string, unknown> = { action: input.action };
  if (input.prompt !== undefined) {
    if (typeof input.prompt !== "string") throw new Error(`${label} interaction.prompt must be a string`);
    interaction.prompt = input.prompt;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new Error(`${label} interaction.enabled must be boolean`);
    interaction.enabled = input.enabled;
  }
  if (input.requires !== undefined) {
    if (typeof input.requires !== "string") throw new Error(`${label} interaction.requires must be a string`);
    interaction.requires = input.requires;
  }
  const cooldown = validateOptionalNumber(input.cooldown, `${label} interaction.cooldown`, 0, 3600);
  if (cooldown !== undefined) interaction.cooldown = cooldown;
  return interaction;
}

/** Copies the optional transform/authoring fields onto `target`, validating each. */
export function applyTransformFields(
  entry: Record<string, unknown>,
  target: Record<string, unknown>,
  label: string,
): void {
  if (typeof entry.name === "string") target.name = entry.name;
  if (entry.hidden === true) target.hidden = true;
  if (entry.locked === true) target.locked = true;
  if (entry.scaleLocked === true) target.scaleLocked = true;
  if (entry.castShadow === false) target.castShadow = false;
  if (entry.collision === false) target.collision = false;
  if (entry.collisionPreset !== undefined) {
    if (!isCollisionPresetId(entry.collisionPreset)) {
      throw new Error(`invalid ${label} collisionPreset`);
    }
    target.collisionPreset = entry.collisionPreset;
  }
  if (entry.materialSlot !== undefined) {
    if (typeof entry.materialSlot !== "string" || entry.materialSlot.length === 0) {
      throw new Error(`invalid ${label} materialSlot`);
    }
    target.materialSlot = entry.materialSlot;
  }
  if (entry.sensor === true) target.sensor = true;
  if (entry.simulatePhysics === true) target.simulatePhysics = true;
  const physics = validatePhysics(entry.physics, label);
  if (physics) target.physics = physics;
  if (typeof entry.groupId === "string") target.groupId = entry.groupId;
  if (typeof entry.nodeId === "string") target.nodeId = entry.nodeId;
  if (typeof entry.parentId === "string") target.parentId = entry.parentId;
  const metadata = validateMetadata(entry.metadata, label);
  if (metadata) target.metadata = metadata;
  const behavior = validateBehavior(entry.behavior, label);
  if (behavior) target.behavior = behavior;
  const audio = validateAudio(entry.audio, label);
  if (audio) target.audio = audio;
  const particle = validateParticleEmitter(entry.particle, label);
  if (particle) target.particle = particle;
  const interaction = validateInteraction(entry.interaction, label);
  if (interaction) target.interaction = interaction;

  if (entry.rotationYDeg !== undefined) {
    target.rotationYDeg = validateRotationDeg(entry.rotationYDeg, `${label} rotationYDeg`);
  }
  if (entry.rotation !== undefined) {
    if (!isNumberTuple(entry.rotation)) throw new Error(`invalid ${label} rotation`);
    target.rotation = entry.rotation.map((axis) =>
      validateRotationDeg(axis, `${label} rotation component`),
    );
  }
  if (entry.pivot !== undefined) {
    if (!isNumberTuple(entry.pivot)) throw new Error(`invalid ${label} pivot`);
    target.pivot = entry.pivot.map((axis) => Number(axis.toFixed(3)));
  }
  if (entry.scale !== undefined) {
    target.scale = isNumberTuple(entry.scale)
      ? entry.scale.map((axis) => validateScaleValue(axis, `${label} scale component`))
      : validateScaleValue(entry.scale, `${label} scale`);
  }
}

export function validatePlacement(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("placement must be an object");
  }
  const entry = value as Record<string, unknown>;
  if (!isNumberTuple(entry.position)) throw new Error("invalid placement position");

  const placement: Record<string, unknown> = {
    position: entry.position.map((item) => Number(item.toFixed(3))),
  };
  applyTransformFields(entry, placement, "placement");
  return placement;
}

/**
 * Validates one placed Actor Script instance (`{ classRef, transform, ... }`).
 * Allowlist: a non-empty `.actor.json` `classRef`, position, and the shared
 * transform/hierarchy/flag fields. Component/behavior data lives in the class,
 * not the instance, so the rich placement fields (collision, audio, ...) do not
 * apply here. Per-instance overrides are a deferred phase.
 */
export function validateActorInstance(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("actor instance must be an object");
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.classRef !== "string" ||
    entry.classRef.length === 0 ||
    !entry.classRef.endsWith(".actor.json")
  ) {
    throw new Error("actor instance classRef must be a .actor.json path");
  }
  if (entry.classRef.includes("..")) throw new Error("actor instance classRef must not contain ..");
  if (!isNumberTuple(entry.position)) throw new Error("invalid actor instance position");

  const actor: Record<string, unknown> = {
    classRef: entry.classRef,
    position: entry.position.map((item) => Number(item.toFixed(3))),
  };
  if (typeof entry.name === "string") actor.name = entry.name;
  if (entry.hidden === true) actor.hidden = true;
  if (entry.locked === true) actor.locked = true;
  if (entry.scaleLocked === true) actor.scaleLocked = true;
  if (typeof entry.groupId === "string") actor.groupId = entry.groupId;
  if (typeof entry.nodeId === "string") actor.nodeId = entry.nodeId;
  if (typeof entry.parentId === "string") actor.parentId = entry.parentId;
  if (entry.rotationYDeg !== undefined) {
    actor.rotationYDeg = validateRotationDeg(entry.rotationYDeg, "actor rotationYDeg");
  }
  if (entry.rotation !== undefined) {
    if (!isNumberTuple(entry.rotation)) throw new Error("invalid actor rotation");
    actor.rotation = entry.rotation.map((axis) =>
      validateRotationDeg(axis, "actor rotation component"),
    );
  }
  if (entry.scale !== undefined) {
    actor.scale = isNumberTuple(entry.scale)
      ? entry.scale.map((axis) => validateScaleValue(axis, "actor scale component"))
      : validateScaleValue(entry.scale, "actor scale");
  }
  return actor;
}

function validateHexColor(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return value;
}

function validateWorldSettings(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") {
    throw new Error("worldSettings must be an object");
  }
  const input = value as Record<string, unknown>;
  const worldSettings: Record<string, unknown> = {};

  if (input.staticObjectsCastShadow !== undefined) {
    if (typeof input.staticObjectsCastShadow !== "boolean") {
      throw new Error("worldSettings.staticObjectsCastShadow must be boolean");
    }
    if (input.staticObjectsCastShadow) worldSettings.staticObjectsCastShadow = true;
  }

  if (input.staticObjectsReceiveShadow !== undefined) {
    if (typeof input.staticObjectsReceiveShadow !== "boolean") {
      throw new Error("worldSettings.staticObjectsReceiveShadow must be boolean");
    }
    if (!input.staticObjectsReceiveShadow) worldSettings.staticObjectsReceiveShadow = false;
  }

  if (input.backgroundColor !== undefined) {
    worldSettings.backgroundColor = validateHexColor(input.backgroundColor, "backgroundColor");
  }
  if (input.ambientColor !== undefined) {
    worldSettings.ambientColor = validateHexColor(input.ambientColor, "ambientColor");
  }
  if (input.ambientIntensity !== undefined) {
    const intensity = validateOptionalNumber(input.ambientIntensity, "ambientIntensity", 0, 20);
    if (intensity !== undefined) worldSettings.ambientIntensity = intensity;
  }
  if (input.gravity !== undefined) {
    if (!isNumberTuple(input.gravity)) {
      throw new Error("worldSettings.gravity must be a [x, y, z] number tuple");
    }
    worldSettings.gravity = input.gravity.map((axis) => Number(axis.toFixed(3)));
  }
  if (input.gameMode !== undefined) {
    if (typeof input.gameMode !== "string" || input.gameMode.length === 0) {
      throw new Error("worldSettings.gameMode must be a non-empty string");
    }
    worldSettings.gameMode = input.gameMode;
  }

  return Object.keys(worldSettings).length > 0 ? worldSettings : null;
}

export function validateLightActor(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("light must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new Error("light id must be a string");
  }
  if (input.type !== "directional" && input.type !== "point" && input.type !== "spot") {
    throw new Error("light type must be directional, point, or spot");
  }
  if (!isNumberTuple(input.position)) throw new Error("invalid light position");

  const light: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    position: input.position.map((number) => Number(number.toFixed(3))),
  };
  if (typeof input.name === "string") light.name = input.name;
  if (input.hidden === true) light.hidden = true;
  if (input.locked === true) light.locked = true;
  if (input.scaleLocked === true) light.scaleLocked = true;
  if (typeof input.groupId === "string") light.groupId = input.groupId;
  if (typeof input.nodeId === "string") light.nodeId = input.nodeId;
  if (typeof input.parentId === "string") light.parentId = input.parentId;
  if (input.rotation !== undefined) {
    if (!isNumberTuple(input.rotation)) throw new Error("invalid light rotation");
    light.rotation = input.rotation.map((axis) =>
      validateRotationDeg(axis, "light rotation component"),
    );
  }
  if (typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)) {
    light.color = input.color;
  }
  const intensity = validateOptionalNumber(input.intensity, "light.intensity", 0, 20);
  if (intensity !== undefined) light.intensity = intensity;
  if (input.castShadow !== undefined) {
    if (typeof input.castShadow !== "boolean") throw new Error("light.castShadow must be boolean");
    light.castShadow = input.castShadow;
  }
  const distance = validateOptionalNumber(input.distance, "light.distance", 0, 100);
  if (distance !== undefined) light.distance = distance;
  const angle = validateOptionalNumber(input.angle, "light.angle", 1, 90);
  if (angle !== undefined) light.angle = angle;
  const penumbra = validateOptionalNumber(input.penumbra, "light.penumbra", 0, 1);
  if (penumbra !== undefined) light.penumbra = penumbra;
  const decay = validateOptionalNumber(input.decay, "light.decay", 0, 8);
  if (decay !== undefined) light.decay = decay;
  return light;
}

/**
 * Allowlist validator for one placed Planar Reflection (mirror) actor. Mirrors
 * {@link validateLightActor}: a required `id` + `position`, the shared
 * transform/hierarchy/flag fields, plus the mirror `color` and `resolution`.
 */
export function validateReflectionPlane(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("reflection plane must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new Error("reflection plane id must be a string");
  }
  if (!isNumberTuple(input.position)) throw new Error("invalid reflection plane position");

  const plane: Record<string, unknown> = {
    id: input.id,
    position: input.position.map((number) => Number(number.toFixed(3))),
  };
  if (typeof input.name === "string") plane.name = input.name;
  if (input.hidden === true) plane.hidden = true;
  if (input.locked === true) plane.locked = true;
  if (input.scaleLocked === true) plane.scaleLocked = true;
  if (typeof input.groupId === "string") plane.groupId = input.groupId;
  if (typeof input.nodeId === "string") plane.nodeId = input.nodeId;
  if (typeof input.parentId === "string") plane.parentId = input.parentId;
  if (input.rotation !== undefined) {
    if (!isNumberTuple(input.rotation)) throw new Error("invalid reflection plane rotation");
    plane.rotation = input.rotation.map((axis) =>
      validateRotationDeg(axis, "reflection plane rotation component"),
    );
  }
  if (input.scale !== undefined) {
    if (!isNumberTuple(input.scale)) throw new Error("invalid reflection plane scale");
    plane.scale = input.scale.map((axis) =>
      validateScaleValue(axis, "reflection plane scale component"),
    );
  }
  if (typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)) {
    plane.color = input.color;
  }
  const resolution = validateOptionalNumber(input.resolution, "reflection plane resolution", 64, 2048);
  if (resolution !== undefined) plane.resolution = resolution;
  return plane;
}

/**
 * Allowlist validator for one placed Reflective Surface actor. Mirrors
 * {@link validateReflectionPlane}: a required `id` + `position`, the shared
 * transform/hierarchy/flag fields, plus the material reference and the
 * reflection-blend params (strength / fresnel / distortion / tint / resolution).
 */
export function validateReflectiveSurface(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("reflective surface must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new Error("reflective surface id must be a string");
  }
  if (!isNumberTuple(input.position)) throw new Error("invalid reflective surface position");

  const surface: Record<string, unknown> = {
    id: input.id,
    position: input.position.map((number) => Number(number.toFixed(3))),
  };
  if (typeof input.name === "string") surface.name = input.name;
  if (input.hidden === true) surface.hidden = true;
  if (input.locked === true) surface.locked = true;
  if (input.scaleLocked === true) surface.scaleLocked = true;
  if (typeof input.groupId === "string") surface.groupId = input.groupId;
  if (typeof input.nodeId === "string") surface.nodeId = input.nodeId;
  if (typeof input.parentId === "string") surface.parentId = input.parentId;
  if (input.rotation !== undefined) {
    if (!isNumberTuple(input.rotation)) throw new Error("invalid reflective surface rotation");
    surface.rotation = input.rotation.map((axis) =>
      validateRotationDeg(axis, "reflective surface rotation component"),
    );
  }
  if (input.scale !== undefined) {
    if (!isNumberTuple(input.scale)) throw new Error("invalid reflective surface scale");
    surface.scale = input.scale.map((axis) =>
      validateScaleValue(axis, "reflective surface scale component"),
    );
  }
  if (typeof input.material === "string" && input.material.length > 0) {
    surface.material = input.material;
  }
  const reflectionStrength = validateOptionalNumber(
    input.reflectionStrength,
    "reflective surface reflectionStrength",
    0,
    1,
  );
  if (reflectionStrength !== undefined) surface.reflectionStrength = reflectionStrength;
  const fresnelPower = validateOptionalNumber(
    input.fresnelPower,
    "reflective surface fresnelPower",
    0,
    16,
  );
  if (fresnelPower !== undefined) surface.fresnelPower = fresnelPower;
  const fresnelBias = validateOptionalNumber(
    input.fresnelBias,
    "reflective surface fresnelBias",
    0,
    1,
  );
  if (fresnelBias !== undefined) surface.fresnelBias = fresnelBias;
  const distortion = validateOptionalNumber(input.distortion, "reflective surface distortion", 0, 1);
  if (distortion !== undefined) surface.distortion = distortion;
  if (typeof input.tint === "string" && /^#[0-9a-fA-F]{6}$/.test(input.tint)) {
    surface.tint = input.tint;
  }
  const resolution = validateOptionalNumber(
    input.resolution,
    "reflective surface resolution",
    64,
    2048,
  );
  if (resolution !== undefined) surface.resolution = resolution;
  return surface;
}

/**
 * Allowlist validator for one placed Sphere Reflection Capture (probe) actor.
 * Mirrors {@link validateReflectionPlane}: a required `id` + `position`, the
 * shared transform/hierarchy/flag fields, plus the probe-specific radius /
 * intensity / resolution / near / far / parallax / priority. There is no `scale`
 * â€” the influence size is the `radius`.
 */
export function validateSphereReflectionCapture(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("reflection capture must be an object");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new Error("reflection capture id must be a string");
  }
  if (!isNumberTuple(input.position)) throw new Error("invalid reflection capture position");

  const capture: Record<string, unknown> = {
    id: input.id,
    position: input.position.map((number) => Number(number.toFixed(3))),
  };
  if (typeof input.name === "string") capture.name = input.name;
  if (input.hidden === true) capture.hidden = true;
  if (input.locked === true) capture.locked = true;
  if (input.scaleLocked === true) capture.scaleLocked = true;
  if (typeof input.groupId === "string") capture.groupId = input.groupId;
  if (typeof input.nodeId === "string") capture.nodeId = input.nodeId;
  if (typeof input.parentId === "string") capture.parentId = input.parentId;
  if (input.rotation !== undefined) {
    if (!isNumberTuple(input.rotation)) throw new Error("invalid reflection capture rotation");
    capture.rotation = input.rotation.map((axis) =>
      validateRotationDeg(axis, "reflection capture rotation component"),
    );
  }
  const radius = validateOptionalNumber(input.radius, "reflection capture radius", 0.1, 1000);
  if (radius !== undefined) capture.radius = radius;
  const intensity = validateOptionalNumber(input.intensity, "reflection capture intensity", 0, 4);
  if (intensity !== undefined) capture.intensity = intensity;
  const resolution = validateOptionalNumber(
    input.resolution,
    "reflection capture resolution",
    16,
    2048,
  );
  if (resolution !== undefined) capture.resolution = resolution;
  const near = validateOptionalNumber(input.near, "reflection capture near", 0.001, 1000);
  if (near !== undefined) capture.near = near;
  const far = validateOptionalNumber(input.far, "reflection capture far", 0.1, 100000);
  if (far !== undefined) capture.far = far;
  if (input.parallax === true) capture.parallax = true;
  const priority = validateOptionalNumber(input.priority, "reflection capture priority", -100, 100);
  if (priority !== undefined) capture.priority = priority;
  return capture;
}

/**
 * Allowlist validator for the singleton Sky Atmosphere actor. Every field that
 * survives a save is copied explicitly; omitted/out-of-range values are dropped
 * so the runtime falls back to {@link resolveSkyAtmosphere} defaults. Returns null
 * only when no sky actor is present (`undefined`); a placed sky at all-defaults
 * still round-trips as an empty object so its existence is never lost on save.
 */
export function validateSkyAtmosphere(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("skyAtmosphere must be an object");
  const input = value as Record<string, unknown>;
  const sky: Record<string, unknown> = {};

  if (typeof input.name === "string" && input.name.length > 0) sky.name = input.name;
  if (input.hidden === true) sky.hidden = true;

  // Scattering only; the sun direction lives on the directional Sun light.
  const numeric: Array<[keyof typeof input, number, number]> = [
    ["rayleigh", 0, 6],
    ["turbidity", 1, 20],
    ["mie", 0, 0.1],
    ["mieDirectionalG", 0, 1],
    ["exposure", 0, 4],
  ];
  for (const [key, min, max] of numeric) {
    const resolved = validateOptionalNumber(input[key], `skyAtmosphere.${String(key)}`, min, max);
    if (resolved !== undefined) sky[key as string] = resolved;
  }

  const skyLightCapture = validateSkyLightCapture(
    input.skyLightCapture,
    "skyAtmosphere.skyLightCapture",
  );
  if (skyLightCapture) sky.skyLightCapture = skyLightCapture;

  // A present (placed) sky always round-trips, even an all-defaults `{}`, so the
  // actor existence survives the save; only `undefined` (no sky) returns null.
  return sky;
}

function validateSkyLightCapture(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const input = value as Record<string, unknown>;
  const capture: Record<string, unknown> = {};
  const intensity = validateOptionalNumber(input.intensity, `${label}.intensity`, 0, 4);
  if (intensity !== undefined) capture.intensity = intensity;
  return Object.keys(capture).length > 0 ? capture : undefined;
}

/**
 * Allowlist validator for the singleton Exponential Height Fog actor. Mirrors
 * {@link validateSkyAtmosphere}: every surviving field is copied explicitly;
 * omitted/out-of-range values are dropped so the runtime falls back to
 * {@link resolveHeightFog} defaults. Returns null only when no fog actor is
 * present (`undefined`); a placed fog at all-defaults still round-trips as an
 * empty object so its existence is never lost on save.
 */
export function validateHeightFog(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("heightFog must be an object");
  const input = value as Record<string, unknown>;
  const fog: Record<string, unknown> = {};

  if (typeof input.name === "string" && input.name.length > 0) fog.name = input.name;
  if (input.hidden === true) fog.hidden = true;
  if (input.mode === "exp" || input.mode === "linear") fog.mode = input.mode;
  if (typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)) {
    fog.color = input.color;
  }

  const numeric: Array<[keyof typeof input, number, number]> = [
    ["density", 0, 10],
    ["start", 0, 100000],
    ["end", 0, 100000],
  ];
  for (const [key, min, max] of numeric) {
    const resolved = validateOptionalNumber(input[key], `heightFog.${String(key)}`, min, max);
    if (resolved !== undefined) fog[key as string] = resolved;
  }

  // A present (placed) fog always round-trips â€” even an all-defaults `{}` â€” so the
  // actor's existence survives the save; only `undefined` (no fog) returns null.
  return fog;
}

/**
 * Allowlist validator for the singleton static Cloud Layer actor. Mirrors
 * {@link validateHeightFog}: every surviving field is copied explicitly;
 * omitted/out-of-range values are dropped so the runtime falls back to
 * {@link resolveCloudLayer} defaults. Returns null only when no cloud actor is
 * present (`undefined`); a placed cloud at all-defaults still round-trips as an
 * empty object so its existence is never lost on save.
 */
export function validateCloudLayer(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("cloudLayer must be an object");
  const input = value as Record<string, unknown>;
  const cloud: Record<string, unknown> = {};

  if (typeof input.name === "string" && input.name.length > 0) cloud.name = input.name;
  if (input.hidden === true) cloud.hidden = true;
  if (typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)) {
    cloud.color = input.color;
  }

  const numeric: Array<[keyof typeof input, number, number]> = [
    ["coverage", 0, 1],
    ["density", 0, 1],
    ["softness", 0, 1],
    ["scale", 0.1, 20],
    ["speed", 0, 5],
  ];
  for (const [key, min, max] of numeric) {
    const resolved = validateOptionalNumber(input[key], `cloudLayer.${String(key)}`, min, max);
    if (resolved !== undefined) cloud[key as string] = resolved;
  }

  // A present (placed) cloud always round-trips â€” even an all-defaults `{}` â€” so
  // the actor's existence survives the save; only `undefined` returns null.
  return cloud;
}

/**
 * Allowlist validator for the singleton Reflection Environment (Sky Light) actor.
 * Faz 1 persists the capture source + reflection intensity. Like the other
 * singleton environment actors, a present all-defaults actor round-trips as `{}`
 * so its existence survives the save; only `undefined` returns null.
 */
export function validateReflection(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("reflection must be an object");
  const input = value as Record<string, unknown>;
  const reflection: Record<string, unknown> = {};

  if (typeof input.name === "string" && input.name.length > 0) reflection.name = input.name;
  if (input.hidden === true) reflection.hidden = true;
  if (input.source === "sky") {
    reflection.source = input.source;
  } else if (input.source !== undefined) {
    throw new Error("reflection.source must be sky");
  }

  const intensity = validateOptionalNumber(input.intensity, "reflection.intensity", 0, 4);
  if (intensity !== undefined) reflection.intensity = intensity;

  return reflection;
}

/**
 * Allowlist validator for the singleton global Post Process actor. Faz 1 only
 * persists renderer-property exposure + tone mapping. Like the other singleton
 * environment actors, a present all-defaults actor round-trips as `{}`.
 */
export function validatePostProcess(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("postProcess must be an object");
  const input = value as Record<string, unknown>;
  const post: Record<string, unknown> = {};

  if (typeof input.name === "string" && input.name.length > 0) post.name = input.name;
  if (input.hidden === true) post.hidden = true;
  if (
    input.toneMapping === "aces" ||
    input.toneMapping === "neutral" ||
    input.toneMapping === "none"
  ) {
    post.toneMapping = input.toneMapping;
  } else if (input.toneMapping !== undefined) {
    throw new Error("postProcess.toneMapping must be aces, neutral, or none");
  }
  if (input.antialias === "smaa") {
    post.antialias = input.antialias;
  } else if (input.antialias === "none") {
    // Default value: accepted for round-trip input but omitted from saved output.
  } else if (input.antialias !== undefined) {
    throw new Error("postProcess.antialias must be none or smaa");
  }

  const exposure = validateOptionalNumber(input.exposure, "postProcess.exposure", 0, 4);
  if (exposure !== undefined) post.exposure = exposure;

  const bloom = validatePostProcessBloom(input.bloom);
  if (bloom) post.bloom = bloom;
  const vignette = validatePostProcessVignette(input.vignette);
  if (vignette) post.vignette = vignette;
  const chromaticAberration = validatePostProcessChromaticAberration(input.chromaticAberration);
  if (chromaticAberration) post.chromaticAberration = chromaticAberration;
  const grain = validatePostProcessGrain(input.grain);
  if (grain) post.grain = grain;
  const dof = validatePostProcessDof(input.dof);
  if (dof) post.dof = dof;
  const ao = validatePostProcessAo(input.ao);
  if (ao) post.ao = ao;
  const saturation = validateOptionalNumber(input.saturation, "postProcess.saturation", 0, 2);
  if (saturation !== undefined) post.saturation = saturation;
  const contrast = validateOptionalNumber(input.contrast, "postProcess.contrast", 0, 2);
  if (contrast !== undefined) post.contrast = contrast;
  const temperature = validateOptionalNumber(input.temperature, "postProcess.temperature", -1, 1);
  if (temperature !== undefined) post.temperature = temperature;
  const tint = validateOptionalNumber(input.tint, "postProcess.tint", -1, 1);
  if (tint !== undefined) post.tint = tint;

  return post;
}

function validatePostProcessBloom(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("postProcess.bloom must be an object");
  }
  const input = value as Record<string, unknown>;
  const bloom: Record<string, unknown> = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new Error("postProcess.bloom.enabled must be boolean");
    if (input.enabled) bloom.enabled = true;
  }
  const threshold = validateOptionalNumber(input.threshold, "postProcess.bloom.threshold", 0, 2);
  if (threshold !== undefined) bloom.threshold = threshold;
  const intensity = validateOptionalNumber(input.intensity, "postProcess.bloom.intensity", 0, 5);
  if (intensity !== undefined) bloom.intensity = intensity;
  const radius = validateOptionalNumber(input.radius, "postProcess.bloom.radius", 0, 2);
  if (radius !== undefined) bloom.radius = radius;
  return Object.keys(bloom).length > 0 ? bloom : undefined;
}

function validatePostProcessVignette(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("postProcess.vignette must be an object");
  }
  const input = value as Record<string, unknown>;
  const vignette: Record<string, unknown> = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new Error("postProcess.vignette.enabled must be boolean");
    if (input.enabled) vignette.enabled = true;
  }
  const intensity = validateOptionalNumber(input.intensity, "postProcess.vignette.intensity", 0, 2);
  if (intensity !== undefined) vignette.intensity = intensity;
  const offset = validateOptionalNumber(input.offset, "postProcess.vignette.offset", 0, 2);
  if (offset !== undefined) vignette.offset = offset;
  return Object.keys(vignette).length > 0 ? vignette : undefined;
}

function validatePostProcessChromaticAberration(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("postProcess.chromaticAberration must be an object");
  }
  const input = value as Record<string, unknown>;
  const ca: Record<string, unknown> = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") {
      throw new Error("postProcess.chromaticAberration.enabled must be boolean");
    }
    if (input.enabled) ca.enabled = true;
  }
  const amount = validateOptionalNumber(input.amount, "postProcess.chromaticAberration.amount", 0, 2);
  if (amount !== undefined) ca.amount = amount;
  return Object.keys(ca).length > 0 ? ca : undefined;
}

function validatePostProcessGrain(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("postProcess.grain must be an object");
  }
  const input = value as Record<string, unknown>;
  const grain: Record<string, unknown> = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new Error("postProcess.grain.enabled must be boolean");
    if (input.enabled) grain.enabled = true;
  }
  const intensity = validateOptionalNumber(input.intensity, "postProcess.grain.intensity", 0, 1);
  if (intensity !== undefined) grain.intensity = intensity;
  return Object.keys(grain).length > 0 ? grain : undefined;
}

function validatePostProcessDof(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("postProcess.dof must be an object");
  }
  const input = value as Record<string, unknown>;
  const dof: Record<string, unknown> = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new Error("postProcess.dof.enabled must be boolean");
    if (input.enabled) dof.enabled = true;
  }
  const focusDistance = validateOptionalNumber(input.focusDistance, "postProcess.dof.focusDistance", 0, 100);
  if (focusDistance !== undefined) dof.focusDistance = focusDistance;
  const aperture = validateOptionalNumber(input.aperture, "postProcess.dof.aperture", 0, 2);
  if (aperture !== undefined) dof.aperture = aperture;
  const maxBlur = validateOptionalNumber(input.maxBlur, "postProcess.dof.maxBlur", 0, 2);
  if (maxBlur !== undefined) dof.maxBlur = maxBlur;
  return Object.keys(dof).length > 0 ? dof : undefined;
}

function validatePostProcessAo(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("postProcess.ao must be an object");
  }
  const input = value as Record<string, unknown>;
  const ao: Record<string, unknown> = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new Error("postProcess.ao.enabled must be boolean");
    if (input.enabled) ao.enabled = true;
  }
  const radius = validateOptionalNumber(input.radius, "postProcess.ao.radius", 0, 4);
  if (radius !== undefined) ao.radius = radius;
  const intensity = validateOptionalNumber(input.intensity, "postProcess.ao.intensity", 0, 2);
  if (intensity !== undefined) ao.intensity = intensity;
  return Object.keys(ao).length > 0 ? ao : undefined;
}

export function validateLayout(value: unknown): unknown {
  if (!value || typeof value !== "object") throw new Error("layout must be an object");
  const layout = value as Record<string, unknown>;

  if (layout.schema !== 1) throw new Error("layout schema must be 1");
  if (typeof layout.name !== "string") throw new Error("layout name must be a string");
  if (
    !Array.isArray(layout.loadGroups) ||
    !layout.loadGroups.every((item) => typeof item === "string")
  ) {
    throw new Error("loadGroups must be string[]");
  }
  if (!Array.isArray(layout.instances)) throw new Error("instances must be an array");
  if (!Array.isArray(layout.characters)) throw new Error("characters must be an array");
  const worldSettings = validateWorldSettings(layout.worldSettings);
  const skyAtmosphere = validateSkyAtmosphere(layout.skyAtmosphere);
  const heightFog = validateHeightFog(layout.heightFog);
  const cloudLayer = validateCloudLayer(layout.cloudLayer);
  const reflection = validateReflection(layout.reflection);
  const postProcess = validatePostProcess(layout.postProcess);
  const lights = layout.lights === undefined
    ? null
    : Array.isArray(layout.lights)
      ? layout.lights.map(validateLightActor)
      : (() => {
          throw new Error("lights must be an array");
        })();
  const reflectionPlanes = layout.reflectionPlanes === undefined
    ? null
    : Array.isArray(layout.reflectionPlanes)
      ? layout.reflectionPlanes.map(validateReflectionPlane)
      : (() => {
          throw new Error("reflectionPlanes must be an array");
        })();
  const reflectiveSurfaces = layout.reflectiveSurfaces === undefined
    ? null
    : Array.isArray(layout.reflectiveSurfaces)
      ? layout.reflectiveSurfaces.map(validateReflectiveSurface)
      : (() => {
          throw new Error("reflectiveSurfaces must be an array");
        })();
  const reflectionCaptures = layout.reflectionCaptures === undefined
    ? null
    : Array.isArray(layout.reflectionCaptures)
      ? layout.reflectionCaptures.map(validateSphereReflectionCapture)
      : (() => {
          throw new Error("reflectionCaptures must be an array");
        })();

  const instances = layout.instances.map((instance) => {
    if (!instance || typeof instance !== "object") {
      throw new Error("instance must be an object");
    }
    const item = instance as Record<string, unknown>;
    if (typeof item.assetId !== "string" || item.assetId.length === 0) {
      throw new Error("instance assetId must be a string");
    }
    if (!Array.isArray(item.placements)) {
      throw new Error(`placements missing for ${item.assetId}`);
    }
    return {
      assetId: item.assetId,
      placements: item.placements.map(validatePlacement),
    };
  });

  const characters = layout.characters.map((character) => {
    if (!character || typeof character !== "object") {
      throw new Error("character must be an object");
    }
    const item = character as Record<string, unknown>;
    if (typeof item.assetId !== "string" || item.assetId.length === 0) {
      throw new Error("character assetId must be a string");
    }
    if (!isNumberTuple(item.position)) throw new Error("invalid character position");
    const entry: Record<string, unknown> = {
      assetId: item.assetId,
      position: item.position.map((number) => Number(number.toFixed(3))),
    };
    if (typeof item.animation === "string") entry.animation = item.animation;
    applyTransformFields(item, entry, "character");
    return entry;
  });

  const actors =
    layout.actors === undefined
      ? null
      : Array.isArray(layout.actors)
        ? layout.actors.map(validateActorInstance)
        : (() => {
            throw new Error("actors must be an array");
          })();

  const output: Record<string, unknown> = {
    schema: 1,
    name: layout.name,
    loadGroups: layout.loadGroups,
    instances,
    characters,
  };
  if (worldSettings) output.worldSettings = worldSettings;
  if (skyAtmosphere) {
    if (
      reflection?.hidden !== true &&
      reflection?.intensity !== undefined &&
      !skyAtmosphere.skyLightCapture
    ) {
      skyAtmosphere.skyLightCapture = { intensity: reflection.intensity };
    }
    output.skyAtmosphere = skyAtmosphere;
  }
  if (heightFog) output.heightFog = heightFog;
  if (cloudLayer) output.cloudLayer = cloudLayer;
  if (postProcess) output.postProcess = postProcess;
  if (lights) output.lights = lights;
  if (reflectionPlanes) output.reflectionPlanes = reflectionPlanes;
  if (reflectiveSurfaces) output.reflectiveSurfaces = reflectiveSurfaces;
  if (reflectionCaptures) output.reflectionCaptures = reflectionCaptures;
  if (actors) output.actors = actors;
  return output;
}

function validateEditorSettings(value: unknown): EditorSettingsPatch | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("editor settings must be an object");
  const input = value as Record<string, unknown>;
  const editor: EditorSettingsPatch = {};

  if (input.gridSize !== undefined) {
    editor.gridSize = validatePositiveSnap(input.gridSize, "editor.gridSize", 100);
  }
  if (input.gridEnabled !== undefined) {
    if (typeof input.gridEnabled !== "boolean") throw new Error("editor.gridEnabled must be boolean");
    editor.gridEnabled = input.gridEnabled;
  }
  if (input.snapRotationDeg !== undefined) {
    editor.snapRotationDeg = validatePositiveSnap(
      input.snapRotationDeg,
      "editor.snapRotationDeg",
      360,
    );
  }
  if (input.snapRotationEnabled !== undefined) {
    if (typeof input.snapRotationEnabled !== "boolean") {
      throw new Error("editor.snapRotationEnabled must be boolean");
    }
    editor.snapRotationEnabled = input.snapRotationEnabled;
  }
  if (input.snapScale !== undefined) {
    editor.snapScale = validatePositiveSnap(input.snapScale, "editor.snapScale", 8);
  }
  if (input.snapScaleEnabled !== undefined) {
    if (typeof input.snapScaleEnabled !== "boolean") {
      throw new Error("editor.snapScaleEnabled must be boolean");
    }
    editor.snapScaleEnabled = input.snapScaleEnabled;
  }

  return editor;
}

function validateVec3(value: unknown, label: string): [number, number, number] {
  if (!isNumberTuple(value)) throw new Error(`invalid ${label}`);
  return value.map((axis) => Number(axis.toFixed(4))) as [number, number, number];
}

function validateCollisionPrimitive(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const input = value as Record<string, unknown>;
  if (!isCollisionPrimitiveShape(input.shape)) throw new Error(`invalid ${label}.shape`);
  const primitive: Record<string, unknown> = {
    shape: input.shape,
    size: validateVec3(input.size, `${label}.size`),
  };
  if (input.center !== undefined) primitive.center = validateVec3(input.center, `${label}.center`);
  if (input.rotation !== undefined) {
    primitive.rotation = validateVec3(input.rotation, `${label}.rotation`).map((axis) =>
      Number(axis.toFixed(3)),
    );
  }
  if (input.points !== undefined) {
    if (!Array.isArray(input.points)) throw new Error(`${label}.points must be an array`);
    primitive.points = input.points.map((point, index) =>
      validateVec3(point, `${label}.points[${index}]`),
    );
  }
  return primitive;
}

function validateCollisionResponses(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const input = value as Record<string, unknown>;
  const responses: Record<string, unknown> = {};
  for (const [channel, response] of Object.entries(input)) {
    if (!COLLISION_CHANNELS.includes(channel as CollisionChannel)) {
      throw new Error(`invalid ${label} channel: ${channel}`);
    }
    if (!isCollisionResponse(response)) {
      throw new Error(`invalid ${label} response for ${channel}`);
    }
    responses[channel] = response;
  }
  return Object.keys(responses).length > 0 ? responses : undefined;
}

/** Validates an asset-level collision definition (`*.collision.json` sidecar). */
export function validateAssetCollisionDef(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("collision def must be an object");
  }
  const input = value as Record<string, unknown>;
  if (!isCollisionComplexity(input.complexity)) throw new Error("invalid collision.complexity");
  if (!isCollisionPresetId(input.preset)) throw new Error("invalid collision.preset");
  if (!Array.isArray(input.primitives)) throw new Error("collision.primitives must be an array");
  const def: Record<string, unknown> = {
    primitives: input.primitives.map((primitive, index) =>
      validateCollisionPrimitive(primitive, `collision.primitives[${index}]`),
    ),
    complexity: input.complexity,
    preset: input.preset,
  };
  const responses = validateCollisionResponses(input.responses, "collision.responses");
  if (responses) def.responses = responses;
  if (input.physicalMaterialId !== undefined) {
    if (typeof input.physicalMaterialId !== "string") {
      throw new Error("collision.physicalMaterialId must be a string");
    }
    if (input.physicalMaterialId.length > 0) def.physicalMaterialId = input.physicalMaterialId;
  }
  if (input.doubleSided !== undefined) {
    if (typeof input.doubleSided !== "boolean") throw new Error("collision.doubleSided must be boolean");
    if (input.doubleSided) def.doubleSided = true;
  }
  // Event flags default to on; only persist an explicit `false`.
  if (input.generateOverlapEvents !== undefined) {
    if (typeof input.generateOverlapEvents !== "boolean") {
      throw new Error("collision.generateOverlapEvents must be boolean");
    }
    if (input.generateOverlapEvents === false) def.generateOverlapEvents = false;
  }
  if (input.simulationGeneratesHitEvents !== undefined) {
    if (typeof input.simulationGeneratesHitEvents !== "boolean") {
      throw new Error("collision.simulationGeneratesHitEvents must be boolean");
    }
    if (input.simulationGeneratesHitEvents === false) def.simulationGeneratesHitEvents = false;
  }
  return def;
}

/** Validates the `/__save-collision` payload (`{ path, collision }`). */
export function validateSaveCollisionPayload(value: unknown): {
  path: string;
  collision: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") throw new Error("collision payload must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.path !== "string" || !input.path.endsWith(".collision.json")) {
    throw new Error("collision payload path must end with .collision.json");
  }
  if (input.path.includes("..")) throw new Error("collision payload path must not contain ..");
  return {
    path: input.path,
    collision: validateAssetCollisionDef(input.collision),
  };
}

/** Validates the `/__save-actor` payload (`{ path, actor }`). */
export function validateSaveActorPayload(value: unknown): {
  path: string;
  actor: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") throw new Error("actor payload must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.path !== "string" || !input.path.endsWith(".actor.json")) {
    throw new Error("actor payload path must end with .actor.json");
  }
  if (input.path.includes("..")) throw new Error("actor payload path must not contain ..");
  // Normalize defensively so malformed authoring data never lands on disk.
  return {
    path: input.path,
    actor: normalizeActorScriptDef(input.actor) as unknown as Record<string, unknown>,
  };
}

/** Directory (project-root relative) generated behavior stubs are written to. */
export const BEHAVIOR_SCRIPTS_DIR = "src/game/scripts";

/** A generated behavior stub: where it lives + its TypeScript source. */
export interface BehaviorStubFile {
  /** Kebab-case file slug derived from the script id. */
  slug: string;
  /** camelCase TypeScript export identifier. */
  exportName: string;
  /** Project-root-relative path: `src/game/scripts/<slug>.ts`. */
  path: string;
  /** Full TypeScript source for the stub. */
  source: string;
}

function behaviorSlug(scriptId: string): string {
  return scriptId
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Turns a kebab slug into a camelCase identifier (digit-leading slugs get a prefix). */
function behaviorIdentifier(slug: string): string {
  const parts = slug.split("-").filter(Boolean);
  if (parts.length === 0) return "";
  let id = parts[0] + parts.slice(1).map(capitalize).join("");
  if (/^[0-9]/.test(id)) id = `behavior${capitalize(id)}`;
  return id;
}

/** Renders the TypeScript source for a `<scriptId>` behavior stub. */
export function behaviorStubSource(scriptId: string, exportName: string, slug: string): string {
  return `/**
 * Behavior: \`${scriptId}\`
 *
 * Auto-generated stub (Actor Script editor -> New Behavior). Implement the
 * per-tick update, then register it so event bindings referencing \`${scriptId}\`
 * resolve at runtime. In \`src/game/behaviors.ts\`:
 *
 *   import { ${exportName} } from "./scripts/${slug}";
 *   // 1. add "${scriptId}" to BEHAVIOR_SCRIPT_IDS
 *   // 2. add ["${scriptId}", ${exportName}] to the behaviors map
 *
 * The BehaviorContext is the script API: read input from \`context.actions\`,
 * query actors with \`context.world\`, persist per-entity runtime values with
 * \`context.state\`, and communicate through \`context.messages.send(...)\` or
 * \`context.messages.emit(...)\`. When this behavior runs from a message
 * binding, \`context.message\` contains the source, target, type, and payload.
 * Mutate only this entity's \`context.transform\`; reach other actors through
 * messages/interfaces instead of direct component writes.
 */
import type { BehaviorUpdate } from "@engine/behavior/behaviorSubsystem";

/** TODO: implement the \`${scriptId}\` behavior. */
export const ${exportName}: BehaviorUpdate = (context) => {
  // Example: const target = context.world.ref("linkedActor");
  // if (target) context.messages.send(target, "Some.Message", { from: context.entityId });
  // Remove this no-op once implemented.
  void context;
};
`;
}

/**
 * Derives the behavior stub file (slug + export + path + source) for a script
 * id, or throws if the id has no usable slug. Pure; shared by the dev endpoint
 * and headless tests.
 */
export function resolveBehaviorStub(scriptId: unknown): BehaviorStubFile {
  if (typeof scriptId !== "string") throw new Error("scriptId must be a string");
  const trimmed = scriptId.trim();
  if (!trimmed) throw new Error("scriptId must not be empty");
  if (trimmed.length > 80) throw new Error("scriptId too long");
  const slug = behaviorSlug(trimmed);
  if (!slug) throw new Error("scriptId has no usable letters or digits");
  const exportName = behaviorIdentifier(slug);
  if (!exportName) throw new Error("scriptId has no usable identifier");
  return {
    slug,
    exportName,
    path: `${BEHAVIOR_SCRIPTS_DIR}/${slug}.ts`,
    source: behaviorStubSource(trimmed, exportName, slug),
  };
}

/** Validates the `/__new-behavior` payload (`{ scriptId }`); throws on a bad id. */
export function validateNewBehaviorPayload(value: unknown): { scriptId: string } {
  if (!value || typeof value !== "object") throw new Error("behavior payload must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.scriptId !== "string") {
    throw new Error("behavior payload scriptId must be a string");
  }
  // Re-validate via the resolver so an unusable id is rejected before any write.
  resolveBehaviorStub(input.scriptId);
  return { scriptId: input.scriptId };
}

export function validateAssetMaterialSlotsDef(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("material slots def must be an object");
  }
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.slots)) throw new Error("materialSlots.slots must be an array");
  const slots = input.slots.map((slot, index) => {
    if (typeof slot !== "string" || slot.length === 0) {
      throw new Error(`materialSlots.slots[${index}] must be a non-empty string`);
    }
    return slot;
  });
  return { schema: 1, slots };
}

export function validateSaveMaterialSlotsPayload(value: unknown): {
  path: string;
  materialSlots: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") {
    throw new Error("material slots payload must be an object");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.path !== "string" || !input.path.endsWith(".materials.json")) {
    throw new Error("material slots payload path must end with .materials.json");
  }
  if (input.path.includes("..")) {
    throw new Error("material slots payload path must not contain ..");
  }
  return {
    path: input.path,
    materialSlots: validateAssetMaterialSlotsDef(input.materialSlots),
  };
}

function validateColorHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${label} must be a #rrggbb color`);
  }
  return value;
}

function validateTextureRef(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be a texture asset id or null`);
  return value;
}

export function validateForgeMaterialDef(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("material def must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.schema !== 1) throw new Error("material schema must be 1");
  if (input.type !== undefined && input.type !== "material") {
    throw new Error('material type must be "material"');
  }
  if (!isForgeMaterialType(input.materialType)) {
    throw new Error("material.materialType must be standard or basic");
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("material.name must be a non-empty string");
  }
  if (input.name.length > 120) throw new Error("material.name too long");

  const opacity = validateOptionalNumber(input.opacity, "material.opacity", 0, 1);
  const alphaMode = input.alphaMode === undefined
    ? opacity !== undefined && opacity < 1
      ? "blend"
      : "opaque"
    : input.alphaMode;
  if (!isForgeMaterialAlphaMode(alphaMode)) {
    throw new Error("material.alphaMode must be opaque, blend, or mask");
  }
  const side = input.side === undefined ? "front" : input.side;
  if (!isForgeMaterialSide(side)) {
    throw new Error("material.side must be front, back, or double");
  }

  return {
    schema: 1,
    type: "material",
    materialType: input.materialType,
    name: input.name.trim(),
    baseColor: validateColorHex(input.baseColor ?? "#ffffff", "material.baseColor"),
    baseColorTexture: validateTextureRef(input.baseColorTexture, "material.baseColorTexture"),
    normalTexture: validateTextureRef(input.normalTexture, "material.normalTexture"),
    maskTexture: validateTextureRef(input.maskTexture, "material.maskTexture"),
    roughness: validateOptionalNumber(input.roughness, "material.roughness", 0, 1) ?? 0.8,
    metalness: validateOptionalNumber(input.metalness, "material.metalness", 0, 1) ?? 0,
    opacity: opacity ?? 1,
    alphaMode,
    alphaTest: validateOptionalNumber(input.alphaTest, "material.alphaTest", 0, 1) ?? 0.5,
    side,
    emissive: validateColorHex(input.emissive ?? "#000000", "material.emissive"),
    emissiveIntensity:
      validateOptionalNumber(input.emissiveIntensity, "material.emissiveIntensity", 0, 20) ?? 0,
  };
}

export function validateSaveMaterialPayload(value: unknown): {
  path: string;
  material: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") {
    throw new Error("material payload must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.path !== "string" ||
    (!input.path.endsWith(".material.json") && !input.path.endsWith(".mat.json"))
  ) {
    throw new Error("material payload path must end with .material.json or .mat.json");
  }
  if (input.path.includes("..")) {
    throw new Error("material payload path must not contain ..");
  }
  return {
    path: input.path,
    material: validateForgeMaterialDef(input.material),
  };
}

export function validateAssetUvwDef(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("uvw def must be an object");
  }
  const input = value as Record<string, unknown>;
  const mapType = input.mapType;
  if (mapType !== null && !UVW_MAP_TYPES.includes(mapType as UvwMapType)) {
    throw new Error("invalid uvw.mapType");
  }
  return {
    schema: 1,
    mapType,
    position: validateVec3(input.position, "uvw.position"),
    rotation: validateVec3(input.rotation, "uvw.rotation").map((axis) =>
      Number(axis.toFixed(3)),
    ),
    scale: validateVec3(input.scale, "uvw.scale").map((axis) => {
      if (axis <= 0 || axis > 1_000_000) throw new Error("uvw.scale values must be positive");
      return Number(axis.toFixed(4));
    }),
  };
}

export function validateSaveUvwPayload(value: unknown): {
  path: string;
  uvw: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") {
    throw new Error("uvw payload must be an object");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.path !== "string" || !input.path.endsWith(".uvw.json")) {
    throw new Error("uvw payload path must end with .uvw.json");
  }
  if (input.path.includes("..")) {
    throw new Error("uvw payload path must not contain ..");
  }
  return {
    path: input.path,
    uvw: validateAssetUvwDef(input.uvw),
  };
}

/** Content Browser "new content" kinds the `/__content-new` endpoint accepts. */
export const CONTENT_NEW_KINDS = [
  "folder",
  "level",
  "material",
  "particle",
  "script",
  "sound",
  "ui",
] as const;
export type ContentNewKind = (typeof CONTENT_NEW_KINDS)[number];

export interface ContentNewPayload {
  kind: ContentNewKind;
  dir: string;
  name: string;
  /** For `kind: "script"`, the picked Actor Script parent class. */
  parentClass?: ParentClass;
  /** For `kind: "material"`, the initial material template. */
  materialPreset?: ForgeMaterialPreset;
}

function isContentNewKind(value: unknown): value is ContentNewKind {
  return typeof value === "string" && (CONTENT_NEW_KINDS as readonly string[]).includes(value);
}

/**
 * Sanitizes a user-entered content name to a single safe path segment: trimmed,
 * non-empty, no slashes / `..` / leading dot, Unicode letters+digits and a few
 * separators only (so Turkish names like "IÅŸÄ±k" are allowed).
 */
function sanitizeContentName(value: unknown): string {
  if (typeof value !== "string") throw new Error("content name must be a string");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("content name must not be empty");
  if (/[\\/]/.test(trimmed)) throw new Error("content name must not contain slashes");
  if (trimmed.includes("..")) throw new Error("content name must not contain ..");
  if (trimmed.startsWith(".")) throw new Error("content name must not start with a dot");
  if (trimmed.length > 80) throw new Error("content name too long");
  if (!/^[\p{L}\p{N} ._-]+$/u.test(trimmed)) throw new Error("content name has invalid characters");
  return trimmed;
}

/** Validates a `/__content-new` payload (folder or typed stub file to create). */
export function validateContentNewPayload(value: unknown): ContentNewPayload {
  if (!value || typeof value !== "object") throw new Error("content payload must be an object");
  const input = value as Record<string, unknown>;
  if (!isContentNewKind(input.kind)) throw new Error(`invalid content kind: ${String(input.kind)}`);
  if (typeof input.dir !== "string") throw new Error("content payload dir must be a string");
  if (input.dir.includes("..")) throw new Error("content payload dir must not contain ..");
  const payload: ContentNewPayload = {
    kind: input.kind,
    dir: input.dir,
    name: sanitizeContentName(input.name),
  };
  if (input.kind === "script") {
    payload.parentClass = isParentClass(input.parentClass) ? input.parentClass : "actor";
  } else if (input.kind === "material") {
    payload.materialPreset = isForgeMaterialPreset(input.materialPreset)
      ? input.materialPreset
      : "standard";
  }
  return payload;
}

export interface ContentNewFile {
  /** Public-root-relative path of the file/folder to create. */
  path: string;
  /** File contents to write, or null when the target is a directory. */
  content: string | null;
}

/** Minimal JSON stub for a typed asset; real editors expand these later. */
function contentStubJson(payload: ContentNewPayload): string {
  const { kind, name } = payload;
  let body: Record<string, unknown>;
  if (kind === "level") {
    // Empty RoomLayout (engine/scene/layout.ts).
    body = { schema: 1, name, loadGroups: [], instances: [], characters: [] };
  } else if (kind === "script") {
    // Actor Script class-asset (engine/scene/actorScript.ts), seeded with the
    // picked parent class and a root Transform component.
    body = normalizeActorScriptDef(
      { name, parentClass: payload.parentClass ?? "actor" },
      name,
    ) as unknown as Record<string, unknown>;
  } else if (kind === "particle") {
    body = {
      schema: 1,
      effectId: slugifyId(name),
      name,
      loop: true,
      rate: 10,
      lifetime: 1,
      startSize: 0.2,
      endSize: 0.2,
      velocity: [0, 1, 0],
      spread: 0.2,
      materialMode: "alpha",
      color: "#ffffff",
    };
  } else if (kind === "sound") {
    body = { schema: 1, type: "sound", name, clip: "" };
  } else if (kind === "ui") {
    body = { schema: 1, type: "ui", name, root: {} };
  } else if (kind === "material") {
    body = { ...defaultForgeMaterialDef(name, payload.materialPreset ?? "standard") };
  } else {
    body = { schema: 1, type: kind, name };
  }
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * Resolves the validated payload to the public-relative path + content to
 * create. Folders carry `content: null` (mkdir); typed files are written as
 * `<name>.<kind>.json` stubs inside `dir`.
 */
export function resolveContentNewFile(payload: ContentNewPayload): ContentNewFile {
  const dir = payload.dir.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\/+/, "");
  const join = (segment: string): string => (dir ? `${dir}/${segment}` : segment);
  if (payload.kind === "folder") {
    return { path: join(payload.name), content: null };
  }
  // A "script" is an Actor Script class-asset, stored as `<name>.actor.json`.
  const ext =
    payload.kind === "script" ? "actor" : payload.kind === "particle" ? "effect" : payload.kind;
  return {
    path: join(`${payload.name}.${ext}.json`),
    content: contentStubJson(payload),
  };
}

/**
 * File extensions the Content Browser Import accepts. Restricting to known
 * asset types keeps the dev endpoint from writing arbitrary files into public/.
 */
export const IMPORT_ALLOWED_EXTS = new Set([
  "glb",
  "gltf",
  "bin",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "ktx2",
  "basis",
  "hdr",
  "exr",
  "mp3",
  "wav",
  "ogg",
  "json",
]);

export interface ImportAssetMeta {
  dir: string;
  /** Sanitized destination filename (with an allowlisted extension). */
  name: string;
}

/**
 * Validates Import request metadata (`dir` + filename). The filename is
 * sanitized like a content name and must carry an allowlisted asset extension.
 */
export function validateImportAssetMeta(input: { dir: unknown; name: unknown }): ImportAssetMeta {
  if (typeof input.dir !== "string") throw new Error("import dir must be a string");
  if (input.dir.includes("..")) throw new Error("import dir must not contain ..");
  const name = sanitizeContentName(input.name);
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!ext) throw new Error("import file must have an extension");
  if (!IMPORT_ALLOWED_EXTS.has(ext)) throw new Error(`unsupported import type: .${ext}`);
  return { dir: input.dir, name };
}

/** Joins validated import metadata into a public-root-relative destination path. */
export function resolveImportPath(meta: ImportAssetMeta): string {
  const dir = meta.dir.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\/+/, "");
  return dir ? `${dir}/${meta.name}` : meta.name;
}

export interface ContentRenamePayload {
  /** Existing public-root-relative file path to rename. */
  path: string;
  /** New base name (single safe segment, without extension). */
  name: string;
}

/**
 * Validates a `/__content-rename` payload. The new name is sanitized to a single
 * safe path segment and must not carry its own extension â€” the source file's
 * extension chain (e.g. `.glb`, `.material.json`) is preserved by the resolver.
 */
export function validateContentRenamePayload(value: unknown): ContentRenamePayload {
  if (!value || typeof value !== "object") throw new Error("rename payload must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.path !== "string") throw new Error("rename payload path must be a string");
  if (input.path.includes("..")) throw new Error("rename payload path must not contain ..");
  const path = input.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("rename payload path must not be empty");
  const name = sanitizeContentName(input.name);
  if (name.includes(".")) throw new Error("rename name must not include an extension");
  return { path, name };
}

export interface ContentRenameTarget {
  /** Normalized source path. */
  from: string;
  /** Destination path: source dir + new base + the source extension chain. */
  to: string;
  /** Source extension chain, including the leading dot (empty when extensionless). */
  ext: string;
}

/**
 * Resolves a rename to its source/destination paths. The "extension chain" is
 * everything from the filename's first dot, so compound asset extensions like
 * `.material.json` survive while only the base name changes.
 */
export function resolveContentRenameTarget(payload: ContentRenamePayload): ContentRenameTarget {
  const from = payload.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const slash = from.lastIndexOf("/");
  const dir = slash >= 0 ? from.slice(0, slash) : "";
  const fileName = slash >= 0 ? from.slice(slash + 1) : from;
  const dot = fileName.indexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot) : "";
  const to = dir ? `${dir}/${payload.name}${ext}` : `${payload.name}${ext}`;
  return { from, to, ext };
}

export interface ContentDeletePayload {
  /** Public-root-relative file path to delete. */
  path: string;
}

/** Validates a `/__content-delete` payload (a single existing file to remove). */
export function validateContentDeletePayload(value: unknown): ContentDeletePayload {
  if (!value || typeof value !== "object") throw new Error("delete payload must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.path !== "string") throw new Error("delete payload path must be a string");
  if (input.path.includes("..")) throw new Error("delete payload path must not contain ..");
  const path = input.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("delete payload path must not be empty");
  return { path };
}

const ASSET_TYPE_CATEGORY: Record<AssetType, string> = {
  staticMesh: "prop",
  skeletalMesh: "character",
  texture: "texture",
  material: "material",
  sound: "sound",
  animation: "animation",
  prefab: "prefab",
  level: "level",
};

/** Slug + Title-Case helpers for deriving an asset id / display name from a filename. */
function slugifyId(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "asset";
}

function humanizeName(value: string): string {
  const spaced = value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  const titled = spaced.replace(/\b\w/g, (char) => char.toUpperCase());
  return titled || value;
}

/**
 * Builds a manifest `AssetRecord` for a freshly imported file so it is no longer
 * a "loose file". Returns null when the type can't be inferred (e.g. a `.bin`
 * companion or plain `.json`) â€” those stay unregistered. The id is made unique
 * against `existingIds`. Mesh assets are placeable with collision on; other
 * types are non-placeable. Defaults satisfy `validateAssetManifest`.
 */
export function buildImportedAssetRecord(
  path: string,
  bytes: number,
  existingIds: Iterable<string>,
): AssetRecord | null {
  const type = inferAssetTypeFromPath(path);
  if (!type) return null;

  const fileName = path.split("/").at(-1) ?? path;
  const dot = fileName.lastIndexOf(".");
  const baseName = dot > 0 ? fileName.slice(0, dot) : fileName;
  const parentDir = path.split("/").slice(0, -1).at(-1) ?? "";
  const category = parentDir && parentDir !== "assets" ? parentDir : ASSET_TYPE_CATEGORY[type];

  const taken = new Set(existingIds);
  const base = slugifyId(baseName);
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;

  const placeable = isModelAssetType(type);
  return {
    id,
    name: humanizeName(baseName),
    assetType: type,
    category,
    path,
    tags: [],
    placeable,
    placement: defaultPlacementForAsset(type),
    runtime: {
      loadGroup: category,
      castShadow: placeable,
      receiveShadow: placeable,
      collision: placeable,
      bytes: Math.max(0, Math.floor(bytes)),
    },
    license: "Unknown",
  };
}

export function validateSavePayload(value: unknown): {
  layout: unknown;
  editor: EditorSettingsPatch | null;
} {
  if (value && typeof value === "object" && "layout" in value) {
    const input = value as Record<string, unknown>;
    return {
      layout: validateLayout(input.layout),
      editor: validateEditorSettings(input.editor),
    };
  }
  return {
    layout: validateLayout(value),
    editor: null,
  };
}
