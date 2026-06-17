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
import { groundedAt, stepVerticalMotion } from "../src/game/verticalMotion";
import { resolvePlanarMovement, type Aabb3 } from "../src/game/collision";
import {
  classifyLocomotion,
  resolveLocomotionClip,
  selectLocomotionClip,
  type LocomotionInput,
} from "../src/game/locomotionAnimation";
import { CrossfadeAnimator } from "../engine/render-three/characterAnimator";
import {
  DEFAULT_GAME_MODE_ID,
  GAME_MODE_OPTIONS,
  isKnownGameModeId,
  normalizeGameModeId,
} from "../src/game/gameModes/catalog";
import { resolveGameMode } from "../src/game/gameModes/registry";
import { cameraPlanarPan } from "../src/game/gameModes/cameraControl";
import { defaultCameraGameMode } from "../src/game/gameModes/defaultCameraGameMode";
import { tpsCharacterGameMode } from "../src/game/gameModes/tpsCharacterGameMode";
import type {
  GameModeContext,
  RuntimeCharacterRef,
} from "../src/game/gameModes/types";
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
import { floorSnapPosition } from "../editor/render-three/floorSnap";
import { pivotCorrectedPosition } from "../editor/render-three/transformMatrices";
import {
  applySceneBackgroundAndAmbient,
  computeSceneRoomBounds,
  DEFAULT_SCENE_AMBIENT_COLOR,
  DEFAULT_SCENE_AMBIENT_INTENSITY,
  DEFAULT_SCENE_BACKGROUND_COLOR,
  DEFAULT_SCENE_GRAVITY,
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
  sceneModelAssetIds,
  startSceneRuntime,
  tagSceneLightRecordIndex,
} from "../src/scene/SceneRuntimeCore";
import type { SceneDocument } from "../engine/scene/sceneDocument";
import {
  validateAssetCollisionDef,
  validateLayout,
  validateLightActor,
  validatePlacement,
  validateSaveCollisionPayload,
} from "./saveValidator";
import type { LayoutCharacter, LayoutLightActor, RoomLayout } from "../engine/scene/layout";
import { colliderBoxFromBounds } from "../engine/render-three/transforms";
import { collisionWireboxes } from "../engine/render-three/collisionView";
import {
  COLLISION_CHANNELS,
  DEFAULT_COLLISION_COMPLEXITY,
  DEFAULT_COLLISION_PRESET,
  defaultAssetCollisionDef,
  resolveCollisionProfile,
  resolvePhysicalMaterial,
  type AssetCollisionDef,
} from "../engine/scene/collision";
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
  PerspectiveCamera,
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
    gravity: DEFAULT_SCENE_GRAVITY,
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
        gravity: [0, -20, 0],
      },
    }),
    {
      staticObjectsCastShadow: true,
      staticObjectsReceiveShadow: false,
      backgroundColor: "#101010",
      ambientColor: "#202020",
      ambientIntensity: 0.4,
      gravity: [0, -20, 0],
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

check("sceneModelAssetIds includes authored assets and excludes procedural shapes", () => {
  const modelLayout: RoomLayout = {
    schema: 1,
    name: "model-asset-fixture",
    loadGroups: ["core"],
    instances: [
      { assetId: "floor-full", placements: [{ position: [0, 0, 0] }] },
      { assetId: "bed-single", placements: [{ position: [1, 0, 0] }] },
      { assetId: "shape:cube", placements: [{ position: [2, 0, 0] }] },
    ],
    characters: [{ assetId: "character-a", position: [0, 0, 1] }],
    lights: [],
  };

  assert.deepEqual(sceneModelAssetIds(modelLayout).sort(), [
    "bed-single",
    "character-a",
    "floor-full",
  ]);
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

// colliderBoxFromBounds bakes placement scale into the world-aligned size; for
// an origin-centered model the center offset stays zero.
check("colliderBoxFromBounds bakes scale into a centered model's footprint", () => {
  const box = colliderBoxFromBounds(
    new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
    { position: [10, 0, 0], scale: [3, 1, 2] },
  );
  assert.deepEqual(box.size, [6, 2, 4]);
  assert.deepEqual(box.center, [0, 0, 0]);
});

// Rotation intentionally does not resize the collider footprint. A rotated wall
// keeps the same collision dimensions; an off-origin model still yields a center
// offset relative to its placement position.
check("colliderBoxFromBounds ignores rotation while preserving scale and offset", () => {
  const box = colliderBoxFromBounds(
    new Box3(new Vector3(-1, 0, -0.25), new Vector3(1, 2, 0.25)),
    { position: [5, 0, 0], rotationYDeg: 90 },
  );
  assert.deepEqual(box.size, [2, 2, 0.5]);
  // The box spans y [0,2] about position y=0, so its center sits 1 unit up.
  assert.deepEqual(box.center, [0, 1, 0]);
});

// The editor "Show > Collision" overlay derives one world box per collidable
// placement/character: `collision: false` opts out, the sensor flag carries
// through, and each box is the model's bounds under its placement transform.
check("collisionWireboxes: one box per collider, skips collision:false, flags sensors", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "collision-overlay-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "wall",
        placements: [
          { position: [0, 0, 0], scale: [2, 1, 1] },
          { position: [5, 0, 0], collision: false }, // opted out -> no box
        ],
      },
      { assetId: "zone", placements: [{ position: [0, 0, -3], sensor: true }] },
    ],
    characters: [{ assetId: "hero", position: [1, 0, 0] }],
    lights: [],
  };
  const unit = () => new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
  const localBounds = new Map([
    ["wall", unit()],
    ["zone", unit()],
    ["hero", unit()],
  ]);

  const boxes = collisionWireboxes(layout, localBounds);
  assert.equal(boxes.length, 3); // wall[0] + zone + hero; wall[1] opted out

  // wall[0]: unit bounds scaled x2 on X about origin -> x span [-1,1].
  const wall = boxes[0]!;
  assert.equal(wall.sensor, false);
  assert.deepEqual(wall.box.min.toArray(), [-1, -0.5, -0.5]);
  assert.deepEqual(wall.box.max.toArray(), [1, 0.5, 0.5]);

  // zone is a sensor centered at z=-3.
  const zone = boxes[1]!;
  assert.equal(zone.sensor, true);
  assert.deepEqual(zone.box.min.toArray(), [-0.5, -0.5, -3.5]);

  // hero (character) is collidable by default, centered at x=1.
  const hero = boxes[2]!;
  assert.equal(hero.sensor, false);
  assert.deepEqual(hero.box.min.toArray(), [0.5, -0.5, -0.5]);
});

check("collisionWireboxes ignore rotation and grow only with scale", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "collision-rotation-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "wall",
        placements: [
          { position: [0, 0, 0] },
          { position: [4, 0, 0], rotationYDeg: 45 },
          { position: [8, 0, 0], rotationYDeg: 45, scale: [2, 1, 3] },
        ],
      },
    ],
    characters: [],
    lights: [],
  };
  const wallBounds = new Box3(new Vector3(-1, 0, -0.1), new Vector3(1, 2, 0.1));
  const boxes = collisionWireboxes(layout, new Map([["wall", wallBounds]]));

  assert.deepEqual(boxes[0]?.box.getSize(new Vector3()).toArray(), [2, 2, 0.2]);
  assert.deepEqual(boxes[1]?.box.getSize(new Vector3()).toArray(), [2, 2, 0.2]);
  const scaledSize = boxes[2]?.box.getSize(new Vector3()).toArray() ?? [];
  assert.ok(Math.abs((scaledSize[0] ?? 0) - 4) < 1e-9);
  assert.ok(Math.abs((scaledSize[1] ?? 0) - 2) < 1e-9);
  assert.ok(Math.abs((scaledSize[2] ?? 0) - 0.6) < 1e-9);
});

