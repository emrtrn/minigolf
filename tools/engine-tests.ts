/**
 * Engine scene/adapter checks. Bundled with esbuild and run on node by
 * `tools/run-engine-tests.mjs` (npm run test:engine). No test framework; uses
 * node:assert, matching the project's plain-node verification style.
 *
 * Imports editor selection on purpose (a test is neither engine nor editor
 * runtime) to prove the adapter's duplicated id format stays in sync with
 * `editor/core/selection.ts#selectionId`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  characterEntity,
  characterEntityId,
  instanceEntitiesForAsset,
  instanceEntityId,
  lightEntity,
  lightEntityId,
  roomLayoutToSceneDocument,
} from "../engine/scene/legacyRoomLayoutAdapter";
import { validateSceneDocument } from "../engine/scene/sceneSerialization";
import {
  readBehaviorComponent,
  readLightComponent,
  readMeshRendererComponent,
  readMetadataComponent,
  readTransformComponent,
} from "../engine/scene/components";
import { readRotation, readScale } from "../engine/scene/transform";
import { EngineApp } from "../engine/core/EngineApp";
import type { Subsystem } from "../engine/core/Subsystem";
import { AnimationSubsystem } from "../engine/render-three/animationSubsystem";
import { ActionMap } from "../engine/input/actionMap";
import { InputSubsystem } from "../engine/input/inputSubsystem";
import { BehaviorSubsystem } from "../engine/behavior/behaviorSubsystem";
import type { BehaviorRegistry } from "../engine/behavior/behaviorSubsystem";
import { KeyboardInputSource } from "../src/input/keyboardInputSource";
import type { Entity } from "../engine/scene/entity";
import { selectionId } from "../editor/core/selection";
import type { LayoutCharacter, LayoutLightActor, RoomLayout } from "../engine/scene/layout";
import type { AnimationMixer } from "three";

let checks = 0;
const check = (label: string, fn: () => void): void => {
  fn();
  checks += 1;
  console.log(`  ok: ${label}`);
};
const checkAsync = async (label: string, fn: () => Promise<void>): Promise<void> => {
  await fn();
  checks += 1;
  console.log(`  ok: ${label}`);
};

// 1. Entity ids must stay byte-for-byte in sync with editor selectionId.
check("instance id matches selectionId", () => {
  assert.equal(
    instanceEntityId("floor-full", 0),
    selectionId({ kind: "instance", assetId: "floor-full", placementIndex: 0 }),
  );
});
check("instance id encodes special chars like selectionId", () => {
  const assetId = "wall corner/odd:id";
  assert.equal(
    instanceEntityId(assetId, 7),
    selectionId({ kind: "instance", assetId, placementIndex: 7 }),
  );
});
check("character id matches selectionId", () => {
  assert.equal(characterEntityId(3), selectionId({ kind: "character", index: 3 }));
});
check("light id matches selectionId", () => {
  assert.equal(lightEntityId(2), selectionId({ kind: "light", index: 2 }));
});

// 2. Round-trip on the real saved layout (cwd is the repo root under npm).
const layout = JSON.parse(
  readFileSync("public/layouts/render-test-room.json", "utf8"),
) as RoomLayout;
const doc = roomLayoutToSceneDocument(layout);
check("derived document validates", () => {
  const result = validateSceneDocument(doc);
  assert.ok(result.valid, `errors: ${result.errors.join("; ")}`);
});
check("derived entity ids cover every placement/character/light", () => {
  const expectedIds: string[] = [];
  layout.instances.forEach((instance) => {
    instance.placements.forEach((_placement, index) => {
      expectedIds.push(instanceEntityId(instance.assetId, index));
    });
  });
  layout.characters.forEach((_character, index) => expectedIds.push(characterEntityId(index)));
  (layout.lights ?? []).forEach((_light, index) => expectedIds.push(lightEntityId(index)));
  assert.deepEqual(doc.entities.map((entity) => entity.id).sort(), [...expectedIds].sort());
});
check("world settings preserved", () => {
  assert.equal(doc.worldSettings?.ambientIntensity, layout.worldSettings?.ambientIntensity);
});
check("instance entity count equals total placements (empty instances add none)", () => {
  const totalPlacements = layout.instances.reduce(
    (count, instance) => count + instance.placements.length,
    0,
  );
  const instanceEntities = doc.entities.filter((entity) => entity.id.startsWith("instance:"));
  assert.equal(instanceEntities.length, totalPlacements);
});

// 3. Hierarchy: legacy nodeId/parentId collapses into the entity id space.
const hierarchyLayout: RoomLayout = {
  schema: 1,
  name: "hierarchy-fixture",
  loadGroups: [],
  instances: [{ assetId: "parent", placements: [{ position: [0, 0, 0], nodeId: "n1" }] }],
  characters: [
    { assetId: "child", position: [0, 0, 0], parentId: "n1" },
    { assetId: "orphan", position: [0, 0, 0], parentId: "missing" },
  ],
};
const hierarchyDoc = roomLayoutToSceneDocument(hierarchyLayout);
check("child parentId resolves to parent entity id", () => {
  const child = hierarchyDoc.entities.find((entity) => entity.id === "character:0");
  assert.equal(child?.parentId, instanceEntityId("parent", 0));
});
check("dangling parentId is dropped", () => {
  const orphan = hierarchyDoc.entities.find((entity) => entity.id === "character:1");
  assert.equal(orphan?.parentId, undefined);
});

// 4. Visibility/lock flags carried as entity tags.
const flagLayout: RoomLayout = {
  schema: 1,
  name: "flag-fixture",
  loadGroups: [],
  instances: [
    { assetId: "a", placements: [{ position: [0, 0, 0], hidden: true, locked: true }] },
  ],
  characters: [],
};
check("hidden/locked become entity tags", () => {
  const entity = roomLayoutToSceneDocument(flagLayout).entities.find(
    (candidate) => candidate.id === "instance:a:0",
  );
  assert.deepEqual(entity?.tags, ["hidden", "locked"]);
});

// 5. Render parity: instance entities carry the exact transform inputs the
// legacy placement render path uses, so entity-driven instanced rendering
// produces identical matrices (both compose via composeTransformMatrix).
check("instance entities carry placement transform + hidden for render parity", () => {
  for (const instance of layout.instances) {
    const entities = instanceEntitiesForAsset(instance.assetId, instance.placements);
    assert.equal(entities.length, instance.placements.length);
    instance.placements.forEach((placement, index) => {
      const entity = entities[index];
      const transform = readTransformComponent(entity);
      assert.ok(transform, `transform present for ${instance.assetId}[${index}]`);
      assert.deepEqual(transform.position, placement.position);
      assert.deepEqual(transform.rotation, readRotation(placement));
      assert.deepEqual(transform.scale, readScale(placement));
      assert.equal(entity.tags?.includes("hidden") ?? false, placement.hidden ?? false);
    });
  }
});

// 6. Render parity: a character entity carries the exact transform, mesh
// renderer, name-fallback, castShadow, and hidden inputs the legacy character
// render path reads, so entity-driven character objects (entityCharacterItem)
// match the legacy placement path (placementCharacterItem).
check("character entity carries placement render inputs for parity", () => {
  const characters: LayoutCharacter[] = [
    { assetId: "hero", name: "Hero", position: [1, 2, 3], rotation: [10, 20, 30], scale: [2, 2, 2] },
    {
      assetId: "blob",
      position: [0, 1, 0],
      rotationYDeg: 45,
      scale: 1.5,
      castShadow: false,
      hidden: true,
    },
    { assetId: "ghost", position: [4, 0, -1] },
  ];
  characters.forEach((character, index) => {
    const entity = characterEntity(index, character);
    const transform = readTransformComponent(entity);
    const renderer = readMeshRendererComponent(entity);
    assert.ok(transform, `transform present for character[${index}]`);
    assert.ok(renderer, `mesh renderer present for character[${index}]`);
    assert.deepEqual(transform.position, character.position);
    assert.deepEqual(transform.rotation, readRotation(character));
    assert.deepEqual(transform.scale, readScale(character));
    assert.equal(renderer.assetId, character.assetId);
    // Legacy name fallback: entity.name ?? assetId === placement.name ?? assetId.
    assert.equal(entity.name ?? renderer.assetId, character.name ?? character.assetId);
    // castShadow default-on: renderer.castShadow ?? true === placement.castShadow ?? true.
    assert.equal(renderer.castShadow ?? true, character.castShadow ?? true);
    assert.equal(entity.tags?.includes("hidden") ?? false, character.hidden ?? false);
  });
});

// 7. Render parity: a light entity carries the exact transform, light, name,
// and hidden inputs the legacy light render path reads, so entity-driven light
// objects (entityLightItem) match the legacy actor path (actorLightItem).
check("light entity carries actor render inputs for parity", () => {
  const lights: LayoutLightActor[] = [
    {
      id: "sun",
      type: "directional",
      name: "Sun",
      position: [3, 9, 4],
      rotation: [-55, 35, 0],
      color: "#ffffff",
      intensity: 2,
      castShadow: true,
    },
    {
      id: "lamp-1",
      type: "point",
      position: [1, 2, 3],
      distance: 8,
      decay: 2,
      intensity: 1.5,
      hidden: true,
    },
    {
      id: "spot-1",
      type: "spot",
      position: [0, 5, 0],
      rotation: [-90, 0, 0],
      angle: 30,
      penumbra: 0.35,
      distance: 10,
    },
  ];
  lights.forEach((actor, index) => {
    const entity = lightEntity(index, actor);
    const transform = readTransformComponent(entity);
    const light = readLightComponent(entity);
    assert.ok(transform, `transform present for light[${index}]`);
    assert.ok(light, `light component present for light[${index}]`);
    assert.deepEqual(transform.position, actor.position);
    assert.deepEqual(transform.rotation, readRotation(actor));
    assert.equal(light.type, actor.type);
    assert.equal(light.color, actor.color);
    assert.equal(light.intensity, actor.intensity);
    assert.equal(light.castShadow, actor.castShadow);
    assert.equal(light.distance, actor.distance);
    assert.equal(light.angle, actor.angle);
    assert.equal(light.penumbra, actor.penumbra);
    assert.equal(light.decay, actor.decay);
    // Name fallback baked into entity.name: name ?? id (the light id is not a
    // component field, so the adapter resolves the display name here).
    assert.equal(entity.name, actor.name ?? actor.id);
    assert.equal(entity.tags?.includes("hidden") ?? false, actor.hidden ?? false);
  });
});

// ===========================================================================
// Section 6 - Vertical Slice Readiness Gate
// ===========================================================================

// 6.1 Engine core can initialize and tick deterministic subsystems: forward
// lifecycle order for init/start/update (registration order) and reverse order
// for dispose, with a deterministic per-tick context (frame + elapsed).
await checkAsync("engine core initializes and ticks deterministic subsystems", async () => {
  const events: string[] = [];
  const make = (id: string): Subsystem => ({
    id,
    init() {
      events.push(`init:${id}`);
    },
    start() {
      events.push(`start:${id}`);
    },
    update(context) {
      events.push(`update:${id}:${context.frame}`);
    },
    dispose() {
      events.push(`dispose:${id}`);
    },
  });

  const app = new EngineApp();
  app.registerSubsystem(make("a"));
  app.registerSubsystem(make("b"));
  await app.init();
  await app.start();
  const tick1 = app.update(0.5);
  const tick2 = app.update(0.25);
  await app.dispose();

  assert.deepEqual(events, [
    "init:a",
    "init:b",
    "start:a",
    "start:b",
    "update:a:1",
    "update:b:1",
    "update:a:2",
    "update:b:2",
    "dispose:b",
    "dispose:a",
  ]);
  // Deterministic tick context.
  assert.equal(tick1.frame, 1);
  assert.equal(tick1.elapsedSeconds, 0.5);
  assert.equal(tick2.frame, 2);
  assert.equal(tick2.elapsedSeconds, 0.75);
});

// 6.1.1 The AnimationSubsystem advances its mixers through the engine tick with
// the per-tick deltaSeconds. This is the work that moved out of the SceneApp rAF
// loop: a registered AnimationSubsystem ticked by EngineApp.update must step its
// mixers by the same delta the loop previously passed inline.
check("animation subsystem ticks mixers with engine deltaSeconds", () => {
  const deltas: number[] = [];
  // Structural stand-in for a Three AnimationMixer (type-only dependency): the
  // subsystem only ever calls mixer.update(deltaSeconds), so no real Three
  // runtime is needed to prove the wiring.
  const fakeMixer = { update: (delta: number) => deltas.push(delta) } as unknown as AnimationMixer;

  const animation = new AnimationSubsystem();
  animation.add(fakeMixer);

  const app = new EngineApp();
  app.registerSubsystem(animation);
  app.update(0.5);
  app.update(0.25);
  assert.deepEqual(deltas, [0.5, 0.25]);

  // clear() detaches mixers so later ticks no longer advance them.
  animation.clear();
  app.update(0.1);
  assert.deepEqual(deltas, [0.5, 0.25]);
});

// 6.1.2 The action map turns raw codes into named-action pressed/held/released
// edges, advanced once per tick by the InputSubsystem. Proves the raw->named
// mapping and the per-tick edge contract the behavior layer will read.
check("input subsystem maps raw codes to named action edges per tick", () => {
  const actions = new ActionMap({ KeyW: "move-forward", ArrowUp: "move-forward" });
  const app = new EngineApp();
  app.registerSubsystem(new InputSubsystem(actions));

  // Untouched: idle.
  app.update(0.016);
  assert.deepEqual(actions.get("move-forward"), {
    pressed: false,
    held: false,
    released: false,
  });

  // Key down -> pressed + held on the next tick.
  actions.handleDown("KeyW");
  app.update(0.016);
  assert.deepEqual(actions.get("move-forward"), { pressed: true, held: true, released: false });

  // Still down -> held only (press edge consumed).
  app.update(0.016);
  assert.deepEqual(actions.get("move-forward"), { pressed: false, held: true, released: false });

  // A second bound code keeps the action held; releasing only the first does not
  // drop it.
  actions.handleDown("ArrowUp");
  actions.handleUp("KeyW");
  app.update(0.016);
  assert.deepEqual(actions.get("move-forward"), { pressed: false, held: true, released: false });

  // Last code up -> released for exactly one tick, then idle.
  actions.handleUp("ArrowUp");
  app.update(0.016);
  assert.deepEqual(actions.get("move-forward"), { pressed: false, held: false, released: true });
  app.update(0.016);
  assert.deepEqual(actions.get("move-forward"), {
    pressed: false,
    held: false,
    released: false,
  });

  // Unbound codes never produce an action.
  actions.handleDown("KeyX");
  app.update(0.016);
  assert.equal(actions.get("move-forward").held, false);
});

// 6.1.3 A layout placement/character carrying a behavior derives a readable
// BehaviorComponent (authoring path: layout field -> adapter -> typed reader).
check("layout behavior maps to a readable behavior component", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "behavior-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "turntable",
        placements: [
          {
            position: [0, 0, 0],
            behavior: { script: "spin", params: { speedDeg: 90, axis: "y" } },
          },
        ],
      },
    ],
    characters: [
      { assetId: "hero", position: [0, 0, 0], behavior: { script: "input-move" } },
    ],
    lights: [],
  };

  const document = roomLayoutToSceneDocument(fixture);

  const turntable = document.entities.find(
    (entity) => entity.id === instanceEntityId("turntable", 0),
  );
  const spin = turntable ? readBehaviorComponent(turntable) : undefined;
  assert.equal(spin?.scriptId, "spin");
  assert.deepEqual(spin?.params, { speedDeg: 90, axis: "y" });

  const hero = document.entities.find((entity) => entity.id === characterEntityId(0));
  const move = hero ? readBehaviorComponent(hero) : undefined;
  assert.equal(move?.scriptId, "input-move");
  assert.equal(move?.params, undefined);
});

// 6.1.4 The behavior subsystem ticks behaviors against a derived entity set,
// mutating each entity's transform deterministically and syncing it out. Input
// advances first (registered before), so a behavior reads current-tick actions.
check("behavior subsystem ticks behaviors and mutates transforms deterministically", () => {
  const synced: Array<{ id: string; rotationY: number; x: number }> = [];
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId === "spin") {
        return ({ engine, params, transform }) => {
          const speed = typeof params.speedDeg === "number" ? params.speedDeg : 0;
          transform.rotation[1] += speed * engine.deltaSeconds;
        };
      }
      if (scriptId === "input-move") {
        return ({ engine, actions, transform }) => {
          if (actions.held("move-right")) transform.position[0] += 2 * engine.deltaSeconds;
        };
      }
      return undefined;
    },
  };

  const actions = new ActionMap({ KeyD: "move-right" });
  const subsystem = new BehaviorSubsystem(registry, actions, (id, transform) => {
    synced.push({ id, rotationY: transform.rotation[1], x: transform.position[0] });
  });

  const spinEntity: Entity = {
    id: "character:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Behavior: { scriptId: "spin", params: { speedDeg: 90 } },
    },
  };
  const moveEntity: Entity = {
    id: "character:1",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Behavior: { scriptId: "input-move" },
    },
  };
  // No behavior -> ignored; an unknown script id would also be ignored.
  const inertEntity: Entity = {
    id: "character:2",
    components: { Transform: { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] } },
  };

  subsystem.setEntities([spinEntity, moveEntity, inertEntity]);

  const app = new EngineApp();
  app.registerSubsystem(new InputSubsystem(actions));
  app.registerSubsystem(subsystem);

  // Tick 1: 0.5s, no input -> spin advances 45deg, move stays put.
  app.update(0.5);
  // Tick 2: hold move-right for 0.5s -> spin advances another 45deg, move +1.0.
  actions.handleDown("KeyD");
  app.update(0.5);

  assert.equal(synced.length, 4); // 2 behaviored entities x 2 ticks (inert excluded)
  assert.equal(synced.filter((s) => s.id === "character:0").at(-1)?.rotationY, 90);
  assert.equal(synced.filter((s) => s.id === "character:1").at(-1)?.x, 1);
});

// 6.1.5 The real KeyboardInputSource feeds raw DOM key codes into the action
// map (the only runtime input link a browser would otherwise be needed to
// exercise). Uses an injected fake window, so no DOM/jsdom is required.
check("keyboard input source feeds raw codes into the action map", () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const fakeWindow = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(type, fn);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
  } as unknown as Window;

  const actions = new ActionMap({ KeyW: "move-forward" });
  const source = new KeyboardInputSource(actions, fakeWindow);
  source.attach();

  const fire = (type: string, event: Record<string, unknown>): void => {
    const handler = listeners.get(type);
    assert.ok(handler, `expected a ${type} listener`);
    handler?.(event);
  };

  // Real keydown -> action held after the next advance.
  fire("keydown", { code: "KeyW", repeat: false });
  actions.advance();
  assert.equal(actions.held("move-forward"), true);

  // Auto-repeat keydown must not re-fire as a fresh press.
  actions.advance(); // consume the press edge
  fire("keydown", { code: "KeyW", repeat: true });
  actions.advance();
  assert.equal(actions.pressed("move-forward"), false);
  assert.equal(actions.held("move-forward"), true);

  // keyup -> released for one tick.
  fire("keyup", { code: "KeyW", repeat: false });
  actions.advance();
  assert.equal(actions.released("move-forward"), true);

  // blur clears stuck physical state; detach removes all listeners.
  fire("keydown", { code: "KeyW", repeat: false });
  fire("blur", {});
  actions.advance();
  assert.equal(actions.held("move-forward"), false);

  source.detach();
  assert.equal(listeners.size, 0);
});

// 6.2 The scene model can represent a mesh entity, a light entity, metadata,
// and a transform hierarchy in a single validating document.
check("scene model represents mesh + light + metadata + transform hierarchy", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "readiness-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "crate",
        placements: [
          {
            position: [1, 0, 2],
            rotation: [0, 90, 0],
            scale: [2, 2, 2],
            nodeId: "crate-node",
            metadata: { hp: 100, label: "crate", fragile: true, kinds: ["wood", "metal"] },
          },
        ],
      },
    ],
    characters: [{ assetId: "hero", position: [1, 0, 3], parentId: "crate-node" }],
    lights: [{ id: "sun", type: "directional", position: [0, 5, 0], intensity: 2 }],
  };

  const document = roomLayoutToSceneDocument(fixture);
  assert.ok(validateSceneDocument(document).valid, "fixture document validates");

  // Mesh entity with a transform.
  const crate = document.entities.find((entity) => entity.id === instanceEntityId("crate", 0));
  const crateMesh = crate ? readMeshRendererComponent(crate) : undefined;
  const crateTransform = crate ? readTransformComponent(crate) : undefined;
  assert.equal(crateMesh?.assetId, "crate");
  assert.deepEqual(crateTransform?.scale, [2, 2, 2]);

  // Metadata component on the mesh entity.
  const metadata = crate ? readMetadataComponent(crate) : undefined;
  assert.deepEqual(metadata?.values, {
    hp: 100,
    label: "crate",
    fragile: true,
    kinds: ["wood", "metal"],
  });

  // Light entity with a light component.
  const light = document.entities.find((entity) => entity.id === lightEntityId(0));
  assert.equal(light ? readLightComponent(light)?.type : undefined, "directional");

  // Transform hierarchy: the character's parentId resolves to the crate entity.
  const child = document.entities.find((entity) => entity.id === characterEntityId(0));
  assert.equal(child?.parentId, instanceEntityId("crate", 0));
});

// 6.3 The legacy adapter derives that scene model from the current SAVED layout:
// the real render-test-room layout yields readable mesh and light entities.
// (`doc` was derived from public/layouts/render-test-room.json above.)
check("saved layout derives mesh + light entities with readable components", () => {
  const meshEntities = doc.entities.filter((entity) => readMeshRendererComponent(entity));
  const lightEntities = doc.entities.filter((entity) => readLightComponent(entity));
  assert.ok(meshEntities.length > 0, "at least one mesh entity from the saved layout");
  assert.ok(lightEntities.length > 0, "at least one light entity from the saved layout");
  for (const entity of meshEntities) {
    assert.ok(readTransformComponent(entity), `transform present for ${entity.id}`);
  }
});

// 6.4 Readiness demo (§5): the saved layout carries the scripted entity the
// Game Mode demo relies on — a character with the input-driven behavior whose
// transform the behavior layer mutates from input actions.
check("saved layout carries the input-driven demo character behavior", () => {
  const behaviored = doc.entities
    .map((entity) => readBehaviorComponent(entity))
    .filter((behavior) => behavior !== undefined);
  assert.ok(
    behaviored.some((behavior) => behavior?.scriptId === "input-move"),
    "expected a character with the input-move behavior in the saved layout",
  );
});

console.log(`[engine-tests] ${checks} checks passed`);
