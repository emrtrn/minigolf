/**
 * Actor Script (Blueprint) class-asset model.
 *
 * An Actor Script is Forge's answer to an Unreal Actor Blueprint: a reusable
 * *class/prefab* (not a placed instance) that bundles a parent class, a
 * component template tree, authored variables, and event bindings. It is stored
 * as a `*.actor.json` sidecar under `public/`.
 *
 * Deliberately data-driven: there is no visual node graph. An {@link EventBinding}
 * references a behavior `scriptId` (resolved at runtime by the game's
 * BehaviorRegistry — the actual logic is TypeScript authored alongside the data)
 * plus opaque `params`. The editor surfaces parameters; AI/devs write the code.
 *
 * Pure module: no Three.js, no DOM. Both the editor (authoring) and the runtime
 * (spawning) read this, and `tools/saveValidator.ts` reuses {@link normalizeActorScriptDef}.
 */
import type { SceneJsonValue } from "./entity";
import type { MetadataFieldDef, MetadataFieldType } from "./metadataSchema";
import type { MetadataValue } from "./layout";

/** Parent class a user picks when creating an Actor Script (Unreal "Pick Parent Class"). */
export const PARENT_CLASSES = [
  "actor",
  "pawn",
  "character",
  "playerController",
  "gameMode",
] as const;
export type ParentClass = (typeof PARENT_CLASSES)[number];

/** Human-facing labels for the parent-class picker. */
export const PARENT_CLASS_LABELS: Record<ParentClass, string> = {
  actor: "Actor",
  pawn: "Pawn",
  character: "Character",
  playerController: "Player Controller",
  gameMode: "Game Mode Base",
};

/** One-line descriptions shown in the picker (mirrors Unreal's dialog copy). */
export const PARENT_CLASS_DESCRIPTIONS: Record<ParentClass, string> = {
  actor: "An Actor is an object that can be placed or spawned in the world.",
  pawn: "A Pawn is an actor that can be 'possessed' and receive input.",
  character: "A Character is a Pawn that includes the ability to walk.",
  playerController: "A Player Controller is an actor responsible for controlling a Pawn.",
  gameMode: "Game Mode Base defines the game being played, its rules and scoring.",
};

export function isParentClass(value: unknown): value is ParentClass {
  return typeof value === "string" && (PARENT_CLASSES as readonly string[]).includes(value);
}

/**
 * Variable key a `gameMode` Actor Script uses to name the default pawn class the
 * runtime spawns at the Player Start (Unreal's `DefaultPawnClass`). Authored as a
 * normal Details variable whose `default` holds the pawn class ref, so the data
 * model needs no dedicated field.
 */
export const GAME_MODE_DEFAULT_PAWN_VARIABLE = "defaultPawnClassRef";

/**
 * Reads a `gameMode` class's default pawn class ref from its authored variables
 * ({@link GAME_MODE_DEFAULT_PAWN_VARIABLE}), or undefined when unset/blank. The
 * runtime spawns this Actor Script class at the Player Start when the scene has
 * no authored player.
 */