check("floorSnapPosition places the world-box bottom on y=0", () => {
  const box = new Box3(new Vector3(2, 1.25, -1), new Vector3(4, 3.25, 1));
  assert.deepEqual(floorSnapPosition(box, [3, 5, 0]), [3, 3.75, 0]);
});

check("floorSnapPosition no-ops when already on the floor", () => {
  const box = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1));
  assert.equal(floorSnapPosition(box, [0, 0, 0]), null);
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

check("layout simulatePhysics maps to a dynamic collider component", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "dynamic-rigidbody-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "crate",
        placements: [
          { position: [0, 5, 0], simulatePhysics: true },
          { position: [1, 5, 0], collision: false, simulatePhysics: true },
        ],
      },
    ],
    characters: [],
    lights: [],
  };

  const document = roomLayoutToSceneDocument(fixture);
  const dynamic = document.entities.find((entity) => entity.id === instanceEntityId("crate", 0));
  const forcedCollider = document.entities.find(
    (entity) => entity.id === instanceEntityId("crate", 1),
  );

  assert.deepEqual(dynamic ? readColliderComponent(dynamic) : undefined, {
    shape: "box",
    size: [1, 1, 1],
    isStatic: false,
    isSensor: false,
    simulatePhysics: true,
  });
  assert.deepEqual(forcedCollider ? readColliderComponent(forcedCollider) : undefined, {
    shape: "box",
    size: [1, 1, 1],
    isStatic: false,
    isSensor: false,
    simulatePhysics: true,
  });
});

check("layout physics settings map to collider components", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "physics-settings-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "crate",
        placements: [
          {
            position: [0, 5, 0],
            simulatePhysics: true,
            physics: {
              massKg: 12.5,
              linearDamping: 0.2,
              angularDamping: 0.3,
              enableGravity: false,
              lockPosition: [true, false, false],
              lockRotation: [false, true, false],
            },
          },
        ],
      },
    ],
    characters: [],
    lights: [],
  };

  const document = roomLayoutToSceneDocument(fixture);
  const dynamic = document.entities.find((entity) => entity.id === instanceEntityId("crate", 0));

  assert.deepEqual(dynamic ? readColliderComponent(dynamic) : undefined, {
    shape: "box",
    size: [1, 1, 1],
    isStatic: false,
    isSensor: false,
    simulatePhysics: true,
    massKg: 12.5,
    linearDamping: 0.2,
    angularDamping: 0.3,
    enableGravity: false,
    lockPosition: [true, false, false],
    lockRotation: [false, true, false],
  });
});

// Without a bounds resolver the adapter bakes the placement scale into a unit
// box (physics no longer rescales); a resolver supplies the world-aligned
// size + center so derived colliders match the rendered mesh.
check("adapter derives collider size from placement scale and a bounds resolver", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "collider-size-fixture",
    loadGroups: [],
    instances: [
      { assetId: "crate", placements: [{ position: [0, 0, 0], scale: [2, 3, 4] }] },
      { assetId: "wall", placements: [{ position: [0, 0, 0], scale: 1 }] },
    ],
    characters: [],
    lights: [],
  };

  const defaulted = roomLayoutToSceneDocument(fixture).entities.find(
    (entity) => entity.id === instanceEntityId("crate", 0),
  );
  assert.deepEqual(defaulted ? readColliderComponent(defaulted) : undefined, {
    shape: "box",
    size: [2, 3, 4], // scale baked, no resolver -> no center
    isStatic: true,
    isSensor: false,
  });

  const resolved = roomLayoutToSceneDocument(fixture, {
    colliderBox: (assetId) =>
      assetId === "wall" ? { size: [0.5, 2, 4], center: [0, 1, 0] } : undefined,
  }).entities.find((entity) => entity.id === instanceEntityId("wall", 0));
  assert.deepEqual(resolved ? readColliderComponent(resolved) : undefined, {
    shape: "box",
    size: [0.5, 2, 4],
    center: [0, 1, 0],
    isStatic: true,
    isSensor: false,
  });
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

