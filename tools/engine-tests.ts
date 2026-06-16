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
  readAudioComponent,
  readBehaviorComponent,
  readColliderComponent,
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
import { PhysicsSubsystem } from "../engine/physics/physicsSubsystem";
import { AudioSubsystem } from "../engine/audio/audioSubsystem";
import { DEFAULT_AUDIO_CLIP_MANIFEST, audioClipById } from "../engine/assets/audio";
import { KeyboardInputSource } from "../src/input/keyboardInputSource";
import { facingYawFromMove, planarMoveStep } from "../src/game/playerMovement";
import { createBehaviorRegistry } from "../src/game/behaviors";
import type { TransformComponent } from "../engine/scene/components";
import {
  desiredFollowPose,
  lerpVec3,
  smoothingFactor,
  stepFollowCamera,
  type FollowCameraConfig,
} from "../src/game/followCamera";
import type { Entity } from "../engine/scene/entity";
import { selectionId, type Selection } from "../editor/core/selection";
import { EditorSceneController } from "../editor/scene/EditorSceneController";
import {
  axisYMoveDragPosition,
  freeMoveDragPosition,
  localAxisMoveDragPosition,
  planeMoveDragPosition,
  rotateDragRotation,
  scaleDragScale,
  worldAxisMoveDragPosition,
} from "../editor/gizmos/transformDrag";
import type { GizmoPointerDrag } from "../editor/gizmos/interaction";
import { computeWallSnap } from "../editor/render-three/wallSnap";
import { pivotCorrectedPosition } from "../editor/render-three/transformMatrices";
import {
  applySceneBackgroundAndAmbient,
  computeSceneRoomBounds,
  DEFAULT_SCENE_AMBIENT_COLOR,
  DEFAULT_SCENE_AMBIENT_INTENSITY,
  DEFAULT_SCENE_BACKGROUND_COLOR,
  DEFAULT_SCENE_LIGHT_COLOR,
  DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS,
  DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS,
  DEFAULT_SCENE_SUN_ID,
  ensureDefaultSceneLights,
  fitDirectionalShadowToBounds,
  resolveSceneWorldSettings,
  buildSceneEntities,
  computeModelLocalBounds,
  createSceneCharacterMixer,
  isSceneSunLight,
  startSceneRuntime,
  tagSceneLightRecordIndex,
} from "../src/scene/SceneRuntimeCore";
import type { SceneDocument } from "../engine/scene/sceneDocument";
import {
  validateLayout,
  validateLightActor,
  validatePlacement,
} from "./saveValidator";
import type { LayoutCharacter, LayoutLightActor, RoomLayout } from "../engine/scene/layout";
import type { LightObjectRecord } from "../engine/render-three/lights";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  AmbientLight,
  AnimationClip,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  Object3D,
  Scene,
  Vector3,
} from "three";
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

check("scene runtime world settings resolve defaults and layout overrides", () => {
  assert.deepEqual(resolveSceneWorldSettings(null), {
    staticObjectsCastShadow: DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS,
    staticObjectsReceiveShadow: DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS,
    backgroundColor: DEFAULT_SCENE_BACKGROUND_COLOR,
    ambientColor: DEFAULT_SCENE_AMBIENT_COLOR,
    ambientIntensity: DEFAULT_SCENE_AMBIENT_INTENSITY,
  });

  assert.deepEqual(
    resolveSceneWorldSettings({
      schema: 1,
      name: "world-settings-fixture",
      loadGroups: [],
      instances: [],
      characters: [],
      worldSettings: {
        staticObjectsCastShadow: true,
        staticObjectsReceiveShadow: false,
        backgroundColor: "#101010",
        ambientColor: "#202020",
        ambientIntensity: 0.4,
      },
    }),
    {
      staticObjectsCastShadow: true,
      staticObjectsReceiveShadow: false,
      backgroundColor: "#101010",
      ambientColor: "#202020",
      ambientIntensity: 0.4,
    },
  );
});

check("scene runtime inserts one default sun when a layout has no lights", () => {
  const emptyLightLayout: RoomLayout = {
    schema: 1,
    name: "default-light-fixture",
    loadGroups: [],
    instances: [],
    characters: [],
  };

  ensureDefaultSceneLights(emptyLightLayout);
  ensureDefaultSceneLights(emptyLightLayout);

  assert.equal(emptyLightLayout.lights?.length, 1);
  assert.equal(emptyLightLayout.lights?.[0]?.id, DEFAULT_SCENE_SUN_ID);
  assert.equal(emptyLightLayout.lights?.[0]?.type, "directional");
  assert.equal(emptyLightLayout.lights?.[0]?.color, DEFAULT_SCENE_LIGHT_COLOR);
});

check("scene runtime room bounds unions placements and honors asset filters", () => {
  const boundsLayout: RoomLayout = {
    schema: 1,
    name: "room-bounds-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "room",
        placements: [{ position: [1, 0, 0] }, { position: [0, 0, 2] }],
      },
      {
        assetId: "prop",
        placements: [{ position: [100, 0, 0] }],
      },
    ],
    characters: [],
  };
  const localBounds = new Map([
    ["room", new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1))],
    ["prop", new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1))],
  ]);

  const roomBounds = computeSceneRoomBounds(boundsLayout, localBounds, {
    includeAsset: (assetId) => assetId === "room",
  });

  assert.deepEqual(roomBounds?.min.toArray(), [0, 0, 0]);
  assert.deepEqual(roomBounds?.max.toArray(), [2, 1, 3]);
});

check("scene runtime fits directional shadows from room bounds", () => {
  const sun = new DirectionalLight();
  fitDirectionalShadowToBounds(
    sun,
    new Box3(new Vector3(-5, 0, -2), new Vector3(5, 4, 2)),
  );

  assert.equal(sun.shadow.camera.left, -7);
  assert.equal(sun.shadow.camera.right, 7);
  assert.equal(sun.shadow.camera.top, 7);
  assert.equal(sun.shadow.camera.bottom, -7);
  assert.equal(sun.shadow.camera.far, 34);
});

