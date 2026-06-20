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
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  BackSide,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three";
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
  readInteractionComponent,
  readLightComponent,
  readMeshRendererComponent,
  readMetadataComponent,
  readParticleEmitterComponent,
  readTransformComponent,
  INTERACTION_COMPONENT,
  PARTICLE_EMITTER_COMPONENT,
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
import { initialInteractionState, stepInteractionTrigger } from "../src/game/interaction";
import { parseEffectDefinition } from "../engine/render-three/particleEffect";
import { CrossfadeAnimator } from "../engine/render-three/characterAnimator";
import {
  DEFAULT_GAME_MODE_ID,
  GAME_MODE_OPTIONS,
  isKnownGameModeId,
  normalizeGameModeId,
  TPS_GAME_MODE_ID,
} from "../src/game/gameModes/catalog";
import { resolveGameMode } from "../src/game/gameModes/registry";
import {
  applyMouseLook,
  cameraPlanarPan,
  forwardFromLookAngles,
  lookAnglesFromForward,
} from "../src/game/gameModes/cameraControl";
import {
  computePlayerStartSpawn,
  createDefaultPlayerCharacter,
  findPlayerStartTransform,
  hasPlayerCharacter,
} from "../src/game/gameModes/playerSpawn";
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
  buildImportedAssetRecord,
  resolveContentNewFile,
  resolveContentRenameTarget,
  resolveImportPath,
  validateAssetCollisionDef,
  validateContentDeletePayload,
  validateContentNewPayload,
  validateContentRenamePayload,
  validateImportAssetMeta,
  validateActorInstance,
  validateLayout,
  validateLightActor,
  validatePlacement,
  validateSkyAtmosphere,
  validateHeightFog,
  validateCloudLayer,
  validateSaveActorPayload,
  validateNewBehaviorPayload,
  resolveBehaviorStub,
  validateSaveCollisionPayload,
  validateForgeMaterialDef,
  validateSaveMaterialPayload,
  validateSaveMaterialSlotsPayload,
  validateSaveUvwPayload,
} from "./saveValidator";
import {
  defaultActorScriptDef,
  normalizeActorScriptDef,
} from "../engine/scene/actorScript";
import { actorPreviewNodes } from "../engine/scene/actorPreview";
import { normalizeForgeMaterialDef } from "../engine/assets/material";
import { createThreeMaterialFromForgeDef } from "../engine/render-three/materials";
import {
  actorInstanceEntityId,
  actorInstanceToEntity,
  parseActorInstanceEntityIndex,
} from "../engine/scene/actorInstance";
import {
  assetByteSize,
  assetLoadGroup,
  assetPath,
  assetType,
  validateAssetManifest,
  type AssetRecord,
  type AssetManifest,
} from "../engine/assets/manifest";
import type {
  LayoutCharacter,
  LayoutLightActor,
  LayoutPlacement,
  RoomLayout,
} from "../engine/scene/layout";
import {
  cloneActorInstance,
  cloneCharacter,
  clonePlacement,
} from "../editor/core/layoutSnapshots";
import { colliderBoxFromBounds } from "../engine/render-three/transforms";
import { collisionWireboxes } from "../engine/render-three/collisionView";
import { attachActorLight } from "../engine/render-three/lights";
import { sunDirectionFromLightRotation } from "../engine/render-three/skyAtmosphere";
import {
  applySceneFog,
  resolveHeightFog,
  HEIGHT_FOG_DEFAULTS,
} from "../engine/render-three/heightFog";
import {
  applyCloudUniforms,
  createCloudObject,
  resolveCloudLayer,
  CLOUD_LAYER_DEFAULTS,
} from "../engine/render-three/cloudLayer";
import {
  COLLISION_CHANNELS,
  COLLISION_OBJECT_CHANNEL_BITS,
  DEFAULT_COLLISION_COMPLEXITY,
  DEFAULT_COLLISION_PRESET,
  collisionInteractionGroups,
  defaultAssetCollisionDef,
  interactionGroupsInteract,
  resolveCollisionProfile,
  resolvePhysicalMaterial,
  type AssetCollisionDef,
} from "../engine/scene/collision";
import {
  isPlayerStartAssetId,
  isProceduralAssetId,
  PLAYER_START_ASSET_ID,
  SHAPE_PLANE_COLLISION_THICKNESS,
  SHAPE_PLANE_SIZE,
  SHAPE_PRIMITIVE_SIZE,
  shapeAssetCollisionDef,
} from "../engine/scene/shapes";
import { createProceduralAssetGltf } from "../src/scene/shapePrimitives";
import type { LightObjectRecord } from "../engine/render-three/lights";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  AmbientLight,
  AnimationClip,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  FogExp2,
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

function listPublicFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listPublicFiles(path));
    } else if (entry.isFile() && statSync(path).isFile()) {
      files.push(path.replace(/^public\//, "").replace(/\\/g, "/"));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

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
check("actor id matches selectionId", () => {
  // Placed actor instances pick by `actor:<index>`; the entity id (used by the
  // behavior/physics transform sink) must stay byte-for-byte in sync.
  assert.equal(actorInstanceEntityId(4), selectionId({ kind: "actor", index: 4 }));
});

// 2. Round-trip on the real saved layout (cwd is the repo root under npm).
const layout = JSON.parse(
  readFileSync("public/layouts/render-test-room.json", "utf8"),
) as RoomLayout;
const assetManifest = JSON.parse(
  readFileSync("public/assets/manifest.json", "utf8"),
) as AssetManifest;
const doc = roomLayoutToSceneDocument(layout);
check("asset manifest validates against the public assets tree", () => {
  const report = validateAssetManifest(assetManifest, {
    publicFiles: listPublicFiles("public/assets"),
  });
  const errors = report.issues
    .filter((issue) => issue.level === "error")
    .map((issue) => `${issue.code}:${issue.assetId ?? issue.path ?? "manifest"}`);
  assert.equal(report.errorCount, 0, errors.join("; "));
  assert.equal(report.assetCount, assetManifest.assets.length);
});
check("asset manifest helpers expose canonical path, load group, and byte size", () => {
  const sofa = assetManifest.assets.find((asset) => asset.id === "lounge-sofa");
  assert.ok(sofa);
  assert.equal(assetType(sofa), "staticMesh");
  assert.equal(assetPath(sofa), "assets/models/loungeSofa.glb");
  assert.equal(assetLoadGroup(sofa), "models");
  assert.equal(assetByteSize(sofa), 4588);
});
check("asset manifest classifies authored characters as skeletal meshes", () => {
  const character = assetManifest.assets.find((asset) => asset.id === "character-a");
  assert.ok(character);
  assert.equal(assetType(character), "skeletalMesh");
});
check("asset manifest helpers tolerate the legacy file/loadGroup/bytes shape", () => {
  const legacy = {
    id: "legacy-chair",
    file: "assets/models/chair.glb",
    type: "model",
    category: "chairs",
    loadGroup: "legacy",
    bytes: 123,
  } as unknown as AssetRecord;
  assert.equal(assetType(legacy), "staticMesh");
  assert.equal(assetPath(legacy), "assets/models/chair.glb");
  assert.equal(assetLoadGroup(legacy), "legacy");
  assert.equal(assetByteSize(legacy), 123);
});
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

check("layout materialSlot maps to the mesh renderer component", () => {
  const entities = instanceEntitiesForAsset("crate", [
    { position: [0, 0, 0], materialSlot: "starter-mat-brick-clay-old" },
  ]);
  const renderer = readMeshRendererComponent(entities[0]!);
  assert.deepEqual(renderer, {
    assetId: "crate",
    materialSlot: "starter-mat-brick-clay-old",
  });
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
            audio: { clipId: "collision-chime", volume: 0.4, loop: false, spatial: true, autoPlay: true },
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
    autoPlay: true,
  });
});

// 3 Actors & Components: the official component list now includes
// ParticleEmitter and Interaction. They have no adapter authoring path yet
// (next slice), so these check the reader validation directly off a hand-built
// entity, mirroring how the runtime systems will read them.
check("particle emitter reader parses a full authored emitter", () => {
  const entity: Entity = {
    id: "fx",
    components: {
      [PARTICLE_EMITTER_COMPONENT]: {
        effectId: "fx.smoke_soft_01",
        loop: true,
        rate: 12,
        lifetime: 2.5,
        startSize: 0.4,
        endSize: 1.2,
        velocity: [0, 1.2, 0],
        spread: 0.35,
        materialMode: "additive",
        worldSpace: true,
        autoPlay: true,
      },
    },
  };
  assert.deepEqual(readParticleEmitterComponent(entity), {
    effectId: "fx.smoke_soft_01",
    loop: true,
    rate: 12,
    lifetime: 2.5,
    startSize: 0.4,
    endSize: 1.2,
    velocity: [0, 1.2, 0],
    spread: 0.35,
    materialMode: "additive",
    worldSpace: true,
    autoPlay: true,
  });
});

check("particle emitter reader rejects empty effectId and drops invalid fields", () => {
  const missing: Entity = { id: "a", components: { [PARTICLE_EMITTER_COMPONENT]: { effectId: "" } } };
  assert.equal(readParticleEmitterComponent(missing), undefined);
  // A minimal emitter keeps only effectId; an out-of-set materialMode and a
  // malformed velocity are dropped rather than passed through.
  const minimal: Entity = {
    id: "b",
    components: {
      [PARTICLE_EMITTER_COMPONENT]: {
        effectId: "fx.spark",
        materialMode: "neon",
        velocity: [0, 1],
      },
    },
  };
  assert.deepEqual(readParticleEmitterComponent(minimal), { effectId: "fx.spark" });
});

check("interaction reader parses a full marker and rejects an empty action", () => {
  const entity: Entity = {
    id: "door",
    components: {
      [INTERACTION_COMPONENT]: {
        action: "open-door",
        prompt: "Open",
        enabled: false,
        requires: "key.brass",
        cooldown: 1.5,
      },
    },
  };
  assert.deepEqual(readInteractionComponent(entity), {
    action: "open-door",
    prompt: "Open",
    enabled: false,
    requires: "key.brass",
    cooldown: 1.5,
  });
  const noAction: Entity = { id: "x", components: { [INTERACTION_COMPONENT]: { action: "" } } };
  assert.equal(readInteractionComponent(noAction), undefined);
  const minimal: Entity = { id: "y", components: { [INTERACTION_COMPONENT]: { action: "press" } } };
  assert.deepEqual(readInteractionComponent(minimal), { action: "press" });
});

check("layout particle + interaction map through the adapter to readable components", () => {
  const fixture: RoomLayout = {
    schema: 1,
    name: "fx-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "campfire",
        placements: [
          {
            position: [0, 0, 0],
            particle: {
              effectId: "fx.smoke_soft_01",
              loop: true,
              rate: 12,
              lifetime: 2.5,
              velocity: [0, 1.2, 0],
              materialMode: "additive",
              autoPlay: true,
            },
            interaction: { action: "light-fire", prompt: "Light", cooldown: 2 },
          },
        ],
      },
    ],
    characters: [],
    lights: [],
  };
  const entity = roomLayoutToSceneDocument(fixture).entities.find(
    (candidate) => candidate.id === instanceEntityId("campfire", 0),
  );
  assert.deepEqual(entity ? readParticleEmitterComponent(entity) : undefined, {
    effectId: "fx.smoke_soft_01",
    loop: true,
    rate: 12,
    lifetime: 2.5,
    velocity: [0, 1.2, 0],
    materialMode: "additive",
    autoPlay: true,
  });
  assert.deepEqual(entity ? readInteractionComponent(entity) : undefined, {
    action: "light-fire",
    prompt: "Light",
    cooldown: 2,
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

await checkAsync("rapier builds a convex collider from hull points", async () => {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setGravity([0, 0, 0]);
  physics.setEntities([
    {
      id: "hull",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [1, 1, 1],
          isStatic: true,
          isSensor: false,
          primitives: [{ shape: "convex", size: [1, 1, 1], points: UNIT_CUBE_CORNERS }],
        },
      },
    },
    {
      id: "probe",
      components: {
        Transform: { position: [0.3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false, simulatePhysics: true },
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
    assert.ok(
      physics.contactsForEntity("probe").some((c) => c.a === "hull" || c.b === "hull"),
      "probe overlapping the convex hull should contact it",
    );
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

check("EditorSceneController applies Details edits to the multi-selection", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "controller-details-batch",
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
  const controller = new EditorSceneController({
    applyCastShadow: () => {},
    applyGroupId: () => {},
    applyVisibility: () => {},
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

  controller.selectMany([instanceSelection, characterSelection], instanceSelection);
  controller.setSelectionSimulatePhysics(true);
  assert.equal(layout.instances[0]?.placements[0]?.simulatePhysics, true);
  assert.equal(layout.characters[0]?.simulatePhysics, true);
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.simulatePhysics, undefined);
  assert.equal(layout.characters[0]?.simulatePhysics, undefined);

  controller.setSelectionCollision(false);
  assert.equal(layout.instances[0]?.placements[0]?.collision, false);
  assert.equal(layout.characters[0]?.collision, false);
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.collision, undefined);
  assert.equal(layout.characters[0]?.collision, undefined);

  controller.setSelectionCollisionPreset("physicsActor");
  assert.equal(layout.instances[0]?.placements[0]?.collisionPreset, "physicsActor");
  assert.equal(layout.characters[0]?.collisionPreset, "physicsActor");
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.collisionPreset, undefined);
  assert.equal(layout.characters[0]?.collisionPreset, undefined);

  controller.setSelectionPhysics({ linearDamping: 0.5, enableGravity: false });
  assert.deepEqual(layout.instances[0]?.placements[0]?.physics, {
    linearDamping: 0.5,
    enableGravity: false,
  });
  assert.deepEqual(layout.characters[0]?.physics, {
    linearDamping: 0.5,
    enableGravity: false,
  });
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.physics, undefined);
  assert.equal(layout.characters[0]?.physics, undefined);

  controller.setSelectionMetadata("team", "blue");
  assert.deepEqual(layout.instances[0]?.placements[0]?.metadata, { team: "blue" });
  assert.deepEqual(layout.characters[0]?.metadata, { team: "blue" });
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.metadata, undefined);
  assert.equal(layout.characters[0]?.metadata, undefined);

  // §3 Track B: optional components add (set) + undo (remove) across the
  // multi-selection, each as one command through setSelectionOptionalComponent.
  controller.setSelectionInteraction({ action: "open", cooldown: 2 });
  assert.deepEqual(layout.instances[0]?.placements[0]?.interaction, { action: "open", cooldown: 2 });
  assert.deepEqual(layout.characters[0]?.interaction, { action: "open", cooldown: 2 });
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.interaction, undefined);
  assert.equal(layout.characters[0]?.interaction, undefined);

  controller.setSelectionAudio({ clipId: "collision-chime", volume: 0.5, loop: false, spatial: false });
  assert.deepEqual(layout.instances[0]?.placements[0]?.audio, {
    clipId: "collision-chime",
    volume: 0.5,
    loop: false,
    spatial: false,
  });
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.audio, undefined);

  controller.setSelectionBehavior({ script: "spin", params: { speedDeg: 45 } });
  assert.deepEqual(layout.characters[0]?.behavior, { script: "spin", params: { speedDeg: 45 } });
  controller.undo();
  assert.equal(layout.characters[0]?.behavior, undefined);

  controller.setSelectionParticle({ effectId: "fx.smoke", velocity: [0, 1, 0] });
  assert.deepEqual(layout.instances[0]?.placements[0]?.particle, {
    effectId: "fx.smoke",
    velocity: [0, 1, 0],
  });
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.particle, undefined);
});

// Duplicate/paste deep-clone must carry the component fields (regression: audio
// was copied but behavior/particle/interaction were dropped before §3 Track B).
check("clonePlacement/cloneCharacter preserve and deep-copy component fields", () => {
  const placement: LayoutPlacement = {
    position: [1, 2, 3],
    audio: { clipId: "chime" },
    behavior: { script: "spin", params: { speedDeg: 45 } },
    particle: { effectId: "fx.smoke", velocity: [0, 1, 0] },
    interaction: { action: "open", cooldown: 2 },
  };
  const clone = clonePlacement(placement);
  assert.deepEqual(clone.audio, { clipId: "chime" });
  assert.deepEqual(clone.behavior, { script: "spin", params: { speedDeg: 45 } });
  assert.deepEqual(clone.particle, { effectId: "fx.smoke", velocity: [0, 1, 0] });
  assert.deepEqual(clone.interaction, { action: "open", cooldown: 2 });
  // Deep copy: mutating the clone's nested data leaves the source untouched.
  clone.behavior!.params!.speedDeg = 90;
  clone.particle!.velocity![1] = 5;
  assert.equal(placement.behavior?.params?.speedDeg, 45);
  assert.equal(placement.particle?.velocity?.[1], 1);

  const character: LayoutCharacter = {
    assetId: "npc",
    position: [0, 0, 0],
    behavior: { script: "interact" },
    interaction: { action: "talk" },
  };
  const characterClone = cloneCharacter(character);
  assert.deepEqual(characterClone.behavior, { script: "interact" });
  assert.deepEqual(characterClone.interaction, { action: "talk" });
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
    materialSlot: "starter-mat-brick-clay-old",
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
  assert.equal(placement.materialSlot, "starter-mat-brick-clay-old");
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

// G6 gameplay primitives: a `sensor` placement flag yields a non-blocking
// trigger collider, and the `goal-reached` behavior fires once on the first
// contact (only the player can touch a static sensor), playing its cue and
// signalling the shell. Verified here against crafted fixtures, independent of
// any particular layout.
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

const UNIT_CUBE_CORNERS: [number, number, number][] = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5],
];

check("adapter keeps convex hull points and derives their AABB", () => {
  const convexLayout: RoomLayout = {
    schema: 1,
    name: "convex-fixture",
    loadGroups: [],
    instances: [{ assetId: "rock", placements: [{ position: [0, 0, 0], scale: 2 }] }],
    characters: [],
    lights: [],
  };
  const defs = new Map<string, AssetCollisionDef>([
    [
      "rock",
      {
        primitives: [{ shape: "convex", size: [1, 1, 1], points: UNIT_CUBE_CORNERS }],
        complexity: "projectDefault",
        preset: "blockAll",
      },
    ],
  ]);
  const doc = roomLayoutToSceneDocument(convexLayout, { collisionDefs: defs });
  const entity = doc.entities.find((e) => e.id === instanceEntityId("rock", 0));
  const primitive = (entity ? readColliderComponent(entity) : undefined)?.primitives?.[0];
  assert.equal(primitive?.shape, "convex");
  assert.equal(primitive?.points?.length, 8);
  // Placement scale 2 is baked into both the points and the derived AABB size.
  assert.deepEqual(primitive?.points?.[6], [1, 1, 1]);
  assert.deepEqual(primitive?.size, [2, 2, 2]);
});

check("built-in Add Actor shapes provide shape-specific collision defs", () => {
  assert.deepEqual(shapeAssetCollisionDef("shape:cube")?.primitives, [
    { shape: "box", size: [SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE] },
  ]);
  assert.deepEqual(shapeAssetCollisionDef("shape:sphere")?.primitives, [
    { shape: "sphere", size: [SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE] },
  ]);
  assert.deepEqual(shapeAssetCollisionDef("shape:cylinder")?.primitives, [
    { shape: "cylinder", size: [SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE] },
  ]);
  assert.deepEqual(shapeAssetCollisionDef("shape:cone")?.primitives, [
    { shape: "cone", size: [SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE] },
  ]);
  assert.deepEqual(shapeAssetCollisionDef("shape:plane")?.primitives, [
    { shape: "box", size: [SHAPE_PLANE_SIZE, SHAPE_PLANE_COLLISION_THICKNESS, SHAPE_PLANE_SIZE] },
  ]);
  assert.equal(shapeAssetCollisionDef("chair"), null);
});

check("adapter uses Add Actor sphere collision instead of an auto box", () => {
  const shapeLayout: RoomLayout = {
    schema: 1,
    name: "shape-collision-fixture",
    loadGroups: [],
    instances: [{ assetId: "shape:sphere", placements: [{ position: [0, 0, 0], scale: 2 }] }],
    characters: [],
    lights: [],
  };
  const def = shapeAssetCollisionDef("shape:sphere");
  assert.ok(def);
  const doc = roomLayoutToSceneDocument(shapeLayout, {
    collisionDefs: new Map([["shape:sphere", def]]),
  });
  const entity = doc.entities.find((e) => e.id === instanceEntityId("shape:sphere", 0));
  const collider = entity ? readColliderComponent(entity) : undefined;
  assert.equal(collider?.shape, "box");
  assert.equal(collider?.primitives?.[0]?.shape, "sphere");
  assert.deepEqual(collider?.primitives?.[0]?.size, [1, 1, 1]);
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

// §3 Interaction runtime: the pure trigger core decides fire/cooldown; the
// `interact` behavior drives it from physics sensor contacts + the authored
// InteractionComponent, reusing the goal-reached sensor pattern.
check("stepInteractionTrigger: fires on a fresh enter, not while held, re-fires on re-enter", () => {
  let state = initialInteractionState();
  let r = stepInteractionTrigger(state, { overlapping: false, enabled: true, cooldown: 0, dt: 0.016 });
  assert.equal(r.fire, false);
  state = r.state;
  // Fresh enter fires.
  r = stepInteractionTrigger(state, { overlapping: true, enabled: true, cooldown: 0, dt: 0.016 });
  assert.equal(r.fire, true);
  state = r.state;
  // Held overlap does not re-fire.
  r = stepInteractionTrigger(state, { overlapping: true, enabled: true, cooldown: 0, dt: 0.016 });
  assert.equal(r.fire, false);
  state = r.state;
  // Leave, then re-enter with no cooldown: fires again.
  state = stepInteractionTrigger(state, { overlapping: false, enabled: true, cooldown: 0, dt: 0.016 }).state;
  r = stepInteractionTrigger(state, { overlapping: true, enabled: true, cooldown: 0, dt: 0.016 });
  assert.equal(r.fire, true);
});

check("stepInteractionTrigger: disabled never fires; cooldown blocks re-fire until it decays", () => {
  // Disabled: a fresh enter does not fire.
  assert.equal(
    stepInteractionTrigger(initialInteractionState(), {
      overlapping: true,
      enabled: false,
      cooldown: 0,
      dt: 0.016,
    }).fire,
    false,
  );

  // Fire with a 1s cooldown.
  let r = stepInteractionTrigger(initialInteractionState(), {
    overlapping: true,
    enabled: true,
    cooldown: 1,
    dt: 0.016,
  });
  assert.equal(r.fire, true);
  assert.ok(r.state.cooldownRemaining > 0);
  // Leave (cooldown decays partway).
  let state = stepInteractionTrigger(r.state, { overlapping: false, enabled: true, cooldown: 1, dt: 0.5 }).state;
  // Re-enter before cooldown elapses: blocked.
  r = stepInteractionTrigger(state, { overlapping: true, enabled: true, cooldown: 1, dt: 0.1 });
  assert.equal(r.fire, false);
  // Leave again and let the rest elapse, then re-enter: fires.
  state = stepInteractionTrigger(r.state, { overlapping: false, enabled: true, cooldown: 1, dt: 1 }).state;
  assert.equal(state.cooldownRemaining, 0);
  assert.equal(
    stepInteractionTrigger(state, { overlapping: true, enabled: true, cooldown: 1, dt: 0.016 }).fire,
    true,
  );
});

check("interact behavior: fires the action + cue on a sensor enter, not while held", () => {
  const fired: Array<{ id: string; action: string }> = [];
  const registry = createBehaviorRegistry({
    onInteraction: (id, action) => fired.push({ id, action }),
  });
  const physics = new PhysicsSubsystem();
  const audio = new AudioSubsystem();
  const lever: Entity = {
    id: "lever:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      Behavior: { scriptId: "interact" },
      Interaction: { action: "pull-lever", prompt: "Pull" },
      Audio: { clipId: "collision-chime", volume: 0.5, loop: false, spatial: false },
    },
  };
  const player: Entity = {
    id: "player:0",
    components: {
      Transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
    },
  };
  physics.setEntities([lever, player]);
  const behavior = new BehaviorSubsystem(registry, new ActionMap({}), () => undefined, physics, audio);
  behavior.setEntities([lever, player]);
  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.registerSubsystem(behavior);
  app.registerSubsystem(audio);

  // A sensor never blocks movement, and far apart there is no contact.
  assert.equal(physics.staticBlockerAabbs().length, 0);
  app.update(0.016);
  assert.deepEqual(fired, []);

  // Enter the sensor and tick twice: it fires exactly once.
  physics.setEntityTransform("player:0", { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  app.update(0.016);
  app.update(0.016);
  assert.deepEqual(fired, [{ id: "lever:0", action: "pull-lever" }]);
  assert.deepEqual(audio.playedRequests(), [
    { clipId: "collision-chime", volume: 0.5, loop: false, spatial: false },
  ]);
});

// playground.json is now a free-editing sandbox scene (no pinned content), so it
// is intentionally not asserted here. Save-validator round-trip coverage lives on
// the curated render-test-room layout above ("save validator round-trips the
// saved layout").

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
  /** Look deltas to hand out one-per-call (e.g. simulate right-drag turns). */
  lookDeltas?: { dx: number; dy: number }[];
}): { context: GameModeContext; mixers: AnimationMixer[]; cameraControlled: () => boolean } {
  let controlled = false;
  const mixers: AnimationMixer[] = [];
  const locomotion = options.locomotion ?? new Map<string, LocomotionInput>();
  const lookDeltas = options.lookDeltas ? [...options.lookDeltas] : [];
  const context: GameModeContext = {
    camera: options.camera ?? new PerspectiveCamera(),
    actions: options.actions ?? new ActionMap(),
    characters: options.characters ?? [],
    getLocomotion: (id) => locomotion.get(id),
    addMixer: (mixer) => mixers.push(mixer),
    markCameraControlled: () => {
      controlled = true;
    },
    consumeLookDelta: () => lookDeltas.shift() ?? { dx: 0, dy: 0 },
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

check("input-move behavior: an unpossessed character ignores movement input", () => {
  const actions = new ActionMap({ KeyW: "move-forward" });
  actions.handleDown("KeyW");
  actions.advance();
  const entity: Entity = {
    id: "character:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Behavior: { scriptId: "input-move", params: { speed: 5 } },
    },
  };

  // Not the possessed pawn -> stays put.
  let unpossessed: { position: number[] } | null = null;
  const idle = new BehaviorSubsystem(
    createBehaviorRegistry({ isPlayerControlled: () => false }),
    actions,
    (_id, transform) => {
      unpossessed = transform;
    },
  );
  idle.setEntities([entity]);
  idle.update({ deltaSeconds: 0.5, elapsedSeconds: 0.5, frame: 1 });
  assert.deepEqual(unpossessed!.position, [0, 0, 0]);

  // The possessed pawn moves on the same input.
  let possessed: { position: number[] } | null = null;
  const driven = new BehaviorSubsystem(
    createBehaviorRegistry({ isPlayerControlled: () => true }),
    actions,
    (_id, transform) => {
      possessed = transform;
    },
  );
  driven.setEntities([entity]);
  driven.update({ deltaSeconds: 0.5, elapsedSeconds: 0.5, frame: 1 });
  assert.notDeepEqual(possessed!.position, [0, 0, 0]);
});

check("applyMouseLook turns with the pointer delta and clamps pitch", () => {
  const turned = applyMouseLook({ yaw: 0, pitch: 0 }, 100, 0, 0.01, 1);
  assert.ok(Math.abs(turned.yaw - -1) < 1e-9);
  assert.equal(applyMouseLook({ yaw: 0, pitch: 0 }, 0, -1000, 0.01, 1).pitch, 1);
  assert.equal(applyMouseLook({ yaw: 0, pitch: 0 }, 0, 1000, 0.01, 1).pitch, -1);
});

check("look angles round-trip through a forward direction", () => {
  const angles = { yaw: 0.6, pitch: -0.3 };
  const dir = forwardFromLookAngles(angles);
  const back = lookAnglesFromForward(dir.x, dir.y, dir.z);
  assert.ok(Math.abs(back.yaw - angles.yaw) < 1e-9, `yaw ${back.yaw}`);
  assert.ok(Math.abs(back.pitch - angles.pitch) < 1e-9, `pitch ${back.pitch}`);
});

check("default camera mode turns the view on a right-drag look delta", () => {
  const camera = new PerspectiveCamera();
  const { context } = makeGameModeContext({ camera, lookDeltas: [{ dx: 100, dy: 0 }] });
  const session = defaultCameraGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  session.update(0.016);
  const dir = new Vector3();
  camera.getWorldDirection(dir);
  assert.ok(dir.x > 0.1, `expected the camera to yaw right, got x=${dir.x}`);
});

check("player start marker is a procedural asset excluded from manifest loading", () => {
  assert.ok(isPlayerStartAssetId(PLAYER_START_ASSET_ID));
  assert.equal(isPlayerStartAssetId("furniture.sofa"), false);
  assert.ok(isProceduralAssetId(PLAYER_START_ASSET_ID));
  assert.ok(isProceduralAssetId("shape:cube"));
  assert.equal(isProceduralAssetId("furniture.sofa"), false);
  // The dispatcher builds a model for the marker but not for a manifest asset.
  assert.ok(createProceduralAssetGltf(PLAYER_START_ASSET_ID)?.scene);
  assert.equal(createProceduralAssetGltf("furniture.sofa"), null);
  const layout: RoomLayout = {
    schema: 1,
    name: "marker",
    loadGroups: [],
    instances: [
      { assetId: PLAYER_START_ASSET_ID, placements: [{ position: [0, 0, 0] }] },
      { assetId: "furniture.sofa", placements: [{ position: [0, 0, 0] }] },
    ],
    characters: [],
    lights: [],
  };
  assert.deepEqual(sceneModelAssetIds(layout), ["furniture.sofa"]);
});

check("computePlayerStartSpawn: a marker sets the player's spawn position and yaw", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "spawn",
    loadGroups: [],
    instances: [
      { assetId: PLAYER_START_ASSET_ID, placements: [{ position: [3, 0, -2], rotation: [0, 90, 0] }] },
    ],
    characters: [{ assetId: "hero", position: [9, 9, 9], behavior: { script: "input-move" } }],
    lights: [],
  };
  assert.deepEqual(computePlayerStartSpawn(layout), {
    characterIndex: 0,
    position: [3, 0, -2],
    yawDeg: 90,
  });
});

check("computePlayerStartSpawn: no marker spawns at the origin and keeps facing", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "spawn",
    loadGroups: [],
    instances: [],
    characters: [{ assetId: "hero", position: [9, 9, 9], behavior: { script: "input-move" } }],
    lights: [],
  };
  assert.deepEqual(computePlayerStartSpawn(layout), {
    characterIndex: 0,
    position: [0, 0, 0],
    yawDeg: null,
  });
});

