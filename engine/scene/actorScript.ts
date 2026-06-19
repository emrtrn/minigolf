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
  eventBindings: EventBinding[];
  /** Reserved for a future editor-time Construction Script hook (Faz 5). */
  construction: null;
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
    components: [{ id: "root", component: "Transform", props: {} }],
    eventBindings: [],
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

  return {
    schema: 1,
    type: "actor",
    name,
    parentClass,
    variables,
    components,
    eventBindings,
    construction: null,
  };
}