check("scene runtime applies background and ambient light lifecycle", () => {
  const scene = new Scene();
  let ambient = applySceneBackgroundAndAmbient({
    scene,
    ambientLight: null,
    settings: {
      backgroundColor: "#111111",
      ambientColor: "#222222",
      ambientIntensity: 0.5,
    },
    ambientName: "test-ambient",
  });

  assert.ok(ambient instanceof AmbientLight);
  assert.equal(ambient.name, "test-ambient");
  assert.equal((scene.background as Color).getHexString(), "111111");
  assert.equal(ambient.color.getHexString(), "222222");
  assert.equal(ambient.intensity, 0.5);
  assert.equal(scene.children.includes(ambient), true);

  ambient = applySceneBackgroundAndAmbient({
    scene,
    ambientLight: ambient,
    settings: {
      backgroundColor: "#333333",
      ambientColor: "#444444",
      ambientIntensity: 0,
    },
  });

  assert.equal(ambient, null);
  assert.equal((scene.background as Color).getHexString(), "333333");
  assert.equal(scene.children.length, 0);
});

check("scene runtime creates a character mixer only for a matching clip", () => {
  const character = new Object3D();
  const gltf = { animations: [new AnimationClip("Idle", 1, [])] } as unknown as GLTF;

  assert.ok(createSceneCharacterMixer(character, gltf, "Idle"));
  assert.equal(createSceneCharacterMixer(character, gltf, "Missing"), null);
  assert.equal(createSceneCharacterMixer(character, gltf, undefined), null);
});

check("scene runtime tags a light record root and descendants with its index", () => {
  const root = new Object3D();
  const child = new Object3D();
  root.add(child);
  const record = { root } as LightObjectRecord;

  tagSceneLightRecordIndex(record, 4);

  assert.equal(root.userData.lightIndex, 4);
  assert.equal(child.userData.lightIndex, 4);
});

check("scene runtime sun election prefers empty slot then the canonical sun id", () => {
  const existingSun = new DirectionalLight();
  const directional = (id: string): LayoutLightActor =>
    ({ id, type: "directional", position: [0, 0, 0] }) as LayoutLightActor;

  assert.equal(isSceneSunLight(directional("any"), null), true);
  assert.equal(isSceneSunLight(directional(DEFAULT_SCENE_SUN_ID), existingSun), true);
  assert.equal(isSceneSunLight(directional("other"), existingSun), false);
  assert.equal(
    isSceneSunLight({ id: DEFAULT_SCENE_SUN_ID, type: "point", position: [0, 0, 0] } as LayoutLightActor, null),
    false,
  );
});

check("scene runtime computes local model bounds keyed by asset id", () => {
  const gltf = { scene: new Mesh(new BoxGeometry(2, 2, 2)) } as unknown as GLTF;
  const bounds = computeModelLocalBounds(new Map([["box", gltf]]));

  assert.deepEqual(bounds.get("box")?.min.toArray(), [-1, -1, -1]);
  assert.deepEqual(bounds.get("box")?.max.toArray(), [1, 1, 1]);
});

check("scene runtime builds entities in instance -> character -> light order", () => {
  const recorded: string[] = [];
  const buildLayout: RoomLayout = {
    schema: 1,
    name: "build-order-fixture",
    loadGroups: [],
    instances: [
      { assetId: "a", placements: [{ position: [0, 0, 0] }] },
      { assetId: "b", placements: [] },
    ],
    characters: [{ assetId: "hero", position: [0, 0, 0] }],
    lights: [{ id: "sun", type: "directional", position: [0, 0, 0] }],
  };

  buildSceneEntities(buildLayout, {
    addInstance: (assetId, placements) =>
      recorded.push(`instance:${assetId}:${placements.length}`),
    addCharacter: (assetId) => recorded.push(`character:${assetId}`),
    addLight: (light) => recorded.push(`light:${light.id}`),
  });

  assert.deepEqual(recorded, [
    "instance:a:1",
    "instance:b:0",
    "character:hero",
    "light:sun",
  ]);

  const noLights: string[] = [];
  buildSceneEntities(
    { schema: 1, name: "no-lights", loadGroups: [], instances: [], characters: [] },
    {
      addInstance: () => noLights.push("instance"),
      addCharacter: () => noLights.push("character"),
      addLight: () => noLights.push("light"),
    },
  );
  assert.deepEqual(noLights, []);
});

await checkAsync("scene runtime startup feeds entities to both sinks, then inits, then starts", async () => {
  const order: string[] = [];
  const sceneDocument: SceneDocument = { schema: 1, name: "startup-fixture", entities: [] };
  const sink = (label: string) => ({
    setEntities: (entities: readonly unknown[]) => {
      order.push(`${label}:${entities === sceneDocument.entities}`);
    },
  });

  await startSceneRuntime({
    sceneDocument,
    physics: sink("physics"),
    behavior: sink("behavior"),
    engineApp: {
      init: async () => {
        order.push("init");
      },
      start: async () => {
        order.push("start");
      },
    },
  });

  assert.deepEqual(order, ["physics:true", "behavior:true", "init", "start"]);
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

// 6.1.3b Legacy collision flags now derive Collider components. Missing
// `collision` keeps the legacy default-on behavior; explicit false suppresses
// the collider so old layouts can opt out without changing schema.
check("layout collision flags map to readable collider components", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "collider-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "crate",
        placements: [
          { position: [0, 0, 0], collision: true },
          { position: [1, 0, 0] },
          { position: [2, 0, 0], collision: false },
        ],
      },
    ],
    characters: [
      { assetId: "hero", position: [0, 0, 1] },
      { assetId: "ghost", position: [0, 0, 2], collision: false },
    ],
    lights: [],
  };

  const document = roomLayoutToSceneDocument(fixture);
  const explicit = document.entities.find((entity) => entity.id === instanceEntityId("crate", 0));
  const defaulted = document.entities.find((entity) => entity.id === instanceEntityId("crate", 1));
  const disabled = document.entities.find((entity) => entity.id === instanceEntityId("crate", 2));
  const characterDefault = document.entities.find((entity) => entity.id === characterEntityId(0));
  const characterDisabled = document.entities.find((entity) => entity.id === characterEntityId(1));

  assert.deepEqual(explicit ? readColliderComponent(explicit) : undefined, {
    shape: "box",
    size: [1, 1, 1],
    isStatic: true,
    isSensor: false,
  });
  assert.deepEqual(defaulted ? readColliderComponent(defaulted) : undefined, {
    shape: "box",
    size: [1, 1, 1],
    isStatic: true,
    isSensor: false,
  });
  assert.equal(disabled ? readColliderComponent(disabled) : undefined, undefined);
  assert.deepEqual(characterDefault ? readColliderComponent(characterDefault) : undefined, {
    shape: "box",
    size: [1, 1, 1],
    isStatic: false,
    isSensor: false,
  });
  assert.equal(
    characterDisabled ? readColliderComponent(characterDisabled) : undefined,
    undefined,
  );
});