check("computePlayerStartSpawn: prefers a tagged player and is null without any", () => {
  const tagged: RoomLayout = {
    schema: 1,
    name: "spawn",
    loadGroups: [],
    instances: [],
    characters: [
      { assetId: "a", position: [0, 0, 0], behavior: { script: "input-move" } },
      { assetId: "b", position: [0, 0, 0], metadata: { player: true } },
    ],
    lights: [],
  };
  assert.equal(computePlayerStartSpawn(tagged)?.characterIndex, 1);
  const none: RoomLayout = {
    schema: 1,
    name: "spawn",
    loadGroups: [],
    instances: [],
    characters: [],
    lights: [],
  };
  assert.equal(computePlayerStartSpawn(none), null);
  assert.equal(TPS_GAME_MODE_ID, "forge.tpsCharacter");
});

check("hasPlayerCharacter: true for tagged or input-move, false otherwise", () => {
  const base = { schema: 1 as const, name: "p", loadGroups: [], instances: [], lights: [] };
  assert.equal(
    hasPlayerCharacter({
      ...base,
      characters: [{ assetId: "a", position: [0, 0, 0], metadata: { player: true } }],
    }),
    true,
  );
  assert.equal(
    hasPlayerCharacter({
      ...base,
      characters: [{ assetId: "a", position: [0, 0, 0], behavior: { script: "input-move" } }],
    }),
    true,
  );
  assert.equal(
    hasPlayerCharacter({
      ...base,
      characters: [{ assetId: "a", position: [0, 0, 0], behavior: { script: "spin" } }],
    }),
    false,
  );
  assert.equal(hasPlayerCharacter({ ...base, characters: [] }), false);
});