// A disabled behavior subsystem holds the scene static: no behavior runs and no
// transform is synced, even with entities and held input. This is how the editor
// keeps WASD from driving the character in edit mode; re-enabling resumes ticking.
check("behavior subsystem: setEnabled(false) suppresses ticking until re-enabled", () => {
  const synced: string[] = [];
  const registry: BehaviorRegistry = {
    get: (scriptId) =>
      scriptId === "input-move"
        ? ({ engine, actions, transform }) => {
            if (actions.held("move-right")) transform.position[0] += 2 * engine.deltaSeconds;
          }
        : undefined,
  };
  const actions = new ActionMap({ KeyD: "move-right" });
  const subsystem = new BehaviorSubsystem(registry, actions, (_id, transform) => {
    synced.push(String(transform.position[0]));
  });
  subsystem.setEntities([
    {
      id: "character:0",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Behavior: { scriptId: "input-move" },
      },
    },
  ]);
  actions.handleDown("KeyD");
  const app = new EngineApp();
  app.registerSubsystem(new InputSubsystem(actions));
  app.registerSubsystem(subsystem);

  subsystem.setEnabled(false);
  app.update(0.5);
  assert.deepEqual(synced, []);

  subsystem.setEnabled(true);
  app.update(0.5);
  assert.deepEqual(synced, ["1"]);
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

check("generateOverlapEvents=false suppresses sensor overlap contacts", () => {
  const physics = new PhysicsSubsystem();
  const mover = {
    id: "mover",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
    },
  } as const;
  physics.setEntities([
    mover,
    {
      id: "silent",
      components: {
        Transform: { position: [0.3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [1, 1, 1],
          isStatic: true,
          isSensor: true,
          generateOverlapEvents: false,
        },
      },
    },
  ]);
  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.update(0.016);
  assert.deepEqual(physics.contactsForEntity("mover"), []);

  // A sensor with events left on (default) still reports the overlap.
  physics.setEntities([
    mover,
    {
      id: "live",
      components: {
        Transform: { position: [0.3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      },
    },
  ]);
  app.update(0.016);
  assert.deepEqual(physics.contactsForEntity("mover"), [
    { a: "mover", b: "live", isSensor: true },
  ]);
});

check("simulationGeneratesHitEvents=false on both bodies suppresses the hit", () => {
  const physics = new PhysicsSubsystem();
  physics.setEntities([
    {
      id: "a",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [1, 1, 1],
          isStatic: false,
          isSensor: false,
          simulationGeneratesHitEvents: false,
        },
      },
    },
    {
      id: "b",
      components: {
        Transform: { position: [0.3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [1, 1, 1],
          isStatic: true,
          isSensor: false,
          simulationGeneratesHitEvents: false,
        },
      },
    },
  ]);
  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.update(0.016);
  assert.deepEqual(physics.contactsForEntity("a"), []);
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

await checkAsync("rapier simulatePhysics body falls under configured gravity", async () => {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setGravity([0, -10, 0]);
  const synced: TransformComponent[] = [];
  physics.setTransformSink((_entityId, transform) => {
    synced.push({
      position: [...transform.position],
      rotation: [...transform.rotation],
      scale: [...transform.scale],
    });
  });
  physics.setEntities([
    {
      id: "crate",
      components: {
        Transform: { position: [0, 5, 0], rotation: [0, 30, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [1, 1, 1],
          isStatic: false,
          isSensor: false,
          simulatePhysics: true,
        },
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
    assert.equal(physics.usesRapier(), true);
    for (let frame = 0; frame < 12; frame += 1) app.update(1 / 60);
    assert.ok(synced.length > 0, "expected physics to sync dynamic transforms");
    const last = synced.at(-1) ?? assert.fail("synced");
    assert.ok(last.position[1] < 5);
    assert.ok(Math.abs(last.rotation[1] - 30) < 1e-3, `rotationY=${last.rotation[1]}`);
    await app.dispose();
  } finally {
    console.warn = warn;
  }
});

await checkAsync("rapier builds a compound collider per authored primitive (gap is empty)", async () => {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setGravity([0, 0, 0]);
  physics.setEntities([
    {
      id: "compound",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [1, 3, 1], // encompassing AABB spans the gap between the two boxes
          isStatic: true,
          isSensor: false,
          primitives: [
            { shape: "box", size: [1, 1, 1], center: [0, 1, 0] },
            { shape: "box", size: [1, 1, 1], center: [0, -1, 0] },
          ],
        },
      },
    },
    {
      id: "hit",
      components: {
        Transform: { position: [0.3, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false, simulatePhysics: true },
      },
    },
    {
      id: "gap",
      components: {
        Transform: { position: [0.3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [0.6, 0.6, 0.6], isStatic: false, isSensor: false, simulatePhysics: true },
      },
    },
  ]);
  const app = new EngineApp();
  app.registerSubsystem(physics);
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0] ?? "").includes("deprecated parameters for the initialization function")) return;
    warn(...args);
  };
  try {
    await app.init();
    assert.equal(physics.usesRapier(), true);
    app.update(1 / 60);
    // The probe overlapping a primitive contacts the compound...
    assert.ok(
      physics.contactsForEntity("hit").some((c) => c.a === "compound" || c.b === "compound"),
      "overlapping probe should contact the compound collider",
    );
    // ...but a probe sitting in the gap between the two boxes does not (proving
    // the per-primitive compound is used rather than the encompassing AABB box).
    assert.deepEqual(physics.contactsForEntity("gap"), []);
    await app.dispose();
  } finally {
    console.warn = warn;
  }
});

await checkAsync("rapier simulatePhysics enableGravity false disables world gravity", async () => {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setGravity([0, -10, 0]);
  const synced: TransformComponent[] = [];
  physics.setTransformSink((_entityId, transform) => {
    synced.push({
      position: [...transform.position],
      rotation: [...transform.rotation],
      scale: [...transform.scale],
    });
  });
  physics.setEntities([
    {
      id: "crate",
      components: {
        Transform: { position: [0, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [1, 1, 1],
          isStatic: false,
          isSensor: false,
          simulatePhysics: true,
          enableGravity: false,
        },
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
    for (let frame = 0; frame < 30; frame += 1) app.update(1 / 60);
    const last = synced.at(-1) ?? assert.fail("synced");
    assert.ok(Math.abs(last.position[1] - 5) < 0.001, `gravity disabled y=${last.position[1]}`);
    await app.dispose();
  } finally {
    console.warn = warn;
  }
});

await checkAsync("rapier simulatePhysics thin wall can topple after ground contact", async () => {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setGravity([0, -10, 0]);
  const synced: TransformComponent[] = [];
  physics.setTransformSink((entityId, transform) => {
    if (entityId === "wall") {
      synced.push({
        position: [...transform.position],
        rotation: [...transform.rotation],
        scale: [...transform.scale],
      });
    }
  });
  physics.setEntities([
    {
      id: "floor",
      components: {
        Transform: { position: [0, -0.1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [20, 0.2, 20], isStatic: true, isSensor: false },
      },
    },
    {
      id: "wall",
      components: {
        Transform: { position: [0, 3, 0], rotation: [0, 0, 25], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [0.2, 3, 0.2],
          isStatic: false,
          isSensor: false,
          simulatePhysics: true,
        },
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
    for (let frame = 0; frame < 240; frame += 1) app.update(1 / 60);
    const last = synced.at(-1) ?? assert.fail("synced");
    assert.ok(last.position[1] < 2, `wall did not reach the floor: y=${last.position[1]}`);
    assert.ok(
      Math.abs(last.rotation[2] - 25) > 2,
      `wall rotation stayed locked: rotationZ=${last.rotation[2]}`,
    );
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
    simulatePhysics: true,
    physics: {
      massKg: 2,
      linearDamping: 0.25,
      angularDamping: 0.5,
      enableGravity: false,
      lockPosition: [true, false, false],
      lockRotation: [false, true, false],
    },
    metadata: { hp: 5 },
    bogusField: 123,
    nested: { evil: true },
  });
  assert.deepEqual(placement.position, [1, 2, 3]);
  assert.equal(placement.name, "crate");
  assert.equal(placement.collision, false);
  assert.equal(placement.simulatePhysics, true);
  assert.deepEqual(placement.physics, {
    massKg: 2,
    linearDamping: 0.25,
    angularDamping: 0.5,
    enableGravity: false,
    lockPosition: [true, false, false],
    lockRotation: [false, true, false],
  });
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
  // Mesh is +z-forward, so the yaw turns local +z to the movement direction.
  yawApproxEqual(facingYawFromMove(0, -1) ?? NaN, 180); // forward (-z)
  yawApproxEqual(facingYawFromMove(0, 1) ?? NaN, 0); // back (+z)
  yawApproxEqual(facingYawFromMove(1, 0) ?? NaN, 90); // right (+x)
  yawApproxEqual(facingYawFromMove(-1, 0) ?? NaN, -90); // left (-x)
  yawApproxEqual(facingYawFromMove(1, -1) ?? NaN, 135); // forward-right
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
  yawApproxEqual(moved.rotation[1], 135); // +z-forward mesh faces the +x/-z move

  // Tick 2: no input -> position unchanged and facing held (not reset to 0).
  const xBefore = moved.position[0];
  const zBefore = moved.position[2];
  actions.handleUp("KeyW");
  actions.handleUp("KeyD");
  actions.advance();
  subsystem.update({ deltaSeconds: 0.5, elapsedSeconds: 1, frame: 2 });
  assert.equal(moved.position[0], xBefore);
  assert.equal(moved.position[2], zBefore);
  yawApproxEqual(moved.rotation[1], 135);
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

// G2 vertical motion (src/game/verticalMotion.ts): gravity pulls the player
// down, a grounded jump on the press edge launches it, and crossing the floor
// re-grounds. Pure state machine the player behavior steps each tick.
check("stepVerticalMotion: rests on the floor and stays grounded without input", () => {
  let state = groundedAt(0);
  for (let i = 0; i < 5; i += 1) {
    state = stepVerticalMotion(state, { gravityY: -10, jumpSpeed: 5, floorY: 0, dt: 0.1, jump: false });
    assert.equal(state.y, 0);
    assert.equal(state.velocityY, 0);
    assert.equal(state.grounded, true);
  }
});

check("stepVerticalMotion: a grounded jump leaves the floor with upward velocity", () => {
  const jumped = stepVerticalMotion(groundedAt(0), {
    gravityY: -10,
    jumpSpeed: 5,
    floorY: 0,
    dt: 0.1,
    jump: true,
  });
  assert.equal(jumped.grounded, false);
  assert.ok(Math.abs(jumped.velocityY - 4) <= 1e-12); // 5 - 10*0.1
  assert.ok(Math.abs(jumped.y - 0.4) <= 1e-12); // 0 + 4*0.1
});

check("stepVerticalMotion: jump rises then re-grounds after one rise/fall cycle", () => {
  const dt = 1 / 60;
  const step = { gravityY: -10, jumpSpeed: 5, floorY: 0, dt, jump: false };
  let state = stepVerticalMotion(groundedAt(0), { ...step, jump: true });
  assert.equal(state.grounded, false);
  let leftGround = false;
  let landed = false;
  for (let i = 0; i < 1000 && !landed; i += 1) {
    state = stepVerticalMotion(state, step);
    if (!state.grounded) leftGround = true;
    else if (leftGround) landed = true;
  }
  assert.ok(leftGround && landed);
  assert.equal(state.y, 0);
  assert.equal(state.velocityY, 0);
  assert.equal(state.grounded, true);
});

check("stepVerticalMotion: no mid-air double jump and a paused tick holds height", () => {
  const step = { gravityY: -10, jumpSpeed: 5, floorY: 0, dt: 0.1, jump: true };
  const airborne = stepVerticalMotion(groundedAt(0), step);
  assert.equal(airborne.grounded, false);
  // Jump pressed again while airborne: velocity only changes by gravity.
  const again = stepVerticalMotion(airborne, step);
  assert.ok(Math.abs(again.velocityY - (airborne.velocityY - 10 * 0.1)) <= 1e-12);
  // A non-positive dt leaves the height unchanged (paused frame).
  const paused = stepVerticalMotion(airborne, { ...step, dt: 0, jump: false });
  assert.equal(paused.y, airborne.y);
});

check("input-move behavior: Space jumps from the ground, then gravity returns it", () => {
  const registry = createBehaviorRegistry({ getGravityY: () => -10 });
  const actions = new ActionMap({ Space: "jump" });
  let synced: TransformComponent | undefined;
  const subsystem = new BehaviorSubsystem(registry, actions, (_id, transform) => {
    synced = transform;
  });
  subsystem.setEntities([
    {
      id: "player:g2",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Behavior: { scriptId: "input-move", params: { jumpSpeed: 5 } },
      },
    },
  ]);
  const dt = 1 / 60;

  // Idle tick: stays grounded at the authored height (captured as the floor).
  actions.advance();
  subsystem.update({ deltaSeconds: dt, elapsedSeconds: dt, frame: 1 });
  assert.equal((synced ?? assert.fail("synced")).position[1], 0);

  // Press jump (edge) -> leaves the ground.
  actions.handleDown("Space");
  actions.advance();
  subsystem.update({ deltaSeconds: dt, elapsedSeconds: 2 * dt, frame: 2 });
  assert.ok((synced ?? assert.fail("synced")).position[1] > 0);

  // Keep Space held (no new press edge) and run the arc out: it lands at the floor.
  let landedAgain = false;
  for (let frame = 3; frame < 1000 && !landedAgain; frame += 1) {
    actions.advance();
    subsystem.update({ deltaSeconds: dt, elapsedSeconds: frame * dt, frame });
    if ((synced ?? assert.fail("synced")).position[1] === 0) landedAgain = true;
  }
  assert.ok(landedAgain);
});

check("save validator allowlist keeps a valid worldSettings.gravity, rejects a bad one", () => {
  const layout = validateLayout({
    schema: 1,
    name: "g2-gravity",
    loadGroups: [],
    instances: [],
    characters: [],
    worldSettings: { gravity: [0, -12.5, 0] },
  }) as RoomLayout;
  assert.deepEqual(layout.worldSettings?.gravity, [0, -12.5, 0]);

  assert.throws(() =>
    validateLayout({
      schema: 1,
      name: "bad-gravity",
      loadGroups: [],
      instances: [],
      characters: [],
      worldSettings: { gravity: [0, -12.5] },
    }),
  );
});

// G3 collision response (src/game/collision.ts): resolve a proposed XZ move
// against static collider AABBs so the player cannot enter walls and slides
// along them. Vertical span gates which blockers apply (jump over short ones).
check("resolvePlanarMovement: no blockers leaves the move unchanged", () => {
  assert.deepEqual(
    resolvePlanarMovement([0, 0, 0], { dx: 1, dz: 2 }, [0.5, 0.5, 0.5], []),
    { dx: 1, dz: 2 },
  );
});

check("resolvePlanarMovement: head-on into a wall is blocked; diagonal slides", () => {
  const wall: Aabb3 = { min: [0.5, -1, -5], max: [1.5, 1, 5] }; // X-facing slab
  // Head-on +x from x=-0.1 (half 0.5): clamps flush to x=0 (wall.min - half).
  const headOn = resolvePlanarMovement([-0.1, 0, 0], { dx: 0.3, dz: 0 }, [0.5, 0.5, 0.5], [wall]);
  assert.ok(Math.abs(headOn.dx - 0.1) <= 1e-12);
  assert.equal(headOn.dz, 0);
  // Diagonal into the same wall: x is blocked, z slides freely.
  const diag = resolvePlanarMovement([-0.1, 0, 0], { dx: 0.3, dz: 0.4 }, [0.5, 0.5, 0.5], [wall]);
  assert.ok(Math.abs(diag.dx - 0.1) <= 1e-12);
  assert.ok(Math.abs(diag.dz - 0.4) <= 1e-12);
});

check("resolvePlanarMovement: a blocker above the player's span does not block", () => {
  const overhead: Aabb3 = { min: [0.5, 1, -5], max: [1.5, 2, 5] };
  // Player vertical span [-0.25, 0.25] sits below the overhead blocker.
  const moved = resolvePlanarMovement([-0.1, 0, 0], { dx: 0.3, dz: 0 }, [0.5, 0.25, 0.5], [overhead]);
  assert.ok(Math.abs(moved.dx - 0.3) <= 1e-12);
});

check("resolvePlanarMovement: a blocker the player already overlaps does not block (ground)", () => {
  // Large ground slab the player stands within (overlaps on every axis at start).
  const ground: Aabb3 = { min: [-5, -0.5, -5], max: [5, 0.5, 5] };
  const moved = resolvePlanarMovement([0, 0, 0], { dx: 0.3, dz: -0.4 }, [0.15, 0.15, 0.15], [ground]);
  assert.ok(Math.abs(moved.dx - 0.3) <= 1e-12);
  assert.ok(Math.abs(moved.dz + 0.4) <= 1e-12);
});

check("resolvePlanarMovement: stops at the blocker in the path among several", () => {
  const near: Aabb3 = { min: [0.5, -1, -5], max: [1.5, 1, 5] };
  const far: Aabb3 = { min: [3, -1, -5], max: [4, 1, 5] };
  const moved = resolvePlanarMovement([0, 0, 0], { dx: 1.2, dz: 0 }, [0.5, 0.5, 0.5], [far, near]);
  assert.ok(Math.abs(moved.dx) <= 1e-12); // flush against the near wall (x stays 0)
});

check("physics subsystem exposes static blocker AABBs and collider half-extents", () => {
  const physics = new PhysicsSubsystem();
  physics.setEntities([
    {
      id: "wall",
      components: {
        Transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: false },
      },
    },
    {
      id: "trigger",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      },
    },
    {
      id: "player",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
      },
    },
  ]);
  const blockers = physics.staticBlockerAabbs();
  assert.equal(blockers.length, 1); // wall only: the sensor and the non-static player are excluded
  assert.deepEqual(blockers[0], { min: [1.5, -0.5, -0.5], max: [2.5, 0.5, 0.5] });
  // Collider size is world-space (scale baked at scene-build), so half = size/2;
  // the entity's transform.scale is no longer reapplied here.
  assert.deepEqual(physics.colliderHalfExtents("player"), [0.5, 0.5, 0.5]);
  assert.equal(physics.colliderHalfExtents("missing"), null);
});

// A collider with a center offset places its AABB at position + center, so a
// model whose geometry is not centered on its origin still aligns to the mesh.
check("physics subsystem offsets a collider AABB by its center", () => {
  const physics = new PhysicsSubsystem();
  physics.setEntities([
    {
      id: "wall",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [2, 4, 0.5],
          center: [0, 2, 1],
          isStatic: true,
          isSensor: false,
        },
      },
    },
  ]);
  assert.deepEqual(physics.staticBlockerAabbs()[0], {
    min: [-1, 0, 0.75],
    max: [1, 4, 1.25],
  });
});

check("input-move behavior: the player cannot walk through a static wall", () => {
  const registry = createBehaviorRegistry();
  const actions = new ActionMap({ KeyD: "move-right" });
  const physics = new PhysicsSubsystem();
  const player: Entity = {
    id: "player:wall",
    components: {
      Transform: { position: [-1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
      Behavior: { scriptId: "input-move", params: { speed: 3 } },
    },
  };
  const wall: Entity = {
    id: "wall",
    components: {
      Transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: false },
    },
  };
  physics.setEntities([player, wall]);

  let synced: TransformComponent | undefined;
  const subsystem = new BehaviorSubsystem(registry, actions, (_id, t) => { synced = t; }, physics);
  subsystem.setEntities([player]);

  // Hold move-right into the wall for many ticks. The wall spans x [0.5,1.5];
  // the player (half 0.5) must stop flush at x=0 and never cross it.
  actions.handleDown("KeyD");
  let maxX = -Infinity;
  for (let frame = 1; frame <= 40; frame += 1) {
    actions.advance();
    subsystem.update({ deltaSeconds: 0.1, elapsedSeconds: frame * 0.1, frame });
    maxX = Math.max(maxX, (synced ?? assert.fail("synced")).position[0]);
  }
  assert.ok(maxX <= 1e-9, `player crossed the wall: maxX=${maxX}`);
  assert.ok(Math.abs((synced ?? assert.fail("synced")).position[0]) <= 1e-9); // resting flush at x=0
});

// G5 movement-driven animation (src/game/locomotionAnimation.ts): map the
// player's per-tick movement snapshot to a semantic state, then to a concrete
// clip via per-state fallback chains. Pure selection the runtime shell applies
// to a crossfade animator.
const ground = (planarSpeed: number): LocomotionInput => ({ planarSpeed, grounded: true, velocityY: 0 });

check("classifyLocomotion: grounded planar speed picks idle/walk/run by threshold", () => {
  const thresholds = { walkSpeed: 0.1, runSpeed: 3 };
  assert.equal(classifyLocomotion(ground(0), thresholds), "idle");
  assert.equal(classifyLocomotion(ground(0.05), thresholds), "idle"); // below walk
  assert.equal(classifyLocomotion(ground(2), thresholds), "walk");
  assert.equal(classifyLocomotion(ground(3), thresholds), "run"); // at runSpeed
  assert.equal(classifyLocomotion(ground(4), thresholds), "run");
});

check("classifyLocomotion: airborne reads jump while rising, fall while descending", () => {
  assert.equal(classifyLocomotion({ planarSpeed: 0, grounded: false, velocityY: 5 }), "jump");
  assert.equal(classifyLocomotion({ planarSpeed: 9, grounded: false, velocityY: -5 }), "fall");
  // Airborne overrides planar speed: moving fast off a ledge is still fall, not run.
  assert.equal(classifyLocomotion({ planarSpeed: 0, grounded: false, velocityY: 0 }), "fall");
});

check("resolveLocomotionClip: walks the fallback chain to an available clip", () => {
  const rich = new Set(["idle", "walk", "sprint", "static"]); // demo character's clips
  assert.equal(resolveLocomotionClip("idle", rich), "idle");
  assert.equal(resolveLocomotionClip("walk", rich), "walk");
  assert.equal(resolveLocomotionClip("run", rich), "sprint"); // run -> sprint
  assert.equal(resolveLocomotionClip("jump", rich), "idle"); // no jump clip -> idle
  assert.equal(resolveLocomotionClip("fall", rich), "idle"); // no fall clip -> idle

  // A sparser asset degrades run -> walk and idle -> static.
  const sparse = new Set(["walk", "static"]);
  assert.equal(resolveLocomotionClip("run", sparse), "walk");
  assert.equal(resolveLocomotionClip("idle", sparse), "static");

  // Last resort returns any clip; an empty set returns null.
  assert.equal(resolveLocomotionClip("idle", new Set(["only"])), "only");
  assert.equal(resolveLocomotionClip("idle", new Set<string>()), null);
});

check("selectLocomotionClip: composes classify + resolve end to end", () => {
  const clips = new Set(["idle", "walk", "sprint"]);
  assert.equal(selectLocomotionClip(ground(0), clips), "idle");
  assert.equal(selectLocomotionClip(ground(2), clips), "walk");
  assert.equal(selectLocomotionClip(ground(4), clips), "sprint");
  assert.equal(selectLocomotionClip({ planarSpeed: 0, grounded: false, velocityY: 3 }, clips), "idle");
});

check("CrossfadeAnimator: exposes its clips and tracks the current clip on play", () => {
  const root = new Object3D();
  const clips = [new AnimationClip("idle", 1, []), new AnimationClip("walk", 1, [])];
  const animator = new CrossfadeAnimator(root, clips);
  assert.deepEqual([...animator.clips].sort(), ["idle", "walk"]);
  assert.equal(animator.currentClip, null);

  animator.play("idle", 0); // first play snaps in
  assert.equal(animator.currentClip, "idle");
  animator.play("walk", 0.2); // crossfades to walk
  assert.equal(animator.currentClip, "walk");
  animator.play("missing"); // unknown clip is a no-op
  assert.equal(animator.currentClip, "walk");
});

check("input-move behavior: reports the movement snapshot and sprint raises planar speed", () => {
  const reports = new Map<string, LocomotionInput>();
  const registry = createBehaviorRegistry({
    getGravityY: () => -10,
    reportLocomotion: (id, report) => reports.set(id, report),
  });
  const actions = new ActionMap({ KeyW: "move-forward", ShiftLeft: "sprint" });
  const subsystem = new BehaviorSubsystem(registry, actions, () => {});
  subsystem.setEntities([
    {
      id: "character:0",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Behavior: { scriptId: "input-move", params: { speed: 2, sprintMultiplier: 2 } },
      },
    },
  ]);
  const dt = 0.1;

  // Idle: grounded, zero planar speed.
  actions.advance();
  subsystem.update({ deltaSeconds: dt, elapsedSeconds: dt, frame: 1 });
  const idle = reports.get("character:0") ?? assert.fail("reported");
  assert.equal(idle.planarSpeed, 0);
  assert.equal(idle.grounded, true);

  // Walk: hold forward -> planar speed ~= base speed (2).
  actions.handleDown("KeyW");
  actions.advance();
  subsystem.update({ deltaSeconds: dt, elapsedSeconds: 2 * dt, frame: 2 });
  const walk = reports.get("character:0") ?? assert.fail("reported");
  assert.ok(Math.abs(walk.planarSpeed - 2) <= 1e-9, `walk speed ${walk.planarSpeed}`);

  // Run: also hold sprint -> planar speed ~= base * multiplier (4).
  actions.handleDown("ShiftLeft");
  actions.advance();
  subsystem.update({ deltaSeconds: dt, elapsedSeconds: 3 * dt, frame: 3 });
  const run = reports.get("character:0") ?? assert.fail("reported");
  assert.ok(Math.abs(run.planarSpeed - 4) <= 1e-9, `run speed ${run.planarSpeed}`);
});

// G6 authored playable scene: a `sensor` placement flag yields a non-blocking
// trigger collider, and the `goal-reached` behavior fires once on the first
// contact (only the player can touch a static sensor), playing its cue and
// signalling the shell. The playground layout is the authored default scene.
check("layout sensor flag maps to a non-blocking sensor collider", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "sensor-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "zone",
        placements: [{ position: [0, 0, 0], sensor: true }, { position: [1, 0, 0] }],
      },
    ],
    characters: [],
    lights: [],
  };
  const doc = roomLayoutToSceneDocument(fixture);
  const sensor = doc.entities.find((e) => e.id === instanceEntityId("zone", 0));
  const solid = doc.entities.find((e) => e.id === instanceEntityId("zone", 1));
  assert.deepEqual(sensor ? readColliderComponent(sensor) : undefined, {
    shape: "box",
    size: [1, 1, 1],
    isStatic: true,
    isSensor: true,
  });
  assert.equal(solid ? readColliderComponent(solid)?.isSensor : undefined, false);
});

check("collisionPreset maps to runtime collider: trigger=sensor, noCollision=none", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "preset-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "zone",
        placements: [
          { position: [0, 0, 0], collisionPreset: "trigger" },
          { position: [1, 0, 0], collisionPreset: "noCollision" },
          { position: [2, 0, 0], collisionPreset: "blockAll" },
        ],
      },
    ],
    characters: [],
    lights: [],
  };
  const doc = roomLayoutToSceneDocument(fixture);
  const triggerEntity = doc.entities.find((e) => e.id === instanceEntityId("zone", 0));
  const noneEntity = doc.entities.find((e) => e.id === instanceEntityId("zone", 1));
  const blockEntity = doc.entities.find((e) => e.id === instanceEntityId("zone", 2));
  assert.equal(triggerEntity ? readColliderComponent(triggerEntity)?.isSensor : undefined, true);
  assert.equal(noneEntity ? readColliderComponent(noneEntity) : "missing", undefined);
  assert.equal(blockEntity ? readColliderComponent(blockEntity)?.isSensor : undefined, false);
});