check("layout audio maps to a readable audio component", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "audio-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "speaker",
        placements: [
          {
            position: [0, 0, 0],
            audio: { clipId: "collision-chime", volume: 0.4, loop: false, spatial: true },
          },
        ],
      },
    ],
    characters: [],
    lights: [],
  };

  const entity = roomLayoutToSceneDocument(fixture).entities.find(
    (candidate) => candidate.id === instanceEntityId("speaker", 0),
  );
  assert.deepEqual(entity ? readAudioComponent(entity) : undefined, {
    clipId: "collision-chime",
    volume: 0.4,
    loop: false,
    spatial: true,
  });
});

check("audio clip manifest resolves default collision chime", () => {
  assert.deepEqual(audioClipById(DEFAULT_AUDIO_CLIP_MANIFEST, "collision-chime"), {
    id: "collision-chime",
    type: "tone",
    frequencyHz: 660,
    durationSeconds: 0.09,
  });
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

check("physics subsystem reports deterministic placeholder contacts", () => {
  const physics = new PhysicsSubsystem();
  physics.setEntities([
    {
      id: "dynamic",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
      },
    },
    {
      id: "wall",
      components: {
        Transform: { position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: false },
      },
    },
  ]);

  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.update(0.016);
  assert.deepEqual(physics.contactsForEntity("dynamic"), []);

  physics.setEntityTransform("dynamic", {
    position: [3.25, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  app.update(0.016);
  assert.deepEqual(physics.contactsForEntity("dynamic"), [
    { a: "dynamic", b: "wall", isSensor: false },
  ]);
});

await checkAsync("rapier physics backend reports contacts through the same contract", async () => {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setEntities([
    {
      id: "dynamic",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
      },
    },
    {
      id: "wall",
      components: {
        Transform: { position: [0.25, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: false },
      },
    },
  ]);

  const app = new EngineApp();
  app.registerSubsystem(physics);
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0] ?? "").includes("deprecated parameters for the initialization function")) {
      return;
    }
    warn(...args);
  };
  try {
    await app.init();
    assert.equal(physics.usesRapier(), true); // colliders present -> Rapier loaded
    app.update(0.016);
    assert.deepEqual(physics.contactsForEntity("dynamic"), [
      { a: "dynamic", b: "wall", isSensor: false },
    ]);
    await app.dispose();
  } finally {
    console.warn = warn;
  }
});

// 6.1.6b The rapier backend is a preference, not an unconditional load. A scene
// with no colliders must NOT pull the heavy Rapier runtime: the subsystem stays
// on the placeholder path so a physics-free game never fetches vendor-physics.
await checkAsync("rapier backend stays on placeholder when the scene has no colliders", async () => {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  // Transforms but no Collider components -> zero physics bodies.
  physics.setEntities([
    {
      id: "decor",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
  ]);

  const app = new EngineApp();
  app.registerSubsystem(physics);
  await app.init();
  assert.equal(physics.usesRapier(), false); // no colliders -> Rapier never loaded
  app.update(0.016);
  assert.deepEqual(physics.contactsForEntity("decor"), []);
  await app.dispose();
});

check("behavior can react to physics contacts from the engine tick", () => {
  const physics = new PhysicsSubsystem();
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId !== "contact-react") return undefined;
      return ({ physics: physicsQuery, transform }) => {
        if ((physicsQuery?.contactsForEntity("mover").length ?? 0) > 0) {
          transform.position[2] = 7;
        }
      };
    },
  };
  const synced: Array<{ id: string; z: number }> = [];
  const behavior = new BehaviorSubsystem(
    registry,
    new ActionMap({}),
    (id, transform) => synced.push({ id, z: transform.position[2] }),
    physics,
  );
  const entities: Entity[] = [
    {
      id: "mover",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
        Behavior: { scriptId: "contact-react" },
      },
    },
    {
      id: "sensor",
      components: {
        Transform: { position: [0.25, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      },
    },
  ];

  physics.setEntities(entities);
  behavior.setEntities(entities);

  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.registerSubsystem(behavior);
  app.update(0.016);

  assert.deepEqual(physics.contactsForEntity("mover"), [
    { a: "mover", b: "sensor", isSensor: true },
  ]);
  assert.deepEqual(synced.at(-1), { id: "mover", z: 7 });
});

check("audio subsystem records one-shot requests from a collision behavior", () => {
  const physics = new PhysicsSubsystem();
  const audio = new AudioSubsystem();
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId !== "contact-audio") return undefined;
      return ({ audio: audioBus, audioComponent, entityId, physics: physicsQuery }) => {
        if (!audioBus || !audioComponent) return;
        if ((physicsQuery?.contactsForEntity(entityId).length ?? 0) === 0) return;
        audioBus.playOneShot(audioComponent.clipId, {
          volume: audioComponent.volume,
          loop: audioComponent.loop,
          spatial: audioComponent.spatial,
        });
      };
    },
  };
  const behavior = new BehaviorSubsystem(
    registry,
    new ActionMap({}),
    () => undefined,
    physics,
    audio,
  );
  const entities: Entity[] = [
    {
      id: "mover",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
        Behavior: { scriptId: "contact-audio" },
        Audio: { clipId: "collision-chime", volume: 0.5, loop: false, spatial: false },
      },
    },
    {
      id: "wall",
      components: {
        Transform: { position: [0.25, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: false },
      },
    },
  ];

  physics.setEntities(entities);
  behavior.setEntities(entities);

  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.registerSubsystem(behavior);
  app.registerSubsystem(audio);
  app.update(0.016);

  assert.deepEqual(audio.playedRequests(), [
    { clipId: "collision-chime", volume: 0.5, loop: false, spatial: false },
  ]);
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