check("findPlayerStartTransform: reads the first marker's position/yaw, else null", () => {
  const base = { schema: 1 as const, name: "p", loadGroups: [], characters: [], lights: [] };
  assert.deepEqual(
    findPlayerStartTransform({
      ...base,
      instances: [
        { assetId: PLAYER_START_ASSET_ID, placements: [{ position: [3, 0, -2], rotation: [0, 90, 0] }] },
      ],
    }),
    { position: [3, 0, -2], yawDeg: 90 },
  );
  assert.equal(findPlayerStartTransform({ ...base, instances: [] }), null);
});

check("createDefaultPlayerCharacter: tagged input-move pawn placed at the spawn", () => {
  const character = createDefaultPlayerCharacter(
    { assetId: "character-a", scale: 0.3, speed: 3 },
    [3, 0, -2],
    90,
  );
  assert.equal(character.assetId, "character-a");
  assert.deepEqual(character.position, [3, 0, -2]);
  assert.deepEqual(character.rotation, [0, 90, 0]);
  assert.equal(character.scale, 0.3);
  assert.equal(character.metadata?.player, true);
  assert.equal(character.behavior?.script, "input-move");
  assert.equal(character.behavior?.params?.speed, 3);
  // The synthetic pawn is itself a resolvable player, so the TPS spawn path and
  // possession both pick it up once appended to the layout.
  const layout: RoomLayout = {
    schema: 1,
    name: "p",
    loadGroups: [],
    instances: [],
    characters: [character],
    lights: [],
  };
  assert.equal(hasPlayerCharacter(layout), true);
  assert.equal(computePlayerStartSpawn(layout)?.characterIndex, 0);
});

check("createDefaultPlayerCharacter: null yaw keeps a zero facing, defaults scale/speed", () => {
  const character = createDefaultPlayerCharacter({ assetId: "character-a" }, [0, 0, 0], null);
  assert.deepEqual(character.rotation, [0, 0, 0]);
  assert.equal(character.scale, 1);
  assert.equal(character.behavior?.params?.speed, 3);
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
check("collision groups pack membership/filter and gate ignored channels", () => {
  const blockAll = collisionInteractionGroups(resolveCollisionProfile("blockAll"));
  assert.equal(blockAll >>> 16, COLLISION_OBJECT_CHANNEL_BITS.worldStatic);
  assert.equal(blockAll & 0xffff, 0b11111); // blocks every object channel

  const ignoresPawn = collisionInteractionGroups(
    resolveCollisionProfile("custom", { objectType: "pawn", responses: { pawn: "ignore" } }),
  );
  const pawn = collisionInteractionGroups(resolveCollisionProfile("pawn"));
  // The custom object filters out the pawn channel, so it skips a pawn object…
  assert.equal(interactionGroupsInteract(ignoresPawn, pawn), false);
  // …but still interacts with a world-static block-all object, and an unset
  // (undefined) groups value interacts with everything.
  assert.equal(interactionGroupsInteract(ignoresPawn, blockAll), true);
  assert.equal(interactionGroupsInteract(undefined, ignoresPawn), true);
});

check("collision groups suppress placeholder contacts across filtered channels", () => {
  const physics = new PhysicsSubsystem();
  const wallGroups = collisionInteractionGroups(
    resolveCollisionProfile("custom", { objectType: "worldStatic", responses: { pawn: "ignore" } }),
  );
  const pawnGroups = collisionInteractionGroups(resolveCollisionProfile("pawn"));
  physics.setEntities([
    {
      id: "wall",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: false, collisionGroups: wallGroups },
      },
    },
    {
      id: "pawn",
      components: {
        Transform: { position: [0.3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false, collisionGroups: pawnGroups },
      },
    },
  ]);
  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.update(0.016);
  assert.deepEqual(physics.contactsForEntity("pawn"), []);
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
      { shape: "cylinder", size: [1, 2, 1] },
      { shape: "cone", size: [1, 2, 1] },
    ],
    complexity: "simpleAndComplex",
    preset: "blockAll",
    doubleSided: true,
  });
  assert.equal((def.primitives as unknown[]).length, 4);
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
check("placement validator allowlists particle + interaction and rejects bad ones", () => {
  const placement = validatePlacement({
    position: [0, 0, 0],
    particle: {
      effectId: "fx.smoke_soft_01",
      loop: true,
      rate: 12,
      velocity: [0, 1.2, 0],
      materialMode: "additive",
    },
    interaction: { action: "open", prompt: "Open", cooldown: 1.5 },
  });
  assert.deepEqual(placement.particle, {
    effectId: "fx.smoke_soft_01",
    loop: true,
    rate: 12,
    velocity: [0, 1.2, 0],
    materialMode: "additive",
  });
  assert.deepEqual(placement.interaction, { action: "open", prompt: "Open", cooldown: 1.5 });
  // Empty effectId, out-of-set materialMode, and empty action are rejected.
  assert.throws(() => validatePlacement({ position: [0, 0, 0], particle: { effectId: "" } }));
  assert.throws(() =>
    validatePlacement({ position: [0, 0, 0], particle: { effectId: "fx.x", materialMode: "neon" } }),
  );
  assert.throws(() => validatePlacement({ position: [0, 0, 0], interaction: { action: "" } }));
  // Absent stays absent.
  assert.equal(validatePlacement({ position: [0, 0, 0] }).particle, undefined);
  assert.equal(validatePlacement({ position: [0, 0, 0] }).interaction, undefined);
});
check("placement validator allowlists audio.autoPlay and rejects a non-boolean", () => {
  const placement = validatePlacement({
    position: [0, 0, 0],
    audio: { clipId: "starter-snd-ui-click", autoPlay: true, loop: true },
  });
  assert.deepEqual(placement.audio, {
    clipId: "starter-snd-ui-click",
    loop: true,
    autoPlay: true,
  });
  assert.throws(() =>
    validatePlacement({ position: [0, 0, 0], audio: { clipId: "x", autoPlay: "yes" } }),
  );
});
check("parseEffectDefinition reads a schema-1 effect and rejects bad input", () => {
  assert.deepEqual(
    parseEffectDefinition({
      schema: 1,
      effectId: "starter-fx-smoke-puff",
      name: "Smoke Puff Effect",
      loop: false,
      rate: 18,
      lifetime: 0.8,
      startSize: 0.12,
      endSize: 0.8,
      velocity: [0, 1, 0],
      spread: 0.4,
      materialMode: "alpha",
      color: "#a7a7a7",
    }),
    {
      effectId: "starter-fx-smoke-puff",
      name: "Smoke Puff Effect",
      loop: false,
      rate: 18,
      lifetime: 0.8,
      startSize: 0.12,
      endSize: 0.8,
      velocity: [0, 1, 0],
      spread: 0.4,
      materialMode: "alpha",
      color: "#a7a7a7",
    },
  );
  // Wrong schema or empty effectId → null.
  assert.equal(parseEffectDefinition({ schema: 2, effectId: "x" }), null);
  assert.equal(parseEffectDefinition({ schema: 1, effectId: "" }), null);
  // Unknown materialMode falls back to alpha; a malformed color falls back to white.
  const fallback = parseEffectDefinition({
    schema: 1,
    effectId: "fx",
    materialMode: "neon",
    color: "red",
  });
  assert.equal(fallback?.materialMode, "alpha");
  assert.equal(fallback?.color, "#ffffff");
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

check("material slots save payload requires a .materials.json path", () => {
  const payload = validateSaveMaterialSlotsPayload({
    path: "assets/props/chair.materials.json",
    materialSlots: { schema: 1, slots: ["starter-mat-brick-clay-old"] },
  });
  assert.equal(payload.path, "assets/props/chair.materials.json");
  assert.deepEqual(payload.materialSlots, {
    schema: 1,
    slots: ["starter-mat-brick-clay-old"],
  });
  assert.throws(() =>
    validateSaveMaterialSlotsPayload({ path: "assets/props/chair.json", materialSlots: { slots: [] } }),
  );
  assert.throws(() =>
    validateSaveMaterialSlotsPayload({ path: "../secret.materials.json", materialSlots: { slots: [] } }),
  );
  assert.throws(() =>
    validateSaveMaterialSlotsPayload({
      path: "assets/props/chair.materials.json",
      materialSlots: { slots: [false] },
    }),
  );
});

check("material save payload requires a material path and canonical fields", () => {
  const payload = validateSaveMaterialPayload({
    path: "assets/materials/Stone.material.json",
    material: {
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Stone",
      baseColor: "#808080",
      baseColorTexture: "tex-stone-d",
      normalTexture: null,
      maskTexture: "tex-stone-m",
      roughness: 0.72,
      metalness: 0,
      opacity: 1,
      alphaMode: "opaque",
      alphaTest: 0.5,
      side: "front",
      emissive: "#000000",
      emissiveIntensity: 0,
    },
  });
  assert.equal(payload.path, "assets/materials/Stone.material.json");
  assert.deepEqual(payload.material, {
    schema: 1,
    type: "material",
    materialType: "standard",
    name: "Stone",
    baseColor: "#808080",
    baseColorTexture: "tex-stone-d",
    normalTexture: null,
    maskTexture: "tex-stone-m",
    roughness: 0.72,
    metalness: 0,
    opacity: 1,
    alphaMode: "opaque",
    alphaTest: 0.5,
    side: "front",
    emissive: "#000000",
    emissiveIntensity: 0,
  });
  assert.throws(() =>
    validateSaveMaterialPayload({ path: "assets/materials/Stone.json", material: {} }),
  );
  assert.throws(() =>
    validateSaveMaterialPayload({ path: "../secret.material.json", material: {} }),
  );
  assert.throws(() =>
    validateForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Bad",
      baseColor: "red",
    }),
  );
  assert.throws(() =>
    validateForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Bad",
      roughness: 2,
    }),
  );
});