check("adapter bakes authored collision primitives into a compound collider", () => {
  const compoundLayout: RoomLayout = {
    schema: 1,
    name: "compound-fixture",
    loadGroups: [],
    instances: [{ assetId: "chair", placements: [{ position: [0, 0, 0], scale: 2 }] }],
    characters: [],
    lights: [],
  };
  const defs = new Map<string, AssetCollisionDef>([
    [
      "chair",
      {
        primitives: [
          { shape: "box", size: [0.2, 0.4, 0.2], center: [0, 0.2, 0] },
          { shape: "box", size: [0.2, 0.2, 0.2], center: [0, 0.5, 0] },
        ],
        complexity: "projectDefault",
        preset: "blockAll",
      },
    ],
  ]);
  const doc = roomLayoutToSceneDocument(compoundLayout, { collisionDefs: defs });
  const entity = doc.entities.find((e) => e.id === instanceEntityId("chair", 0));
  const collider = entity ? readColliderComponent(entity) : undefined;
  assert.ok(collider?.primitives, "collider has authored primitives");
  assert.equal(collider!.primitives!.length, 2);
  // Placement scale 2 is baked into each primitive's size and center.
  assert.deepEqual(collider!.primitives![0]!.size, [0.4, 0.8, 0.4]);
  assert.deepEqual(collider!.primitives![0]!.center, [0, 0.4, 0]);
  // Top-level box is the encompassing AABB (y spans 0.0..1.2 -> size 1.2, center 0.6).
  assert.ok(Math.abs(collider!.size[1] - 1.2) < 1e-9, `size.y=${collider!.size[1]}`);
  assert.ok(Math.abs((collider!.center?.[1] ?? 0) - 0.6) < 1e-9, `center.y=${collider!.center?.[1]}`);
});