check("saved layout carries the collision audio demo cue", () => {
  const audioComponents = doc.entities
    .map((entity) => readAudioComponent(entity))
    .filter((audio) => audio !== undefined);
  assert.ok(
    audioComponents.some((audio) => audio?.clipId === "collision-chime"),
    "expected a collision-chime audio cue in the saved layout",
  );
});

// ===========================================================================
// Section 7 - EditorSceneController state (headless, extracted from SceneApp)
// ===========================================================================

type HeadlessTransform = {
  groupId?: string;
  nodeId?: string;
  parentId?: string;
};

check("EditorSceneController owns selection and command history state", () => {
  const primary = { kind: "instance" as const, assetId: "desk", placementIndex: 0 };
  const grouped = { kind: "character" as const, index: 1 };
  const invalid = { kind: "light" as const, index: 99 };
  const transforms = new Map<string, HeadlessTransform>([
    [selectionId(primary), {}],
    [selectionId(grouped), {}],
  ]);
  const events = {
    history: 0,
    selection: 0,
    gizmo: 0,
    boxes: 0,
    statuses: [] as string[],
  };
  const controller = new EditorSceneController({
    applyGroupId: (selection, groupId) => {
      const transform = transforms.get(selectionId(selection));
      if (!transform) return;
      if (groupId) transform.groupId = groupId;
      else delete transform.groupId;
    },
    descendantsOf: () => [],
    emitHistoryChanged: () => {
      events.history += 1;
    },
    emitSelectionChanged: () => {
      events.selection += 1;
    },
    getAllSelections: () => [primary, grouped],
    getGroupedSelections: (selection) =>
      selectionId(selection) === selectionId(primary) ? [primary, grouped] : [selection],
    getMutableTransform: (selection) => transforms.get(selectionId(selection)) ?? null,
    getSelectionLabel: (selection) => selectionId(selection),
    hasSelection: (selection) => selectionId(selection) !== selectionId(invalid),
    onStatus: (message) => {
      events.statuses.push(message);
    },
    updateGizmo: () => {
      events.gizmo += 1;
    },
    updateSelectionBox: () => {
      events.boxes += 1;
    },
  });

  controller.select(primary);
  assert.deepEqual(controller.selection, primary);
  assert.equal(controller.selectedCount, 2);
  assert.equal(controller.isSelectionSelected(grouped), true);
  assert.deepEqual(controller.getSelectedSelections().map(selectionId).sort(), [
    selectionId(grouped),
    selectionId(primary),
  ]);
  assert.equal(events.selection, 1);
  assert.equal(events.gizmo, 1);
  assert.equal(events.boxes, 1);

  controller.selectMany([primary, invalid], primary);
  assert.deepEqual(controller.getSelectedSelections(), [primary]);

  let value = 0;
  controller.executeCommand({
    label: "Set value",
    redo: () => {
      value = 1;
    },
    undo: () => {
      value = 0;
    },
  });
  assert.equal(value, 1);
  assert.equal(controller.getHistoryState().canUndo, true);
  controller.undo();
  assert.equal(value, 0);
  assert.equal(controller.getHistoryState().canRedo, true);
  controller.redo();
  assert.equal(value, 1);
  assert.deepEqual(events.statuses, ["Set value", "Undo: Set value", "Redo: Set value"]);
  assert.equal(events.history, 3);
});

check("EditorSceneController groups and parents through undoable host mutations", () => {
  const parent = { kind: "instance" as const, assetId: "desk", placementIndex: 0 };
  const child = { kind: "character" as const, index: 1 };
  const other = { kind: "light" as const, index: 2 };
  const allSelections: Selection[] = [parent, child, other];
  const transforms = new Map<string, HeadlessTransform>([
    [selectionId(parent), {}],
    [selectionId(child), {}],
    [selectionId(other), {}],
  ]);
  const statuses: string[] = [];
  const controller = new EditorSceneController({
    applyGroupId: (selection, groupId) => {
      const transform = transforms.get(selectionId(selection));
      if (!transform) return;
      if (groupId) transform.groupId = groupId;
      else delete transform.groupId;
    },
    descendantsOf: (selection) => (selectionId(selection) === selectionId(parent) ? [child] : []),
    emitHistoryChanged: () => {},
    emitSelectionChanged: () => {},
    getAllSelections: () => allSelections,
    getGroupedSelections: (selection) => [selection],
    getMutableTransform: (selection) => transforms.get(selectionId(selection)) ?? null,
    getSelectionLabel: (selection) => selectionId(selection),
    hasSelection: (selection) => transforms.has(selectionId(selection)),
    onStatus: (message) => {
      statuses.push(message);
    },
    updateGizmo: () => {},
    updateSelectionBox: () => {},
  });

  controller.selectMany([parent, child], parent);
  controller.groupSelected();
  const groupId = transforms.get(selectionId(parent))?.groupId;
  assert.ok(groupId, "group command assigns a group id");
  assert.equal(transforms.get(selectionId(child))?.groupId, groupId);
  controller.undo();
  assert.equal(transforms.get(selectionId(parent))?.groupId, undefined);
  assert.equal(transforms.get(selectionId(child))?.groupId, undefined);
  controller.redo();
  assert.equal(transforms.get(selectionId(child))?.groupId, groupId);

  controller.ungroupSelected();
  assert.equal(transforms.get(selectionId(parent))?.groupId, undefined);
  assert.equal(transforms.get(selectionId(child))?.groupId, undefined);
  controller.undo();
  assert.equal(transforms.get(selectionId(parent))?.groupId, groupId);
  assert.equal(transforms.get(selectionId(child))?.groupId, groupId);

  controller.selectMany([parent, child], parent);
  controller.parentSelectionToActive();
  const parentNodeId = transforms.get(selectionId(parent))?.nodeId;
  assert.ok(parentNodeId, "parent command assigns a node id");
  assert.equal(transforms.get(selectionId(child))?.parentId, parentNodeId);
  controller.undo();
  assert.equal(transforms.get(selectionId(child))?.parentId, undefined);
  controller.redo();
  assert.equal(transforms.get(selectionId(child))?.parentId, parentNodeId);

  controller.unparentSelected();
  assert.equal(transforms.get(selectionId(child))?.parentId, undefined);
  controller.undo();
  assert.equal(transforms.get(selectionId(child))?.parentId, parentNodeId);

  transforms.get(selectionId(child))!.nodeId = "child-node";
  controller.parentObjectsTo([selectionId(parent)], selectionId(child));
  assert.notEqual(
    transforms.get(selectionId(parent))?.parentId,
    "child-node",
    "cycle guard skips parenting a parent under its child",
  );
  assert.ok(statuses.includes("Group 2 objects"));
  assert.ok(statuses.includes("Parent 1 to instance:desk:0"));
});

