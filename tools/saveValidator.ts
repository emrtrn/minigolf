/**
 * Save-payload validator for the `/__save-layout` dev endpoint.
 *
 * Extracted from `vite.config.ts` so it can be unit-tested headlessly (see
 * tools/engine-tests.ts) — the validator is an **allowlist**: every field that
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
  const lights = layout.lights === undefined
    ? null
    : Array.isArray(layout.lights)
      ? layout.lights.map(validateLightActor)
      : (() => {
          throw new Error("lights must be an array");
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

  const output: Record<string, unknown> = {
    schema: 1,
    name: layout.name,
    loadGroups: layout.loadGroups,
    instances,
    characters,
  };
  if (worldSettings) output.worldSettings = worldSettings;
  if (lights) output.lights = lights;
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
}

function isContentNewKind(value: unknown): value is ContentNewKind {
  return typeof value === "string" && (CONTENT_NEW_KINDS as readonly string[]).includes(value);
}

/**
 * Sanitizes a user-entered content name to a single safe path segment: trimmed,
 * non-empty, no slashes / `..` / leading dot, Unicode letters+digits and a few
 * separators only (so Turkish names like "Işık" are allowed).
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
  } else if (kind === "sound") {
    body = { schema: 1, type: "sound", name, clip: "" };
  } else if (kind === "ui") {
    body = { schema: 1, type: "ui", name, root: {} };
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
  const ext = payload.kind === "script" ? "actor" : payload.kind;
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
 * companion or plain `.json`) — those stay unregistered. The id is made unique
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
      castShadow: true,
      receiveShadow: true,
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