check("starter material assets normalize to the canonical material shape", () => {
  const materialDir = "public/assets/starter-content/Materials";
  for (const fileName of readdirSync(materialDir)) {
    if (!fileName.endsWith(".material.json")) continue;
    const data = JSON.parse(readFileSync(`${materialDir}/${fileName}`, "utf8")) as unknown;
    const material = normalizeForgeMaterialDef(data, fileName.replace(/\.material\.json$/, ""));
    assert.equal(material.schema, 1);
    assert.equal(material.type, "material");
    assert.ok(material.name.length > 0);
    assert.ok(material.roughness >= 0 && material.roughness <= 1);
    assert.ok(material.metalness >= 0 && material.metalness <= 1);
    assert.ok(material.opacity >= 0 && material.opacity <= 1);
  }
});

check("forge material mapping creates matching Three material types and fields", () => {
  const standard = createThreeMaterialFromForgeDef(
    normalizeForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Preview Glass",
      baseColor: "#123456",
      roughness: 0.25,
      metalness: 0.75,
      opacity: 0.4,
      alphaMode: "blend",
      alphaTest: 0.9,
      side: "double",
      emissive: "#101010",
      emissiveIntensity: 2,
    }),
  );
  assert.ok(standard instanceof MeshStandardMaterial);
  assert.equal(standard.name, "Preview Glass");
  assert.equal(standard.color.getHexString(), "123456");
  assert.equal(standard.roughness, 0.25);
  assert.equal(standard.metalness, 0.75);
  assert.equal(standard.transparent, true);
  assert.equal(standard.depthWrite, false);
  assert.equal(standard.opacity, 0.4);
  assert.equal(standard.alphaTest, 0);
  assert.equal(standard.side, DoubleSide);
  assert.equal(standard.emissive.getHexString(), "101010");
  assert.equal(standard.emissiveIntensity, 2);
  standard.dispose();

  const baseColorTexture = new Texture();
  const normalTexture = new Texture();
  const textured = createThreeMaterialFromForgeDef(
    normalizeForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Textured",
      baseColorTexture: "albedo",
      normalTexture: "normal",
    }),
    { baseColorTexture, normalTexture },
  );
  assert.ok(textured instanceof MeshStandardMaterial);
  assert.equal(textured.map, baseColorTexture);
  assert.equal(textured.normalMap, normalTexture);
  assert.equal(baseColorTexture.colorSpace, SRGBColorSpace);
  assert.equal(baseColorTexture.wrapS, RepeatWrapping);
  assert.equal(baseColorTexture.wrapT, RepeatWrapping);
  assert.equal(normalTexture.wrapS, RepeatWrapping);
  assert.equal(normalTexture.wrapT, RepeatWrapping);
  textured.dispose();

  const basic = createThreeMaterialFromForgeDef(
    normalizeForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "basic",
      name: "Unlit",
      baseColor: "#ff00aa",
      alphaMode: "mask",
      alphaTest: 0.33,
      side: "back",
    }),
  );
  assert.ok(basic instanceof MeshBasicMaterial);
  assert.equal(basic.name, "Unlit");
  assert.equal(basic.color.getHexString(), "ff00aa");
  assert.equal(basic.transparent, false);
  assert.equal(basic.depthWrite, true);
  assert.equal(basic.alphaTest, 0.33);
  assert.equal(basic.side, BackSide);
  basic.dispose();
});