check("EditorSceneController duplicates and deletes layout objects through host mutations", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "controller-layout",
    loadGroups: [],
    instances: [
      {
        assetId: "chair",
        placements: [{ position: [0, 0, 0], groupId: "g1", nodeId: "n1" }],
      },
    ],
    characters: [{ assetId: "npc", position: [1, 0, 0], groupId: "g1" }],
    lights: [{ id: "lamp", type: "point", position: [0, 2, 0], groupId: "g1" }],
  };
  const allSelections = (): Selection[] => [
    ...layout.instances.flatMap((instance) =>
      instance.placements.map((_placement, placementIndex) => ({
        kind: "instance" as const,
        assetId: instance.assetId,
        placementIndex,
      })),
    ),
    ...layout.characters.map((_character, index) => ({ kind: "character" as const, index })),
    ...(layout.lights ?? []).map((_light, index) => ({ kind: "light" as const, index })),
  ];
  const mutableTransform = (selection: Selection): HeadlessTransform | null => {
    if (selection.kind === "instance") {
      return (
        layout.instances.find((instance) => instance.assetId === selection.assetId)?.placements[
          selection.placementIndex
        ] ?? null
      );
    }
    if (selection.kind === "character") return layout.characters[selection.index] ?? null;
    return layout.lights?.[selection.index] ?? null;
  };
  const controller = new EditorSceneController({
    applyGroupId: (selection, groupId) => {
      const transform = mutableTransform(selection);
      if (!transform) return;
      if (groupId) transform.groupId = groupId;
      else delete transform.groupId;
    },
    descendantsOf: () => [],
    emitHistoryChanged: () => {},
    emitSelectionChanged: () => {},
    getAllSelections: allSelections,
    getGroupedSelections: (selection) => [selection],
    getMutableLayout: () => layout,
    getMutableTransform: mutableTransform,
    getSelectionLabel: (selection) => selectionId(selection),
    hasSelection: (selection) => mutableTransform(selection) !== null,
    createLightId: (type) => `${type}-copy`,
    insertCharacterPlacement: (index, placement) => {
      layout.characters.splice(index, 0, { ...placement });
    },
    insertInstancePlacement: (assetId, placementIndex, placement) => {
      const instance = layout.instances.find((entry) => entry.assetId === assetId);
      assert.ok(instance, `missing instance bucket ${assetId}`);
      instance.placements.splice(placementIndex, 0, { ...placement });
    },
    insertLightActor: (index, actor) => {
      layout.lights ??= [];
      layout.lights.splice(index, 0, { ...actor });
    },
    onStatus: () => {},
    removeCharacterPlacement: (index) => layout.characters.splice(index, 1)[0] ?? null,
    removeInstancePlacement: (assetId, placementIndex) => {
      const instance = layout.instances.find((entry) => entry.assetId === assetId);
      return instance?.placements.splice(placementIndex, 1)[0] ?? null;
    },
    removeLightActor: (index) => layout.lights?.splice(index, 1)[0] ?? null,
    updateGizmo: () => {},
    updateSelectionBox: () => {},
  });

  controller.selectMany(allSelections(), allSelections()[0] ?? null);
  controller.duplicateSelected();
  assert.equal(layout.instances[0]?.placements.length, 2);
  assert.equal(layout.characters.length, 2);
  assert.equal(layout.lights?.length, 2);
  assert.equal(layout.instances[0]?.placements[1]?.groupId, undefined);
  assert.equal(layout.instances[0]?.placements[1]?.nodeId, "n1");
  controller.undo();
  assert.equal(layout.instances[0]?.placements.length, 1);
  assert.equal(layout.characters.length, 1);
  assert.equal(layout.lights?.length, 1);

  controller.selectMany(allSelections(), allSelections()[0] ?? null);
  controller.deleteSelected();
  assert.equal(layout.instances[0]?.placements.length, 0);
  assert.equal(layout.characters.length, 0);
  assert.equal(layout.lights?.length, 0);
  controller.undo();
  assert.equal(layout.instances[0]?.placements.length, 1);
  assert.equal(layout.characters.length, 1);
  assert.equal(layout.lights?.length, 1);
});