export function readGameModeDefaultPawnClassRef(def: ActorScriptDef): string | undefined {
  const variable = def.variables.find((field) => field.key === GAME_MODE_DEFAULT_PAWN_VARIABLE);
  const value = variable?.default;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Runtime event a binding hooks into. A small fixed set mirroring the existing
 * behavior triggers (`src/game/behaviors.ts`): begin-play one-shots, per-tick
 * updates, sensor overlap, physics hit, and interaction.
 */
export const ACTOR_EVENT_KINDS = [
  "beginPlay",
  "tick",
  "overlap",
  "hit",
  "interact",
] as const;
export type ActorEventKind = (typeof ACTOR_EVENT_KINDS)[number];

export const ACTOR_EVENT_LABELS: Record<ActorEventKind, string> = {
  beginPlay: "Begin Play",
  tick: "Tick",
  overlap: "On Overlap",
  hit: "On Hit",
  interact: "On Interact",
};

export function isActorEventKind(value: unknown): value is ActorEventKind {
  return typeof value === "string" && (ACTOR_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Component kinds a template node can carry. A subset of the engine component
 * set (`engine/scene/components.ts`) that makes sense on an authored class.
 */
export const ACTOR_COMPONENT_KINDS = [
  "Transform",
  "MeshRenderer",
  "Collider",
  "Audio",
  "ParticleEmitter",
  "Light",
  "Interaction",
  "Behavior",
  "CharacterMovement",
  "SpringArm",
  "Camera",
] as const;
export type ActorComponentKind = (typeof ACTOR_COMPONENT_KINDS)[number];

export function isActorComponentKind(value: unknown): value is ActorComponentKind {
  return typeof value === "string" && (ACTOR_COMPONENT_KINDS as readonly string[]).includes(value);
}

/** Binds a runtime event to a behavior script id plus authored params. */
export interface EventBinding {
  event: ActorEventKind;
  /** Resolved at runtime by the game BehaviorRegistry. */
  scriptId: string;
  params?: Record<string, SceneJsonValue>;
}

export interface ActorReferenceSelector {
  byNodeId?: string;
  byName?: string;
  byTag?: string;
  byClassRef?: string;
  byInterface?: string;
}

export interface ActorReference {
  key: string;
  selector: ActorReferenceSelector;
}

export interface ActorDispatcher {
  name: string;
  payload?: Record<string, string>;
}

export type MessageBindingTarget = "self" | "any";

export interface MessageBinding {
  message: string;
  /** Resolved at runtime by the game BehaviorRegistry. */
  scriptId: string;
  params?: Record<string, SceneJsonValue>;
  target?: MessageBindingTarget;
}

/** One node of the component template tree (parent-child via `parent` ids). */
export interface ComponentTemplateNode {
  /** Stable id, unique within the class; referenced by children's `parent`. */
  id: string;
  /** Parent node id, or undefined for the root. */
  parent?: string;
  component: ActorComponentKind;
  /** Default component props (shape matches the matching `read*Component`). */
  props: Record<string, SceneJsonValue>;
}

/** A complete Actor Script class-asset (the `*.actor.json` payload). */
export interface ActorScriptDef {
  schema: 1;
  type: "actor";
  name: string;
  parentClass: ParentClass;
  /** Authored variables (reuses the Details schema field type). */
  variables: MetadataFieldDef[];
  components: ComponentTemplateNode[];
  interfaces: string[];
  references: ActorReference[];
  dispatchers: ActorDispatcher[];
  eventBindings: EventBinding[];
  messageBindings: MessageBinding[];
  /** Reserved for a future editor-time Construction Script hook (Faz 5). */
  construction: null;
}

function defaultCharacterComponents(): ComponentTemplateNode[] {
  return [
    { id: "root", component: "Transform", props: {} },
    {
      id: "capsule",
      parent: "root",
      component: "Collider",
      props: {
        shape: "capsule",
        size: [0.6, 1.8, 0.6],
        center: [0, 0.9, 0],
        isStatic: false,
        isSensor: false,
        simulatePhysics: false,
      },
    },
    {
      id: "meshRenderer",
      parent: "root",
      component: "MeshRenderer",
      props: { assetId: "character-a" },
    },
    {
      id: "characterMovement",
      parent: "root",
      component: "CharacterMovement",
      props: {
        maxWalkSpeed: 3,
        sprintMultiplier: 2,
        jumpSpeed: 4,
        gravityScale: 1,
        airControl: 0.25,
        acceleration: 30,
        brakingDeceleration: 24,
        groundFriction: 8,
        orientRotationToMovement: true,
        orientRotationToControl: false,
        movementMode: "walking",
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
      },
    },
  ];
}

const METADATA_FIELD_TYPES: readonly MetadataFieldType[] = [
  "text",
  "number",
  "boolean",
  "select",
  "tags",
];

/** A fresh, minimal class with a single root Transform component. */
export function defaultActorScriptDef(
  name: string,
  parentClass: ParentClass = "actor",
): ActorScriptDef {
  return {
    schema: 1,
    type: "actor",
    name,
    parentClass,
    variables: [],
    components:
      parentClass === "character"
        ? defaultCharacterComponents()
        : [{ id: "root", component: "Transform", props: {} }],
    interfaces: [],
    references: [],
    dispatchers: [],
    eventBindings: [],
    messageBindings: [],
    construction: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keeps only JSON-serializable params (objects/arrays/primitives), drops the rest. */
function normalizeParams(value: unknown): Record<string, SceneJsonValue> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, SceneJsonValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    out[key] = raw as SceneJsonValue;
  }
  return out;
}

function normalizeMetadataValue(value: unknown): MetadataValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as string[];
  }
  return undefined;
}

/** Normalizes one authored variable definition; returns null when unusable. */
function normalizeVariable(value: unknown): MetadataFieldDef | null {
  if (!isPlainObject(value)) return null;
  const key = value.key;
  const type = value.type;
  if (typeof key !== "string" || key.length === 0) return null;
  if (typeof type !== "string" || !METADATA_FIELD_TYPES.includes(type as MetadataFieldType)) {
    return null;
  }
  const field: MetadataFieldDef = {
    key,
    label: typeof value.label === "string" && value.label ? value.label : key,
    type: type as MetadataFieldType,
  };
  if (Array.isArray(value.options)) {
    field.options = value.options.filter((entry): entry is string => typeof entry === "string");
  }
  if (Array.isArray(value.suggestions)) {
    field.suggestions = value.suggestions.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  if (typeof value.min === "number") field.min = value.min;
  if (typeof value.max === "number") field.max = value.max;
  if (typeof value.step === "number") field.step = value.step;
  if (typeof value.placeholder === "string") field.placeholder = value.placeholder;
  const def = normalizeMetadataValue(value.default);
  if (def !== undefined) field.default = def;
  return field;
}

/** Normalizes one component template node; returns null when unusable. */
function normalizeComponentNode(value: unknown, index: number): ComponentTemplateNode | null {
  if (!isPlainObject(value)) return null;
  if (!isActorComponentKind(value.component)) return null;
  const id =
    typeof value.id === "string" && value.id.length > 0 ? value.id : `node-${index}`;
  const node: ComponentTemplateNode = {
    id,
    component: value.component,
    props: normalizeParams(value.props),
  };
  if (typeof value.parent === "string" && value.parent.length > 0) node.parent = value.parent;
  return node;
}

/** Normalizes one event binding; returns null when unusable. */
function normalizeEventBinding(value: unknown): EventBinding | null {
  if (!isPlainObject(value)) return null;
  if (!isActorEventKind(value.event)) return null;
  if (typeof value.scriptId !== "string" || value.scriptId.length === 0) return null;
  const binding: EventBinding = { event: value.event, scriptId: value.scriptId };
  const params = normalizeParams(value.params);
  if (Object.keys(params).length > 0) binding.params = params;
  return binding;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)),
  ];
}