check("uvw save payload requires a .uvw.json path and valid map type", () => {
  const payload = validateSaveUvwPayload({
    path: "assets/props/chair.uvw.json",
    uvw: {
      schema: 1,
      mapType: "box",
      position: [0, 1, 0],
      rotation: [0, 45, 0],
      scale: [2, 3, 4],
    },
  });
  assert.equal(payload.path, "assets/props/chair.uvw.json");
  assert.deepEqual(payload.uvw, {
    schema: 1,
    mapType: "box",
    position: [0, 1, 0],
    rotation: [0, 45, 0],
    scale: [2, 3, 4],
  });
  assert.throws(() =>
    validateSaveUvwPayload({ path: "assets/props/chair.json", uvw: {} }),
  );
  assert.throws(() =>
    validateSaveUvwPayload({ path: "../secret.uvw.json", uvw: {} }),
  );
  assert.throws(() =>
    validateSaveUvwPayload({
      path: "assets/props/chair.uvw.json",
      uvw: { mapType: "unwrap", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    }),
  );
});

check("content-new payload validates kind/name and rejects unsafe names", () => {
  const level = validateContentNewPayload({ kind: "level", dir: "assets/levels", name: " Giris " });
  assert.equal(level.kind, "level");
  assert.equal(level.name, "Giris");
  // Turkish letters are allowed.
  assert.equal(validateContentNewPayload({ kind: "material", dir: "", name: "Işık" }).name, "Işık");
  assert.equal(
    validateContentNewPayload({
      kind: "material",
      dir: "",
      name: "Metal",
      materialPreset: "metal",
    }).materialPreset,
    "metal",
  );
  assert.equal(
    validateContentNewPayload({
      kind: "material",
      dir: "",
      name: "Fallback",
      materialPreset: "unknown",
    }).materialPreset,
    "standard",
  );
  assert.throws(() => validateContentNewPayload({ kind: "bogus", dir: "", name: "x" }));
  assert.throws(() => validateContentNewPayload({ kind: "level", dir: "", name: "" }));
  assert.throws(() => validateContentNewPayload({ kind: "level", dir: "", name: "a/b" }));
  assert.throws(() => validateContentNewPayload({ kind: "level", dir: "", name: ".." }));
  assert.throws(() => validateContentNewPayload({ kind: "level", dir: "../escape", name: "x" }));
});
check("content-new resolves to typed stub files and folders", () => {
  const folder = resolveContentNewFile({ kind: "folder", dir: "assets", name: "Props" });
  assert.equal(folder.path, "assets/Props");
  assert.equal(folder.content, null);

  const material = resolveContentNewFile({ kind: "material", dir: "assets/materials", name: "Tas" });
  assert.equal(material.path, "assets/materials/Tas.material.json");
  assert.deepEqual(JSON.parse(material.content ?? ""), {
    schema: 1,
    type: "material",
    materialType: "standard",
    name: "Tas",
    baseColor: "#ffffff",
    baseColorTexture: null,
    normalTexture: null,
    maskTexture: null,
    roughness: 0.8,
    metalness: 0,
    opacity: 1,
    alphaMode: "opaque",
    alphaTest: 0.5,
    side: "front",
    emissive: "#000000",
    emissiveIntensity: 0,
  });
  const metal = resolveContentNewFile({
    kind: "material",
    dir: "assets/materials",
    name: "Steel",
    materialPreset: "metal",
  });
  assert.equal(metal.path, "assets/materials/Steel.material.json");
  assert.deepEqual(JSON.parse(metal.content ?? ""), {
    schema: 1,
    type: "material",
    materialType: "standard",
    name: "Steel",
    baseColor: "#b9c0c7",
    baseColorTexture: null,
    normalTexture: null,
    maskTexture: null,
    roughness: 0.3,
    metalness: 1,
    opacity: 1,
    alphaMode: "opaque",
    alphaTest: 0.5,
    side: "front",
    emissive: "#000000",
    emissiveIntensity: 0,
  });

  const level = resolveContentNewFile({ kind: "level", dir: "", name: "Main" });
  assert.equal(level.path, "Main.level.json");
  assert.deepEqual(JSON.parse(level.content ?? ""), {
    schema: 1,
    name: "Main",
    loadGroups: [],
    instances: [],
    characters: [],
  });

  const particle = resolveContentNewFile({ kind: "particle", dir: "assets/effects", name: "Dust Hit" });
  assert.equal(particle.path, "assets/effects/Dust Hit.effect.json");
  assert.equal(parseEffectDefinition(JSON.parse(particle.content ?? ""))?.effectId, "dust-hit");
});

check("content-new 'script' creates a `.actor.json` Actor Script seeded with the parent class", () => {
  const door = resolveContentNewFile({
    kind: "script",
    dir: "assets/blueprints",
    name: "DoorBP",
    parentClass: "pawn",
  });
  assert.equal(door.path, "assets/blueprints/DoorBP.actor.json");
  const def = JSON.parse(door.content ?? "");
  assert.equal(def.type, "actor");
  assert.equal(def.parentClass, "pawn");
  assert.equal(def.name, "DoorBP");
  // Always seeded with a root Transform so the component tree has an anchor.
  assert.deepEqual(def.components, [{ id: "root", component: "Transform", props: {} }]);
  assert.deepEqual(def.eventBindings, []);
  assert.deepEqual(def.variables, []);

  // No parent class picked falls back to "actor".
  const plain = resolveContentNewFile({ kind: "script", dir: "", name: "Thing" });
  assert.equal(JSON.parse(plain.content ?? "").parentClass, "actor");
  // The payload validator defaults the parent class for scripts too.
  assert.equal(
    validateContentNewPayload({ kind: "script", dir: "", name: "X" }).parentClass,
    "actor",
  );
});

check("content-rename validates payload and rejects extensions / unsafe names", () => {
  const payload = validateContentRenamePayload({ path: "assets/props/chair.glb", name: " Sofa " });
  assert.equal(payload.path, "assets/props/chair.glb");
  assert.equal(payload.name, "Sofa");
  // Turkish letters are allowed in the base name.
  assert.equal(
    validateContentRenamePayload({ path: "assets/a.glb", name: "Işık" }).name,
    "Işık",
  );
  assert.throws(() => validateContentRenamePayload({ path: "assets/a.glb", name: "Sofa.glb" }));
  assert.throws(() => validateContentRenamePayload({ path: "assets/a.glb", name: "a/b" }));
  assert.throws(() => validateContentRenamePayload({ path: "assets/a.glb", name: "" }));
  assert.throws(() => validateContentRenamePayload({ path: "", name: "Sofa" }));
  assert.throws(() => validateContentRenamePayload({ path: "../escape.glb", name: "Sofa" }));
});

check("content-rename target keeps the extension chain and source directory", () => {
  // Simple single extension.
  const glb = resolveContentRenameTarget({ path: "assets/props/chair.glb", name: "Sofa" });
  assert.equal(glb.to, "assets/props/Sofa.glb");
  assert.equal(glb.ext, ".glb");
  // Compound asset extension is preserved (only the base changes).
  const material = resolveContentRenameTarget({
    path: "assets/Materials/Ground.material.json",
    name: "Stone",
  });
  assert.equal(material.to, "assets/Materials/Stone.material.json");
  assert.equal(material.ext, ".material.json");
  // Extensionless file at the root.
  const bare = resolveContentRenameTarget({ path: "README", name: "Notes" });
  assert.equal(bare.to, "Notes");
  assert.equal(bare.ext, "");
});

check("content-delete validates payload and normalizes the path", () => {
  assert.equal(
    validateContentDeletePayload({ path: "/assets/props/chair.glb/" }).path,
    "assets/props/chair.glb",
  );
  assert.throws(() => validateContentDeletePayload({ path: "" }));
  assert.throws(() => validateContentDeletePayload({ path: "../escape.glb" }));
  assert.throws(() => validateContentDeletePayload({ path: 42 }));
});

check("normalizeActorScriptDef coerces malformed/legacy data to a valid class", () => {
  // Legacy stub (old `type:"script"` with a dead graph) → empty actor class.
  const legacy = normalizeActorScriptDef({ schema: 1, type: "script", name: "Old", graph: {} });
  assert.equal(legacy.type, "actor");
  assert.equal(legacy.parentClass, "actor");
  assert.equal(legacy.name, "Old");
  assert.equal(legacy.components.length, 1);
  assert.equal(legacy.components[0]?.component, "Transform");

  // Junk drops out; valid entries survive; root Transform is injected.
  const messy = normalizeActorScriptDef({
    name: "Mix",
    parentClass: "character",
    variables: [
      { key: "hp", label: "Health", type: "number", default: 100 },
      { key: "", type: "number" }, // dropped (empty key)
      { key: "bad", type: "bogus" }, // dropped (bad type)
    ],
    components: [
      { id: "mesh", parent: "root", component: "MeshRenderer", props: { assetId: "door" } },
      { component: "NotAThing", props: {} }, // dropped (bad kind)
    ],
    eventBindings: [
      { event: "tick", scriptId: "spin", params: { speedDeg: 90 } },
      { event: "tick", scriptId: "" }, // dropped (empty id)
      { event: "bogus", scriptId: "x" }, // dropped (bad event)
    ],
  });
  assert.equal(messy.parentClass, "character");
  assert.equal(messy.variables.length, 1);
  assert.equal(messy.variables[0]?.key, "hp");
  // root Transform prepended because none of the authored nodes are roots.
  assert.equal(messy.components[0]?.component, "Transform");
  assert.equal(messy.components.some((node) => node.component === "MeshRenderer"), true);
  assert.equal(messy.eventBindings.length, 1);
  assert.deepEqual(messy.eventBindings[0], {
    event: "tick",
    scriptId: "spin",
    params: { speedDeg: 90 },
  });
});

check("actor save payload requires a .actor.json path and normalizes the body", () => {
  const payload = validateSaveActorPayload({
    path: "assets/blueprints/DoorBP.actor.json",
    actor: defaultActorScriptDef("DoorBP", "pawn"),
  });
  assert.equal(payload.path, "assets/blueprints/DoorBP.actor.json");
  assert.equal(payload.actor.type, "actor");
  assert.equal(payload.actor.parentClass, "pawn");
  assert.throws(() =>
    validateSaveActorPayload({ path: "assets/blueprints/DoorBP.json", actor: {} }),
  );
  assert.throws(() =>
    validateSaveActorPayload({ path: "../secret.actor.json", actor: {} }),
  );
});

check("resolveBehaviorStub derives a kebab path + camelCase export + signed source", () => {
  const stub = resolveBehaviorStub("open-door");
  assert.equal(stub.slug, "open-door");
  assert.equal(stub.exportName, "openDoor");
  assert.equal(stub.path, "src/game/scripts/open-door.ts");
  // The source registers the export under its BehaviorUpdate signature.
  assert.ok(stub.source.includes("export const openDoor: BehaviorUpdate"));
  assert.ok(stub.source.includes('import { openDoor } from "./scripts/open-door"'));
  assert.ok(stub.source.includes('add "open-door" to BEHAVIOR_SCRIPT_IDS'));

  // Mixed separators + casing collapse to a single kebab slug / camel identifier.
  const messy = resolveBehaviorStub("  My Custom Dash!! ");
  assert.equal(messy.slug, "my-custom-dash");
  assert.equal(messy.exportName, "myCustomDash");

  // A digit-leading slug still yields a valid TS identifier.
  assert.equal(resolveBehaviorStub("3d-spin").exportName, "behavior3dSpin");

  // Unusable / malformed ids are rejected before any write.
  assert.throws(() => resolveBehaviorStub("   "));
  assert.throws(() => resolveBehaviorStub("!!!"));
  assert.throws(() => resolveBehaviorStub(42 as unknown as string));
  assert.throws(() => validateNewBehaviorPayload({ scriptId: "" }));
  assert.equal(validateNewBehaviorPayload({ scriptId: "spin" }).scriptId, "spin");
});

check("actorInstanceToEntity flattens a class + placement into one entity", () => {
  const def = normalizeActorScriptDef({
    name: "DoorBP",
    parentClass: "actor",
    components: [
      { id: "root", component: "Transform", props: { position: [9, 9, 9] } },
      { id: "mesh", parent: "root", component: "MeshRenderer", props: { assetId: "door_01" } },
      {
        id: "trig",
        parent: "root",
        component: "Collider",
        props: { shape: "box", size: [1, 2, 1], isStatic: true, isSensor: true },
      },
      // Second MeshRenderer is ignored: first node of each kind wins (flat entity).
      { id: "mesh2", parent: "root", component: "MeshRenderer", props: { assetId: "ignored" } },
    ],
    eventBindings: [{ event: "tick", scriptId: "spin", params: { speedDeg: 45 } }],
  });
  const entity = actorInstanceToEntity(
    def,
    { classRef: "blueprints/DoorBP.actor.json", position: [1, 2, 3], rotationYDeg: 90, scale: 2 },
    4,
  );

  assert.equal(entity.id, "actor:4");
  assert.equal(entity.name, "DoorBP");
  // Instance transform is authoritative (the root Transform node's props are ignored).
  const transform = readTransformComponent(entity);
  assert.deepEqual(transform?.position, [1, 2, 3]);
  assert.deepEqual(transform?.rotation, [0, 90, 0]);
  assert.deepEqual(transform?.scale, [2, 2, 2]);
  // First MeshRenderer wins.
  assert.equal(readMeshRendererComponent(entity)?.assetId, "door_01");
  const collider = readColliderComponent(entity);
  assert.equal(collider?.isSensor, true);
  // The first event binding compiles to the single Behavior.
  const behavior = readBehaviorComponent(entity);
  assert.equal(behavior?.scriptId, "spin");
  assert.deepEqual(behavior?.params, { speedDeg: 45 });

  // Instance name + hidden flag override the class name and tag the entity.
  const named = actorInstanceToEntity(
    def,
    { classRef: "x.actor.json", position: [0, 0, 0], name: "Front Door", hidden: true },
    0,
  );
  assert.equal(named.name, "Front Door");
  assert.deepEqual(named.tags, ["hidden"]);

  // Round-trips through the entity-id helpers.
  assert.equal(parseActorInstanceEntityIndex(actorInstanceEntityId(7)), 7);
  assert.equal(parseActorInstanceEntityIndex("character:7"), null);
});

check("attachActorLight builds a scene light from an actor's Light component", () => {
  const def = normalizeActorScriptDef({
    name: "LampBP",
    components: [
      { id: "root", component: "Transform", props: {} },
      {
        id: "lamp",
        parent: "root",
        component: "Light",
        props: { type: "point", intensity: 3, distance: 12 },
      },
    ],
  });
  const entity = actorInstanceToEntity(
    def,
    { classRef: "blueprints/LampBP.actor.json", position: [1, 2, 3] },
    0,
  );
  const host = new Object3D();
  assert.equal(attachActorLight(host, entity), true);
  // A PointLight now lives under the host (added at local origin; the host object
  // carries the instance world transform, so the light tracks it as it moves).
  let pointLights = 0;
  host.traverse((child) => {
    if (child instanceof PointLight) pointLights += 1;
  });
  assert.equal(pointLights, 1);

  // A light-less actor attaches nothing (and leaves the host empty).
  const plain = actorInstanceToEntity(
    normalizeActorScriptDef({ name: "Empty" }),
    { classRef: "x.actor.json", position: [0, 0, 0] },
    0,
  );
  const emptyHost = new Object3D();
  assert.equal(attachActorLight(emptyHost, plain), false);
  assert.equal(emptyHost.children.length, 0);
});

check("actorPreviewNodes keeps the whole tree with per-node local transforms", () => {
  const def = normalizeActorScriptDef({
    name: "DoorBP",
    components: [
      { id: "root", component: "Transform", props: {} },
      {
        id: "mesh",
        parent: "root",
        component: "MeshRenderer",
        props: { assetId: "door_01", position: [1, 0, 0], rotation: [0, 90, 0], scale: [2, 2, 2] },
      },
      // A second mesh of the same kind is preserved (unlike the runtime collapse).
      { id: "mesh2", parent: "root", component: "MeshRenderer", props: { assetId: "knob" } },
      {
        id: "trig",
        parent: "mesh",
        component: "Collider",
        props: { shape: "sphere", size: [2, 2, 2], center: [0, 1, 0], rotation: [0, 45, 0], isSensor: true },
      },
      { id: "lamp", parent: "root", component: "Light", props: { type: "point", intensity: 3, distance: 6 } },
    ],
  });
  const nodes = actorPreviewNodes(def);

  // Every component node survives (no first-of-kind collapse).
  assert.equal(nodes.length, 5);
  assert.equal(nodes.filter((n) => n.component === "MeshRenderer").length, 2);

  const mesh = nodes.find((n) => n.id === "mesh");
  assert.equal(mesh?.parent, "root");
  assert.equal(mesh?.mesh?.assetId, "door_01");
  assert.deepEqual(mesh?.position, [1, 0, 0]);
  assert.deepEqual(mesh?.rotation, [0, 90, 0]);
  assert.deepEqual(mesh?.scale, [2, 2, 2]);

  // Root + missing props default to identity.
  const root = nodes.find((n) => n.id === "root");
  assert.equal(root?.parent, undefined);
  assert.deepEqual(root?.scale, [1, 1, 1]);

  // Collider payload carries shape/size/center/rotation/sensor; node transform
  // stays identity (orientation lives on the payload, not double-applied).
  const trig = nodes.find((n) => n.id === "trig");
  assert.equal(trig?.parent, "mesh");
  assert.equal(trig?.collider?.shape, "sphere");
  assert.deepEqual(trig?.collider?.size, [2, 2, 2]);
  assert.deepEqual(trig?.collider?.center, [0, 1, 0]);
  assert.deepEqual(trig?.collider?.rotation, [0, 45, 0]);
  assert.equal(trig?.collider?.isSensor, true);
  assert.deepEqual(trig?.rotation, [0, 0, 0]);
  assert.deepEqual(trig?.scale, [1, 1, 1]);

  // Light payload extraction.
  const lamp = nodes.find((n) => n.id === "lamp");
  assert.equal(lamp?.light?.type, "point");
  assert.equal(lamp?.light?.intensity, 3);
  assert.equal(lamp?.light?.distance, 6);
});

check("actorPreviewNodes defaults bad collider/light props and a bare class", () => {
  const def = normalizeActorScriptDef({
    name: "Messy",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "c", parent: "root", component: "Collider", props: { shape: "bogus" } },
      { id: "l", parent: "root", component: "Light", props: { type: "weird" } },
    ],
  });
  const nodes = actorPreviewNodes(def);
  const collider = nodes.find((n) => n.id === "c")?.collider;
  assert.equal(collider?.shape, "box");
  assert.deepEqual(collider?.size, [1, 1, 1]);
  assert.equal(collider?.isSensor, false);
  assert.equal(nodes.find((n) => n.id === "l")?.light?.type, "directional");

  // A default class previews to a single identity root with no payloads.
  const bare = actorPreviewNodes(defaultActorScriptDef("Bare"));
  assert.equal(bare.length, 1);
  assert.equal(bare[0]?.component, "Transform");
  assert.equal(bare[0]?.mesh, undefined);
});