check("EditorSceneController applies flags, default-true fields, and metadata with undo", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "controller-flags",
    loadGroups: [],
    instances: [{ assetId: "crate", placements: [{ position: [0, 0, 0] }] }],
    characters: [{ assetId: "npc", position: [1, 0, 0] }],
  };
  const instanceSelection: Selection = { kind: "instance", assetId: "crate", placementIndex: 0 };
  const characterSelection: Selection = { kind: "character", index: 0 };
  const mutableTransform = (selection: Selection): HeadlessTransform | null => {
    if (selection.kind === "instance") {
      return layout.instances[0]?.placements[selection.placementIndex] ?? null;
    }
    if (selection.kind === "character") return layout.characters[selection.index] ?? null;
    return null;
  };
  const events = { visibility: 0, castShadow: 0 };
  const controller = new EditorSceneController({
    applyCastShadow: () => {
      events.castShadow += 1;
    },
    applyGroupId: () => {},
    applyVisibility: () => {
      events.visibility += 1;
    },
    descendantsOf: () => [],
    emitHistoryChanged: () => {},
    emitSelectionChanged: () => {},
    getAllSelections: () => [instanceSelection, characterSelection],
    getGroupedSelections: (selection) => [selection],
    getMutableLayout: () => layout,
    getMutableTransform: mutableTransform,
    getSelectionLabel: (selection) => selectionId(selection),
    hasSelection: (selection) => mutableTransform(selection) !== null,
    createLightId: (type) => `${type}-copy`,
    insertCharacterPlacement: () => {},
    insertInstancePlacement: () => {},
    insertLightActor: () => {},
    onStatus: () => {},
    removeCharacterPlacement: () => null,
    removeInstancePlacement: () => null,
    removeLightActor: () => null,
    updateGizmo: () => {},
    updateSelectionBox: () => {},
  });

  controller.select(instanceSelection);
  controller.setSelectionFlag(instanceSelection, "hidden", true);
  assert.equal(layout.instances[0]?.placements[0]?.hidden, true);
  assert.equal(events.visibility, 1);
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.hidden, undefined);
  assert.equal(events.visibility, 2);

  controller.setSelectionMetadata("hp", 5);
  assert.deepEqual(layout.instances[0]?.placements[0]?.metadata, { hp: 5 });
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.metadata, undefined);

  controller.select(characterSelection);
  controller.setSelectionCastShadow(false);
  assert.equal(layout.characters[0]?.castShadow, false);
  assert.equal(events.castShadow, 1);
  controller.undo();
  assert.equal(layout.characters[0]?.castShadow, undefined);
  assert.equal(events.castShadow, 2);
});

// ===========================================================================
// Section 8 - Gizmo transform-drag math (pure, extracted from SceneApp)
// ===========================================================================
// These functions have no DOM/WebGL dependency, so they pin the viewport drag
// arithmetic the editor relies on — coverage the engine tests could not reach
// while it lived inline in SceneApp.

type MoveDragFixture = Extract<GizmoPointerDrag, { mode: "move" }>;
const snapOff = {
  move: 1,
  moveEnabled: false,
  rotate: 15,
  rotateEnabled: false,
  scale: 0.1,
  scaleEnabled: false,
};
const moveDragBase: MoveDragFixture = {
  mode: "move",
  axis: "x",
  selection: { kind: "instance", assetId: "a", placementIndex: 0 },
  offset: new Vector3(),
  pointerId: 1,
  startTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  startPosition: [0, 0, 0],
  startClientX: 0,
  startClientY: 0,
};

check("free move drag offsets the start position along the camera basis", () => {
  const drag: MoveDragFixture = {
    ...moveDragBase,
    axis: "xyz",
    freeMoveRight: new Vector3(1, 0, 0),
    freeMoveUp: new Vector3(0, 1, 0),
  };
  // +50px right, -30px screen-up (screen Y is inverted) -> +0.5 x, +0.3 y.
  assert.deepEqual(freeMoveDragPosition(drag, 50, -30, snapOff), [0.5, 0.3, 0]);
});

check("world axis move sets only the dragged axis from the floor hit + offset", () => {
  const drag: MoveDragFixture = { ...moveDragBase, axis: "x", offset: new Vector3(0.2, 0, 0) };
  assert.deepEqual(
    worldAxisMoveDragPosition([1, 2, 3], drag, new Vector3(5, 0, 7), snapOff),
    [5.2, 2, 3],
  );
});

check("vertical move drag changes height only, keeping base x/z", () => {
  const drag: MoveDragFixture = { ...moveDragBase, axis: "y", startPosition: [0, 2, 0] };
  assert.deepEqual(axisYMoveDragPosition([1, 2, 3], drag, -50, snapOff), [1, 2.5, 3]);
});

check("plane move drag applies the world delta from the plane hit", () => {
  const drag: MoveDragFixture = {
    ...moveDragBase,
    axis: "xy",
    planeStartHit: new Vector3(0, 0, 0),
  };
  assert.deepEqual(planeMoveDragPosition(drag, new Vector3(1.5, 0, -2), snapOff), [1.5, 0, -2]);
});

check("local axis move projects onto the object heading (90deg turns +x into -z)", () => {
  const drag: MoveDragFixture = {
    ...moveDragBase,
    axis: "x",
    startTransform: { position: [0, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] },
  };
  // Heading is 90deg, so the perpendicular world-x component of the hit is
  // ignored and the +x handle slides along world -z.
  assert.deepEqual(localAxisMoveDragPosition([0, 0, 0], drag, new Vector3(4, 0, -3), snapOff), [
    0, 0, -3,
  ]);
});

check("rotate drag turns the horizontal pointer delta into degrees (and snaps)", () => {
  const drag: GizmoPointerDrag = {
    mode: "rotate",
    axis: "y",
    selection: { kind: "instance", assetId: "a", placementIndex: 0 },
    pointerId: 1,
    startTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    startClientX: 0,
    startRotation: [0, 0, 0],
  };
  assert.deepEqual(rotateDragRotation(drag, 20, snapOff), [0, 10, 0]);
  assert.deepEqual(rotateDragRotation(drag, 20, { ...snapOff, rotateEnabled: true }), [0, 15, 0]);
});

check("scale drag handles uniform, single-axis, planar, and the 0.05 floor", () => {
  const drag: GizmoPointerDrag = {
    mode: "scale",
    axis: "uniform",
    selection: { kind: "instance", assetId: "a", placementIndex: 0 },
    pointerId: 1,
    startTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    startClientX: 0,
    startClientY: 0,
    startScale: [1, 1, 1],
  };
  assert.deepEqual(scaleDragScale(drag, 100, 0, snapOff), [1.5, 1.5, 1.5]);
  assert.deepEqual(scaleDragScale({ ...drag, axis: "x" }, 100, 0, snapOff), [1.5, 1, 1]);
  assert.deepEqual(scaleDragScale({ ...drag, axis: "xy" }, 100, 0, snapOff), [1.5, 1.5, 1]);
  // Large shrink clamps every axis to the 0.05 minimum.
  assert.deepEqual(scaleDragScale(drag, 0, 1000, snapOff), [0.05, 0.05, 0.05]);
});