check("physical material id sets collider friction/restitution", () => {
  assert.deepEqual(resolvePhysicalMaterial("rubber"), { friction: 0.9, restitution: 0.7 });
  assert.deepEqual(resolvePhysicalMaterial(undefined), { friction: 0.8, restitution: 0 });
  assert.deepEqual(resolvePhysicalMaterial("nonexistent"), { friction: 0.8, restitution: 0 });

  const matLayout: RoomLayout = {
    schema: 1,
    name: "material-fixture",
    loadGroups: [],
    instances: [{ assetId: "ball", placements: [{ position: [0, 0, 0] }] }],
    characters: [],
    lights: [],
  };
  const defs = new Map<string, AssetCollisionDef>([
    [
      "ball",
      {
        primitives: [{ shape: "box", size: [1, 1, 1] }],
        complexity: "projectDefault",
        preset: "blockAll",
        physicalMaterialId: "rubber",
      },
    ],
  ]);
  const doc = roomLayoutToSceneDocument(matLayout, { collisionDefs: defs });
  const entity = doc.entities.find((e) => e.id === instanceEntityId("ball", 0));
  const collider = entity ? readColliderComponent(entity) : undefined;
  assert.ok(Math.abs((collider?.friction ?? -1) - 0.9) < 1e-9, `friction=${collider?.friction}`);
  assert.ok(Math.abs((collider?.restitution ?? -1) - 0.7) < 1e-9, `restitution=${collider?.restitution}`);
});