check("actorInstanceToEntity falls back to a Behavior component node when no bindings", () => {
  const def = normalizeActorScriptDef({
    name: "Spinner",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "logic", parent: "root", component: "Behavior", props: { scriptId: "spin" } },
    ],
    eventBindings: [],
  });
  const entity = actorInstanceToEntity(def, { classRef: "s.actor.json", position: [0, 0, 0] }, 1);
  assert.equal(readBehaviorComponent(entity)?.scriptId, "spin");
});

check("cloneActorInstance deep-copies fields and shares no references", () => {
  const original = {
    classRef: "blueprints/DoorBP.actor.json",
    name: "Front Door",
    position: [1, 2, 3] as [number, number, number],
    rotation: [0, 90, 0] as [number, number, number],
    scale: [2, 2, 2] as [number, number, number],
    scaleLocked: true,
    hidden: true,
    locked: true,
    groupId: "g1",
    nodeId: "n1",
    parentId: "n0",
  };
  const clone = cloneActorInstance(original);
  assert.deepEqual(clone, original);
  clone.position[0] = 99;
  (clone.rotation as number[])[1] = 0;
  assert.equal(original.position[0], 1, "position array must be copied");
  assert.equal(original.rotation[1], 90, "rotation array must be copied");
});

check("validateActorInstance allowlists classRef + transform and rejects bad refs", () => {
  const actor = validateActorInstance({
    classRef: "blueprints/DoorBP.actor.json",
    position: [1.23456, 0, -2],
    name: "Door",
    rotation: [0, 45, 0],
    scale: 1.5,
    sensor: true, // not an instance field → dropped
  });
  assert.equal(actor.classRef, "blueprints/DoorBP.actor.json");
  assert.deepEqual(actor.position, [1.235, 0, -2]);
  assert.equal(actor.name, "Door");
  assert.deepEqual(actor.rotation, [0, 45, 0]);
  assert.equal(actor.scale, 1.5);
  assert.equal("sensor" in actor, false);

  assert.throws(() => validateActorInstance({ classRef: "DoorBP.json", position: [0, 0, 0] }));
  assert.throws(() => validateActorInstance({ classRef: "../x.actor.json", position: [0, 0, 0] }));
  assert.throws(() => validateActorInstance({ classRef: "x.actor.json", position: [0, 0] }));
});

check("validateLayout round-trips an actors[] array", () => {
  const layout = validateLayout({
    schema: 1,
    name: "WithActors",
    loadGroups: [],
    instances: [],
    characters: [],
    actors: [
      { classRef: "blueprints/DoorBP.actor.json", position: [1, 0, 1], name: "Door A" },
    ],
  }) as RoomLayout;
  assert.equal(layout.actors?.length, 1);
  assert.equal(layout.actors?.[0]?.classRef, "blueprints/DoorBP.actor.json");
  // Idempotent: validating the output again yields the same shape.
  assert.deepEqual(validateLayout(layout), layout);
});

check("validateSkyAtmosphere allowlists scattering fields and round-trips defaults", () => {
  // A present sky with all-defaults still round-trips as `{}` so it is never lost.
  assert.deepEqual(validateSkyAtmosphere({}), {});
  assert.equal(validateSkyAtmosphere(undefined), null);

  const sky = validateSkyAtmosphere({
    name: "Dusk",
    hidden: true,
    rayleigh: 3,
    turbidity: 8,
    mie: 0.01,
    mieDirectionalG: 0.9,
    exposure: 0.4,
    // Sun fields live on the directional light now — they must NOT round-trip here.
    sunElevationDeg: 12,
    bogusField: "dropped",
  });
  assert.deepEqual(sky, {
    name: "Dusk",
    hidden: true,
    rayleigh: 3,
    turbidity: 8,
    mie: 0.01,
    mieDirectionalG: 0.9,
    exposure: 0.4,
  });
  // Out-of-range numbers reject the save, mirroring the light-actor validator.
  assert.throws(() => validateSkyAtmosphere({ rayleigh: 999 }));
  assert.throws(() => validateSkyAtmosphere({ mie: 5 }));
});

check("sky derives the sun direction from the directional-light rotation", () => {
  // The directional Sun light is the source of truth: the sky reads its rotation
  // (forward -Z = where the light shines) and the sun sits opposite that travel.
  const unit = (v: { x: number; y: number; z: number }): number =>
    Math.hypot(v.x, v.y, v.z);

  // No rotation: light shines down -Z, so the sun is toward +Z.
  const flat = sunDirectionFromLightRotation([0, 0, 0]);
  assert.ok(Math.abs(unit(flat) - 1) < 1e-6, "unit length");
  assert.ok(Math.abs(flat.x) < 1e-6 && Math.abs(flat.y) < 1e-6 && Math.abs(flat.z - 1) < 1e-6);

  // Pitched -90° about X aims the light straight down, so the sun is at the zenith.
  const noon = sunDirectionFromLightRotation([-90, 0, 0]);
  assert.ok(Math.abs(noon.y - 1) < 1e-6, `zenith got ${noon.y}`);
});