// ===========================================================================
// Section 9 - Wall-snap geometry (pure, extracted from SceneApp)
// ===========================================================================

check("wall snap slides flush against the nearest wall and faces the interior", () => {
  // 10x10 room (y 0..3); a thin asset facing +Z near the +Z wall (max.z = 5).
  const room = new Box3(new Vector3(-5, 0, -5), new Vector3(5, 3, 5));
  const bounds = new Box3(new Vector3(-0.5, 0, -0.1), new Vector3(0.5, 2, 0.1));
  const snap = computeWallSnap(bounds, room, [0, 0, 4], 0, 1);
  // Nearest wall is +Z: turn to face -Z (180deg) and slide so the back is flush
  // (wall at z=5, half-depth 0.1 -> centre at 4.9).
  assert.equal(snap.rotationYDeg, 180);
  assert.deepEqual(snap.position, [0, 0, 4.9]);
});

check("pivot-corrected position keeps the pivot world point fixed", () => {
  // No rotation, unit scale, origin pivot -> the origin equals the pivot world.
  assert.deepEqual(pivotCorrectedPosition(new Vector3(1, 2, 3), [0, 0, 0], [1, 1, 1], [0, 0, 0]), [
    1, 2, 3,
  ]);
  // 90deg about Y turns local +x into world -z, so a [1,0,0] pivot shifts the
  // origin by +1 along z to keep the pivot world point (5,0,5) fixed.
  assert.deepEqual(pivotCorrectedPosition(new Vector3(5, 0, 5), [0, 90, 0], [1, 1, 1], [1, 0, 0]), [
    5, 0, 6,
  ]);
});

// ===========================================================================
// Section 10 - Save-payload validator (extracted from vite.config.ts)
// ===========================================================================
// The /__save-layout validator is an allowlist: anything not copied explicitly
// is dropped on save (documented footgun). These tests run the real validator
// against the saved layout + crafted inputs.

check("save validator round-trips the saved layout (idempotent, ids/counts stable)", () => {
  const once = validateLayout(layout) as RoomLayout;
  // The committed layout is already canonical, so validating is a no-op.
  assert.deepEqual(once, layout);
  // ...and validating the result again changes nothing (idempotent).
  assert.deepEqual(validateLayout(once), once);
  // Structure preserved: same instance/placement/character/light counts.
  assert.equal(once.instances.length, layout.instances.length);
  assert.equal(once.characters.length, layout.characters.length);
  assert.equal((once.lights ?? []).length, (layout.lights ?? []).length);
});

check("save validator allowlist keeps known placement fields, drops unknown ones", () => {
  const placement = validatePlacement({
    position: [1, 2, 3],
    name: "crate",
    collision: false,
    metadata: { hp: 5 },
    bogusField: 123,
    nested: { evil: true },
  });
  assert.deepEqual(placement.position, [1, 2, 3]);
  assert.equal(placement.name, "crate");
  assert.equal(placement.collision, false);
  assert.deepEqual(placement.metadata, { hp: 5 });
  // Fields not on the allowlist must be stripped (this is the save footgun).
  assert.equal("bogusField" in placement, false);
  assert.equal("nested" in placement, false);
});

check("save validator allowlist keeps known light fields, drops unknown ones", () => {
  const light = validateLightActor({
    id: "lamp",
    type: "point",
    position: [0, 1, 0],
    intensity: 2,
    distance: 8,
    bogusField: "x",
  });
  assert.equal(light.id, "lamp");
  assert.equal(light.type, "point");
  assert.deepEqual(light.position, [0, 1, 0]);
  assert.equal(light.intensity, 2);
  assert.equal(light.distance, 8);
  assert.equal("bogusField" in light, false);
});

// G1 player movement core (src/game/playerMovement.ts): planar input resolves to
// a normalized XZ delta plus a facing yaw, so diagonals are not ~1.41x faster and
// the character turns to face its movement, holding facing when idle. Yaw values
// are compared modulo 360 (so +/-180 match, and -0 reads as 0).
const yawApproxEqual = (actual: number, expected: number, eps = 1e-9): void => {
  const diff = ((((actual - expected) % 360) + 540) % 360) - 180;
  assert.ok(Math.abs(diff) <= eps, `yaw ${actual} not ~= ${expected} (mod 360)`);
};

check("planarMoveStep: a single axis moves at exactly speed*dt", () => {
  assert.deepEqual(
    planarMoveStep({ forward: true, back: false, left: false, right: false }, 4, 0.5),
    { dx: 0, dz: -2 },
  );
  assert.deepEqual(
    planarMoveStep({ forward: false, back: true, left: false, right: false }, 4, 0.5),
    { dx: 0, dz: 2 },
  );
  assert.deepEqual(
    planarMoveStep({ forward: false, back: false, left: true, right: false }, 4, 0.5),
    { dx: -2, dz: 0 },
  );
  assert.deepEqual(
    planarMoveStep({ forward: false, back: false, left: false, right: true }, 4, 0.5),
    { dx: 2, dz: 0 },
  );
});

check("planarMoveStep: diagonals are normalized to the straight-line speed", () => {
  const straight = planarMoveStep(
    { forward: true, back: false, left: false, right: false },
    3,
    0.5,
  );
  const diagonal = planarMoveStep(
    { forward: true, back: false, left: false, right: true },
    3,
    0.5,
  );
  const straightMag = Math.hypot(straight.dx, straight.dz);
  const diagonalMag = Math.hypot(diagonal.dx, diagonal.dz);
  assert.ok(Math.abs(diagonalMag - straightMag) <= 1e-12, "diagonal speed == straight");
  assert.ok(Math.abs(diagonalMag - 1.5) <= 1e-12, "magnitude == speed*dt");
  // Forward-right components: +x, -z, equal magnitudes.
  assert.ok(diagonal.dx > 0 && diagonal.dz < 0);
  assert.ok(Math.abs(Math.abs(diagonal.dx) - Math.abs(diagonal.dz)) <= 1e-12);
});

