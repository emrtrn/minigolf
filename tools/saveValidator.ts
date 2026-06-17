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

/** The editor snap/grid settings the save endpoint persists into the manifest. */
export interface EditorSettingsPatch {
  gridSize?: number;
  gridEnabled?: boolean;
  snapRotationDeg?: number;
  snapRotationEnabled?: boolean;
  snapScale?: number;
  snapScaleEnabled?: boolean;
}

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
  return audio;
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