check("collisionWireboxes draws authored primitives over the auto bounding box", () => {
  const wireLayout: RoomLayout = {
    schema: 1,
    name: "wirebox-fixture",
    loadGroups: [],
    instances: [{ assetId: "chair", placements: [{ position: [1, 0, 0] }] }],
    characters: [],
    lights: [],
  };
  const bounds = new Map([["chair", new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))]]);
  // No defs -> a single auto box from the model bounds.
  assert.equal(collisionWireboxes(wireLayout, bounds).length, 1);
  // With two authored primitives -> two boxes, ignoring the auto bounds box.
  const defs = new Map<string, AssetCollisionDef>([
    [
      "chair",
      {
        primitives: [
          { shape: "box", size: [0.5, 0.5, 0.5], center: [0.2, 0.1, 0] },
          { shape: "box", size: [0.3, 1, 0.3] },
        ],
        complexity: "projectDefault",
        preset: "blockAll",
      },
    ],
  ]);
  const authored = collisionWireboxes(wireLayout, bounds, defs);
  assert.equal(authored.length, 2);
  // First authored box centers at placement(1,0,0) + local center(0.2,0.1,0).
  const center = authored[0]!.box.getCenter(new Vector3());
  assert.ok(Math.abs(center.x - 1.2) < 1e-6, `x=${center.x}`);
  assert.ok(Math.abs(center.y - 0.1) < 1e-6, `y=${center.y}`);
  assert.deepEqual(authored[0]!.size, [0.5, 0.5, 0.5]);
});