check("validateLayout round-trips a skyAtmosphere singleton", () => {
  const layout = validateLayout({
    schema: 1,
    name: "WithSky",
    loadGroups: [],
    instances: [],
    characters: [],
    skyAtmosphere: { turbidity: 6, rayleigh: 2.5 },
  }) as RoomLayout;
  assert.deepEqual(layout.skyAtmosphere, { turbidity: 6, rayleigh: 2.5 });
  // Idempotent: validating the output again yields the same shape.
  assert.deepEqual(validateLayout(layout), layout);
});

check("resolveHeightFog fills defaults and overrides per field", () => {
  assert.deepEqual(resolveHeightFog(null), HEIGHT_FOG_DEFAULTS);
  assert.deepEqual(resolveHeightFog(undefined), HEIGHT_FOG_DEFAULTS);
  const resolved = resolveHeightFog({ mode: "linear", color: "#102030", start: 3, end: 40 });
  assert.equal(resolved.mode, "linear");
  assert.equal(resolved.color, "#102030");
  assert.equal(resolved.start, 3);
  assert.equal(resolved.end, 40);
  // Unset fields fall back to defaults.
  assert.equal(resolved.density, HEIGHT_FOG_DEFAULTS.density);
  assert.equal(resolved.name, HEIGHT_FOG_DEFAULTS.name);
});

check("applySceneFog sets exp/linear fog and clears on hidden/null", () => {
  const scene = new Scene();

  applySceneFog(scene, resolveHeightFog({ mode: "exp", color: "#445566", density: 0.07 }));
  assert.ok(scene.fog instanceof FogExp2);
  assert.equal((scene.fog as FogExp2).density, 0.07);
  assert.equal((scene.fog as FogExp2).color.getHexString(), "445566");

  applySceneFog(scene, resolveHeightFog({ mode: "linear", color: "#223344", start: 4, end: 44 }));
  assert.ok(scene.fog instanceof Fog);
  assert.equal((scene.fog as Fog).near, 4);
  assert.equal((scene.fog as Fog).far, 44);

  // Hidden fog and an absent actor both clear scene.fog.
  applySceneFog(scene, resolveHeightFog({ hidden: true }));
  assert.equal(scene.fog, null);
  applySceneFog(scene, resolveHeightFog({ mode: "exp" }));
  assert.ok(scene.fog instanceof FogExp2);
  applySceneFog(scene, null);
  assert.equal(scene.fog, null);
});

check("validateHeightFog allowlists fields and round-trips through validateLayout", () => {
  // A present fog with all-defaults still round-trips as `{}` so it is never lost.
  assert.deepEqual(validateHeightFog({}), {});
  assert.equal(validateHeightFog(undefined), null);

  const fog = validateHeightFog({
    name: "Mist",
    hidden: true,
    mode: "linear",
    color: "#aabbcc",
    density: 0.05,
    start: 2,
    end: 80,
    bogusField: "dropped",
  });
  assert.deepEqual(fog, {
    name: "Mist",
    hidden: true,
    mode: "linear",
    color: "#aabbcc",
    density: 0.05,
    start: 2,
    end: 80,
  });
  // Invalid mode/color are dropped; out-of-range numbers reject the save.
  assert.deepEqual(validateHeightFog({ mode: "weird", color: "red" }), {});
  assert.throws(() => validateHeightFog({ density: 999 }));

  const layout = validateLayout({
    schema: 1,
    name: "WithFog",
    loadGroups: [],
    instances: [],
    characters: [],
    heightFog: { mode: "exp", density: 0.04 },
  }) as RoomLayout;
  assert.deepEqual(layout.heightFog, { mode: "exp", density: 0.04 });
  assert.deepEqual(validateLayout(layout), layout);
});

check("resolveCloudLayer fills defaults and overrides per field", () => {
  assert.deepEqual(resolveCloudLayer(null), CLOUD_LAYER_DEFAULTS);
  assert.deepEqual(resolveCloudLayer(undefined), CLOUD_LAYER_DEFAULTS);
  const resolved = resolveCloudLayer({ coverage: 0.7, color: "#101820", speed: 0.5 });
  assert.equal(resolved.coverage, 0.7);
  assert.equal(resolved.color, "#101820");
  assert.equal(resolved.speed, 0.5);
  // Unset fields fall back to defaults.
  assert.equal(resolved.density, CLOUD_LAYER_DEFAULTS.density);
  assert.equal(resolved.name, CLOUD_LAYER_DEFAULTS.name);
});

check("applyCloudUniforms pushes resolved settings onto the dome shader", () => {
  const dome = createCloudObject();
  applyCloudUniforms(
    dome,
    resolveCloudLayer({ color: "#445566", coverage: 0.4, density: 0.6, speed: 0, hidden: false }),
  );
  const uniforms = dome.material.uniforms;
  assert.equal((uniforms.uColor!.value as { getHexString: () => string }).getHexString(), "445566");
  assert.equal(uniforms.uCoverage!.value, 0.4);
  assert.equal(uniforms.uDensity!.value, 0.6);
  // speed 0 → zero-length wind vector (fully static).
  assert.equal((uniforms.uWind!.value as { length: () => number }).length(), 0);
  assert.equal(dome.visible, true);

  // A hidden cloud hides the dome and a non-zero speed yields a non-zero wind.
  applyCloudUniforms(dome, resolveCloudLayer({ hidden: true, speed: 1 }));
  assert.equal(dome.visible, false);
  assert.ok((uniforms.uWind!.value as { length: () => number }).length() > 0);
});

check("validateCloudLayer allowlists fields and round-trips through validateLayout", () => {
  // A present cloud with all-defaults still round-trips as `{}` so it is never lost.
  assert.deepEqual(validateCloudLayer({}), {});
  assert.equal(validateCloudLayer(undefined), null);

  const cloud = validateCloudLayer({
    name: "Overcast",
    hidden: true,
    color: "#aabbcc",
    coverage: 0.8,
    density: 0.5,
    softness: 0.2,
    scale: 3,
    speed: 0.25,
    bogusField: "dropped",
  });
  assert.deepEqual(cloud, {
    name: "Overcast",
    hidden: true,
    color: "#aabbcc",
    coverage: 0.8,
    density: 0.5,
    softness: 0.2,
    scale: 3,
    speed: 0.25,
  });
  // Invalid color is dropped; out-of-range numbers reject the save.
  assert.deepEqual(validateCloudLayer({ color: "red" }), {});
  assert.throws(() => validateCloudLayer({ coverage: 5 }));

  const layout = validateLayout({
    schema: 1,
    name: "WithClouds",
    loadGroups: [],
    instances: [],
    characters: [],
    cloudLayer: { coverage: 0.6, density: 0.7 },
  }) as RoomLayout;
  assert.deepEqual(layout.cloudLayer, { coverage: 0.6, density: 0.7 });
  assert.deepEqual(validateLayout(layout), layout);
});

check("import asset meta allowlists extensions and rejects unsafe names/types", () => {
  const meta = validateImportAssetMeta({ dir: "assets/props", name: "chair.glb" });
  assert.equal(resolveImportPath(meta), "assets/props/chair.glb");
  assert.equal(resolveImportPath(validateImportAssetMeta({ dir: "", name: "tex.png" })), "tex.png");
  assert.throws(() => validateImportAssetMeta({ dir: "assets", name: "evil.exe" }));
  assert.throws(() => validateImportAssetMeta({ dir: "assets", name: "noext" }));
  assert.throws(() => validateImportAssetMeta({ dir: "assets", name: "a/b.glb" }));
  assert.throws(() => validateImportAssetMeta({ dir: "../escape", name: "x.glb" }));
});

check("buildImportedAssetRecord derives a valid manifest entry per type", () => {
  const mesh = buildImportedAssetRecord("assets/models/props/chair.glb", 2048, ["chair"]);
  assert.ok(mesh);
  assert.equal(mesh?.assetType, "staticMesh");
  assert.equal(mesh?.id, "chair-2"); // de-duplicated against the existing "chair"
  assert.equal(mesh?.category, "props"); // parent folder name
  assert.equal(mesh?.placeable, true);
  assert.equal(mesh?.runtime.collision, true);
  assert.equal(mesh?.runtime.bytes, 2048);

  const texture = buildImportedAssetRecord("assets/sky.png", 99, []);
  assert.equal(texture?.assetType, "texture");
  assert.equal(texture?.placeable, false);
  assert.equal(texture?.runtime.collision, false);
  assert.equal(texture?.category, "texture"); // falls back to type when dir is "assets"

  const material = buildImportedAssetRecord("assets/materials/Stone.material.json", 50, []);
  assert.equal(material?.assetType, "material");
  assert.equal(material?.placeable, false);

  const actor = buildImportedAssetRecord("assets/blueprints/DoorBP.actor.json", 75, []);
  assert.equal(actor?.assetType, "prefab");
  assert.equal(actor?.category, "blueprints");

  const effect = buildImportedAssetRecord("assets/effects/Dust.effect.json", 80, []);
  assert.equal(effect?.assetType, "prefab");
  assert.equal(effect?.placeable, false);

  const legacyScript = buildImportedAssetRecord("assets/blueprints/Old.script.json", 75, []);
  assert.equal(legacyScript?.assetType, "prefab");

  // Unknown/companion types are not auto-registered.
  assert.equal(buildImportedAssetRecord("assets/models/props/chair.bin", 10, []), null);

  // The generated record passes manifest validation with no errors.
  const report = validateAssetManifest({
    version: 1,
    generated: "2026-06-19",
    ktx2: false,
    assets: [mesh],
  });
  assert.equal(report.errorCount, 0);
});

console.log(`[engine-tests] ${checks} checks passed`);