function normalizeReferenceSelector(value: unknown): ActorReferenceSelector {
  if (!isPlainObject(value)) return {};
  const selector: ActorReferenceSelector = {};
  if (typeof value.byNodeId === "string" && value.byNodeId.length > 0) {
    selector.byNodeId = value.byNodeId;
  }
  if (typeof value.byName === "string" && value.byName.length > 0) selector.byName = value.byName;
  if (typeof value.byTag === "string" && value.byTag.length > 0) selector.byTag = value.byTag;
  if (typeof value.byClassRef === "string" && value.byClassRef.length > 0) {
    selector.byClassRef = value.byClassRef;
  }
  if (typeof value.byInterface === "string" && value.byInterface.length > 0) {
    selector.byInterface = value.byInterface;
  }
  return selector;
}

function normalizeActorReference(value: unknown): ActorReference | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.key !== "string" || value.key.length === 0) return null;
  const selector = normalizeReferenceSelector(value.selector);
  if (Object.keys(selector).length === 0) return null;
  return { key: value.key, selector };
}

function normalizeDispatcherPayload(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const payload: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && raw.length > 0) payload[key] = raw;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function normalizeActorDispatcher(value: unknown): ActorDispatcher | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.name !== "string" || value.name.length === 0) return null;
  const dispatcher: ActorDispatcher = { name: value.name };
  const payload = normalizeDispatcherPayload(value.payload);
  if (payload) dispatcher.payload = payload;
  return dispatcher;
}

function normalizeMessageBinding(value: unknown): MessageBinding | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.message !== "string" || value.message.length === 0) return null;
  if (typeof value.scriptId !== "string" || value.scriptId.length === 0) return null;
  const binding: MessageBinding = { message: value.message, scriptId: value.scriptId };
  const params = normalizeParams(value.params);
  if (Object.keys(params).length > 0) binding.params = params;
  if (value.target === "any") binding.target = "any";
  else if (value.target === "self") binding.target = "self";
  return binding;
}

/**
 * Defensively coerces arbitrary JSON into a valid {@link ActorScriptDef}.
 *
 * Back-compat: the legacy `{ schema:1, type:"script", graph:{} }` stub (and any
 * malformed file) normalizes to an empty `actor` class so old files keep opening.
 * Always returns a class with at least a root Transform.
 */
export function normalizeActorScriptDef(value: unknown, fallbackName = "Untitled"): ActorScriptDef {
  const input = isPlainObject(value) ? value : {};
  const name = typeof input.name === "string" && input.name.length > 0 ? input.name : fallbackName;
  const parentClass = isParentClass(input.parentClass) ? input.parentClass : "actor";

  const variables = Array.isArray(input.variables)
    ? input.variables.map(normalizeVariable).filter((v): v is MetadataFieldDef => v !== null)
    : [];

  const components = Array.isArray(input.components)
    ? input.components
        .map((node, index) => normalizeComponentNode(node, index))
        .filter((n): n is ComponentTemplateNode => n !== null)
    : [];
  // Always keep a root Transform so the component tree has an anchor.
  if (!components.some((node) => node.parent === undefined)) {
    components.unshift({ id: "root", component: "Transform", props: {} });
  }

  const eventBindings = Array.isArray(input.eventBindings)
    ? input.eventBindings.map(normalizeEventBinding).filter((b): b is EventBinding => b !== null)
    : [];
  const interfaces = normalizeStringArray(input.interfaces);
  const references = Array.isArray(input.references)
    ? input.references
        .map(normalizeActorReference)
        .filter((reference): reference is ActorReference => reference !== null)
    : [];
  const dispatchers = Array.isArray(input.dispatchers)
    ? input.dispatchers
        .map(normalizeActorDispatcher)
        .filter((dispatcher): dispatcher is ActorDispatcher => dispatcher !== null)
    : [];
  const messageBindings = Array.isArray(input.messageBindings)
    ? input.messageBindings
        .map(normalizeMessageBinding)
        .filter((binding): binding is MessageBinding => binding !== null)
    : [];

  return {
    schema: 1,
    type: "actor",
    name,
    parentClass,
    variables,
    components,
    interfaces,
    references,
    dispatchers,
    eventBindings,
    messageBindings,
    construction: null,
  };
}