check("planarMoveStep: opposing keys cancel and idle/zero input yields no delta", () => {
  assert.deepEqual(
    planarMoveStep({ forward: true, back: true, left: true, right: true }, 5, 0.5),
    { dx: 0, dz: 0 },
  );
  assert.deepEqual(
    planarMoveStep({ forward: false, back: false, left: false, right: false }, 5, 0.5),
    { dx: 0, dz: 0 },
  );
  // A paused frame (dt 0) or a zero speed produces no motion.
  assert.deepEqual(
    planarMoveStep({ forward: true, back: false, left: false, right: false }, 5, 0),
    { dx: 0, dz: 0 },
  );
  assert.deepEqual(
    planarMoveStep({ forward: true, back: false, left: false, right: false }, 0, 0.5),
    { dx: 0, dz: 0 },
  );
});

check("facingYawFromMove: the character faces its cardinal movement direction", () => {
  yawApproxEqual(facingYawFromMove(0, -1) ?? NaN, 0); // forward (-z)
  yawApproxEqual(facingYawFromMove(0, 1) ?? NaN, 180); // back (+z)
  yawApproxEqual(facingYawFromMove(1, 0) ?? NaN, -90); // right (+x)
  yawApproxEqual(facingYawFromMove(-1, 0) ?? NaN, 90); // left (-x)
  yawApproxEqual(facingYawFromMove(1, -1) ?? NaN, -45); // forward-right
});

check("facingYawFromMove: no movement returns null so facing is held", () => {
  assert.equal(facingYawFromMove(0, 0), null);
});

check("input-move behavior: normalizes diagonal travel, faces it, holds facing idle", () => {
  const registry = createBehaviorRegistry();
  const actions = new ActionMap({
    KeyW: "move-forward",
    KeyS: "move-back",
    KeyA: "move-left",
    KeyD: "move-right",
  });
  let synced: TransformComponent | undefined;
  const subsystem = new BehaviorSubsystem(registry, actions, (_id, transform) => {
    synced = transform;
  });
  subsystem.setEntities([
    {
      id: "character:0",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Behavior: { scriptId: "input-move", params: { speed: 2 } },
      },
    },
  ]);

  // Tick 1: hold forward+right 0.5s -> diagonal travel == speed*dt (== 1), faces it.
  actions.handleDown("KeyW");
  actions.handleDown("KeyD");
  actions.advance();
  subsystem.update({ deltaSeconds: 0.5, elapsedSeconds: 0.5, frame: 1 });
  const moved = synced ?? assert.fail("transform synced");
  assert.ok(Math.abs(Math.hypot(moved.position[0], moved.position[2]) - 1) <= 1e-12);
  assert.ok(moved.position[0] > 0 && moved.position[2] < 0);
  yawApproxEqual(moved.rotation[1], -45);

  // Tick 2: no input -> position unchanged and facing held (not reset to 0).
  const xBefore = moved.position[0];
  const zBefore = moved.position[2];
  actions.handleUp("KeyW");
  actions.handleUp("KeyD");
  actions.advance();
  subsystem.update({ deltaSeconds: 0.5, elapsedSeconds: 1, frame: 2 });
  assert.equal(moved.position[0], xBefore);
  assert.equal(moved.position[2], zBefore);
  yawApproxEqual(moved.rotation[1], -45);
});

// G4 follow camera (src/game/followCamera.ts): a fixed-orientation third-person
// camera eases toward a pose offset from the player. Pure math the runtime shell
// applies each tick; the camera never rotates, so world-relative WASD reads as
// camera-relative.
const followConfig: FollowCameraConfig = { offset: [0, 1, 3], lookHeight: 0.5 };

check("desiredFollowPose: offsets the camera from the player and aims above it", () => {
  const pose = desiredFollowPose([2, 0, 4], followConfig);
  assert.deepEqual(pose.position, [2, 1, 7]);
  assert.deepEqual(pose.target, [2, 0.5, 4]);
});

check("smoothingFactor: framerate-independent easing in [0,1], zero when degenerate", () => {
  assert.equal(smoothingFactor(0, 0.016), 0);
  assert.equal(smoothingFactor(8, 0), 0);
  assert.equal(smoothingFactor(-1, 0.016), 0);
  const f = smoothingFactor(8, 0.5);
  assert.ok(Math.abs(f - (1 - Math.exp(-4))) <= 1e-12);
  assert.ok(f > 0 && f < 1);
});

check("lerpVec3: interpolates and clamps t to [0,1]", () => {
  assert.deepEqual(lerpVec3([0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]);
  assert.deepEqual(lerpVec3([1, 2, 3], [4, 5, 6], -1), [1, 2, 3]);
  assert.deepEqual(lerpVec3([1, 2, 3], [4, 5, 6], 2), [4, 5, 6]);
});

check("stepFollowCamera: snaps on first frame, then eases and converges", () => {
  // No previous pose -> snap to the desired pose (no easing in from the origin).
  const first = stepFollowCamera(null, [0, 0, 0], followConfig, 0.1);
  assert.deepEqual(first.position, [0, 1, 3]);
  assert.deepEqual(first.target, [0, 0.5, 0]);

  // With a previous pose -> ease halfway toward the new player's desired pose.
  const next = stepFollowCamera(first, [2, 0, 0], followConfig, 0.5);
  assert.deepEqual(next.position, [1, 1, 3]); // halfway [0,1,3] -> [2,1,3]
  assert.deepEqual(next.target, [1, 0.5, 0]); // halfway [0,0.5,0] -> [2,0.5,0]

  // Repeated easing converges on the desired pose.
  let pose = first;
  for (let i = 0; i < 200; i += 1) pose = stepFollowCamera(pose, [2, 0, 0], followConfig, 0.5);
  assert.ok(Math.abs(pose.position[0] - 2) <= 1e-9);
  assert.ok(Math.abs(pose.target[0] - 2) <= 1e-9);
});

console.log(`[engine-tests] ${checks} checks passed`);