check("save validator allowlist keeps a placement sensor flag", () => {
  const layout = validateLayout({
    schema: 1,
    name: "sensor",
    loadGroups: [],
    instances: [{ assetId: "zone", placements: [{ position: [0, 0, 0], sensor: true }] }],
    characters: [],
  }) as RoomLayout;
  assert.equal(layout.instances[0]?.placements[0]?.sensor, true);
});

check("goal-reached behavior: fires once on contact, plays its cue, signals the shell", () => {
  const reached: string[] = [];
  const registry = createBehaviorRegistry({ onGoalReached: (id) => reached.push(id) });
  const physics = new PhysicsSubsystem();
  const audio = new AudioSubsystem();
  const goal: Entity = {
    id: "goal:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      Behavior: { scriptId: "goal-reached" },
      Audio: { clipId: "collision-chime", volume: 0.6, loop: false, spatial: false },
    },
  };
  const player: Entity = {
    id: "player:0",
    components: {
      Transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
    },
  };
  physics.setEntities([goal, player]);
  const behavior = new BehaviorSubsystem(registry, new ActionMap({}), () => undefined, physics, audio);
  behavior.setEntities([goal, player]);
  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.registerSubsystem(behavior);
  app.registerSubsystem(audio);

  // The sensor goal never blocks movement, and far away there is no trigger.
  assert.equal(physics.staticBlockerAabbs().length, 0);
  app.update(0.016);
  assert.deepEqual(reached, []);
  assert.deepEqual(audio.playedRequests(), []);

  // Walk the player onto the goal and tick twice: it fires exactly once.
  physics.setEntityTransform("player:0", {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  app.update(0.016);
  app.update(0.016);
  assert.deepEqual(reached, ["goal:0"]);
  assert.deepEqual(audio.playedRequests(), [
    { clipId: "collision-chime", volume: 0.6, loop: false, spatial: false },
  ]);
});

check("playground layout validates and carries the sensor goal trigger", () => {
  const raw = JSON.parse(readFileSync("public/layouts/playground.json", "utf8"));
  const playground = validateLayout(raw) as RoomLayout;
  assert.deepEqual(validateLayout(playground), playground); // idempotent
  const goal = playground.instances.find((i) => i.assetId === "potted-plant")?.placements[0];
  assert.equal(goal?.sensor, true);
  assert.equal(goal?.behavior?.script, "goal-reached");
  assert.equal(playground.characters[0]?.behavior?.script, "input-move");
});

// ---------------------------------------------------------------------------
// Gameplay framework (Game Mode / Pawn / Controller) — catalog, registry,
// camera-pawn math, and session possession rules.
// ---------------------------------------------------------------------------

const MOVE_BINDINGS = {
  KeyW: "move-forward",
  KeyS: "move-back",
  KeyA: "move-left",
  KeyD: "move-right",
} as const;

function makeCharacterRef(
  index: number,
  opts: { input?: boolean; player?: boolean } = {},
): RuntimeCharacterRef {
  const placement: LayoutCharacter = {
    assetId: "hero",
    position: [0, 0, 0],
  };
  if (opts.input) placement.behavior = { script: "input-move" };
  if (opts.player) placement.metadata = { player: true };
  return {
    index,
    entityId: characterEntityId(index),
    object: new Object3D(),
    gltf: { animations: [] } as unknown as GLTF,
    placement,
  };
}

function makeGameModeContext(options: {
  camera?: PerspectiveCamera;
  actions?: ActionMap;
  characters?: RuntimeCharacterRef[];
  locomotion?: Map<string, LocomotionInput>;
}): { context: GameModeContext; mixers: AnimationMixer[]; cameraControlled: () => boolean } {
  let controlled = false;
  const mixers: AnimationMixer[] = [];
  const locomotion = options.locomotion ?? new Map<string, LocomotionInput>();
  const context: GameModeContext = {
    camera: options.camera ?? new PerspectiveCamera(),
    actions: options.actions ?? new ActionMap(),
    characters: options.characters ?? [],
    getLocomotion: (id) => locomotion.get(id),
    addMixer: (mixer) => mixers.push(mixer),
    markCameraControlled: () => {
      controlled = true;
    },
  };
  return { context, mixers, cameraControlled: () => controlled };
}

check("game mode catalog default is the first option", () => {
  assert.equal(GAME_MODE_OPTIONS[0]?.id, DEFAULT_GAME_MODE_ID);
  assert.ok(isKnownGameModeId(DEFAULT_GAME_MODE_ID));
  assert.ok(isKnownGameModeId("forge.tpsCharacter"));
  assert.equal(isKnownGameModeId("forge.unknown"), false);
  assert.equal(isKnownGameModeId(undefined), false);
});

check("normalizeGameModeId / resolveGameMode fall back to the default camera mode", () => {
  assert.equal(normalizeGameModeId(undefined), DEFAULT_GAME_MODE_ID);
  assert.equal(normalizeGameModeId("forge.nope"), DEFAULT_GAME_MODE_ID);
  assert.equal(normalizeGameModeId("forge.tpsCharacter"), "forge.tpsCharacter");
  assert.equal(resolveGameMode(undefined).id, DEFAULT_GAME_MODE_ID);
  assert.equal(resolveGameMode("forge.nope").id, DEFAULT_GAME_MODE_ID);
  assert.equal(resolveGameMode("forge.tpsCharacter").id, "forge.tpsCharacter");
});

check("save validator preserves worldSettings.gameMode and drops runtime state", () => {
  const out = validateLayout({
    schema: 1,
    name: "gm",
    loadGroups: [],
    instances: [],
    characters: [],
    // pawnEntityId is runtime-only and not on the allowlist, so it must not survive.
    worldSettings: { gameMode: "forge.tpsCharacter", pawnEntityId: "character:0" },
  }) as RoomLayout;
  assert.equal(out.worldSettings?.gameMode, "forge.tpsCharacter");
  assert.equal((out.worldSettings as Record<string, unknown>).pawnEntityId, undefined);
});

check("save validator rejects a non-string gameMode", () => {
  assert.throws(() =>
    validateLayout({
      schema: 1,
      name: "gm",
      loadGroups: [],
      instances: [],
      characters: [],
      worldSettings: { gameMode: 123 },
    }),
  );
});

check("cameraPlanarPan moves along the camera's horizontal forward", () => {
  // Forward = world -z (a fresh camera). Holding forward moves -z, no x drift,
  // at speed*dt = 2 units this tick.
  const step = cameraPlanarPan(0, -1, { forward: true, back: false, left: false, right: false }, 4, 0.5);
  assert.ok(Math.abs(step.dx) < 1e-9);
  assert.ok(step.dz < 0);
  assert.ok(Math.abs(Math.hypot(step.dx, step.dz) - 2) < 1e-9);
});

check("cameraPlanarPan cancels opposing keys and keeps diagonals at unit speed", () => {
  assert.deepEqual(
    cameraPlanarPan(0, -1, { forward: true, back: true, left: false, right: false }, 4, 0.5),
    { dx: 0, dz: 0 },
  );
  // Looking straight down (zero XZ forward) falls back to world -z.
  const down = cameraPlanarPan(0, 0, { forward: true, back: false, left: false, right: false }, 4, 0.5);
  assert.ok(down.dz < 0 && Math.abs(down.dx) < 1e-9);
  // Forward+right diagonal is not faster than a straight move.
  const diag = cameraPlanarPan(0, -1, { forward: true, back: false, left: false, right: true }, 4, 0.5);
  assert.ok(Math.abs(Math.hypot(diag.dx, diag.dz) - 2) < 1e-9);
});

check("default camera mode never possesses an input-move character", () => {
  const camera = new PerspectiveCamera();
  const actions = new ActionMap(MOVE_BINDINGS);
  actions.handleDown("KeyW");
  actions.advance();
  const characters = [makeCharacterRef(0, { input: true })];
  const { context, cameraControlled } = makeGameModeContext({ camera, actions, characters });
  const session = defaultCameraGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  assert.equal(session.playerState.pawnEntityId, null);
  assert.ok(session.playerState.possessed);
  assert.ok(cameraControlled());
  const z0 = camera.position.z;
  session.update(0.5);
  assert.ok(camera.position.z < z0); // WASD moved the camera...
  assert.deepEqual(characters[0].object.position.toArray(), [0, 0, 0]); // ...not the character.
});

check("tps mode possesses the input-move character and follows it", () => {
  const camera = new PerspectiveCamera();
  const characters = [makeCharacterRef(0, { input: true })];
  characters[0].object.position.set(2, 0, 3);
  const { context, mixers } = makeGameModeContext({ camera, characters });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  assert.equal(session.playerState.pawnEntityId, characterEntityId(0));
  session.possess();
  assert.ok(session.playerState.possessed);
  assert.equal(mixers.length, 1);
  session.update(0.1);
  // First frame snaps the follow camera to behind+above: player + [0, 1.2, 2.6].
  assert.ok(Math.abs(camera.position.x - 2) < 1e-6);
  assert.ok(Math.abs(camera.position.y - 1.2) < 1e-6);
  assert.ok(Math.abs(camera.position.z - 5.6) < 1e-6);
});

check("tps mode prefers a metadata-tagged player over input-move order", () => {
  const characters = [makeCharacterRef(0, { input: true }), makeCharacterRef(1, { player: true })];
  const { context } = makeGameModeContext({ characters });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  assert.equal(session.playerState.pawnEntityId, characterEntityId(1));
});

// Collision model: preset resolution + defaults.
check("blockAll preset blocks every channel with query+physics", () => {
  const profile = resolveCollisionProfile("blockAll");
  assert.equal(profile.collisionEnabled, "queryAndPhysics");
  assert.equal(profile.objectType, "worldStatic");
  for (const channel of COLLISION_CHANNELS) {
    assert.equal(profile.responses[channel], "block", `channel ${channel}`);
  }
});
check("noCollision preset ignores everything with collision disabled", () => {
  const profile = resolveCollisionProfile("noCollision");
  assert.equal(profile.collisionEnabled, "none");
  for (const channel of COLLISION_CHANNELS) {
    assert.equal(profile.responses[channel], "ignore", `channel ${channel}`);
  }
});
check("trigger preset overlaps objects but ignores trace channels", () => {
  const profile = resolveCollisionProfile("trigger");
  assert.equal(profile.collisionEnabled, "query");
  assert.equal(profile.objectType, "trigger");
  assert.equal(profile.responses.pawn, "overlap");
  assert.equal(profile.responses.visibility, "ignore");
  assert.equal(profile.responses.camera, "ignore");
});
check("custom preset honours object type and response overrides", () => {
  const profile = resolveCollisionProfile("custom", {
    collisionEnabled: "query",
    objectType: "pawn",
    responses: { pawn: "overlap", visibility: "ignore" },
  });
  assert.equal(profile.collisionEnabled, "query");
  assert.equal(profile.objectType, "pawn");
  assert.equal(profile.responses.pawn, "overlap");
  assert.equal(profile.responses.visibility, "ignore");
  // Unset channels fall back to the custom base (block).
  assert.equal(profile.responses.worldStatic, "block");
});
check("default asset collision def is empty block-all", () => {
  const def = defaultAssetCollisionDef();
  assert.deepEqual(def.primitives, []);
  assert.equal(def.preset, DEFAULT_COLLISION_PRESET);
  assert.equal(def.complexity, DEFAULT_COLLISION_COMPLEXITY);
});
check("asset collision validator keeps primitives, preset, complexity", () => {
  const def = validateAssetCollisionDef({
    primitives: [
      { shape: "box", size: [1, 2, 3], center: [0, 1, 0] },
      { shape: "sphere", size: [2, 2, 2] },
    ],
    complexity: "simpleAndComplex",
    preset: "blockAll",
    doubleSided: true,
  });
  assert.equal((def.primitives as unknown[]).length, 2);
  assert.equal(def.complexity, "simpleAndComplex");
  assert.equal(def.preset, "blockAll");
  assert.equal(def.doubleSided, true);
});
check("asset collision validator rejects unknown shape and preset", () => {
  assert.throws(() =>
    validateAssetCollisionDef({ primitives: [{ shape: "pyramid", size: [1, 1, 1] }], complexity: "projectDefault", preset: "blockAll" }),
  );
  assert.throws(() =>
    validateAssetCollisionDef({ primitives: [], complexity: "projectDefault", preset: "nope" }),
  );
});
check("placement validator keeps a valid collisionPreset and rejects bad ones", () => {
  const placement = validatePlacement({
    position: [0, 0, 0],
    collisionPreset: "trigger",
  });
  assert.equal(placement.collisionPreset, "trigger");
  assert.throws(() => validatePlacement({ position: [0, 0, 0], collisionPreset: "nope" }));
  // Absent override stays absent (inherits asset default).
  assert.equal(validatePlacement({ position: [0, 0, 0] }).collisionPreset, undefined);
});
check("collision save payload requires a .collision.json path", () => {
  const payload = validateSaveCollisionPayload({
    path: "assets/props/chair.collision.json",
    collision: { primitives: [], complexity: "projectDefault", preset: "blockAll" },
  });
  assert.equal(payload.path, "assets/props/chair.collision.json");
  assert.throws(() =>
    validateSaveCollisionPayload({ path: "assets/props/chair.json", collision: {} }),
  );
  assert.throws(() =>
    validateSaveCollisionPayload({ path: "../secret.collision.json", collision: {} }),
  );
});

console.log(`[engine-tests] ${checks} checks passed`);
