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
  NoColorSpace,
  Object3D,
  PerspectiveCamera,
  PointLight,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  Texture,
  Vector2,
  type Material,
} from "three";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
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
  readCameraComponent,
  readCharacterMovementComponent,
  readColliderComponent,
  readInteractionComponent,
  readLightComponent,
  readMessageBindingsComponent,
  readMeshRendererComponent,
  readMetadataComponent,
  readParticleEmitterComponent,
  readScriptActorComponent,
  readScriptDispatchersComponent,
  readScriptInterfacesComponent,
  readScriptReferencesComponent,
  readSpringArmComponent,
  readTransformComponent,
  INTERACTION_COMPONENT,
  MESSAGE_BINDINGS_COMPONENT,
  PARTICLE_EMITTER_COMPONENT,
  SCRIPT_ACTOR_COMPONENT,
  SCRIPT_DISPATCHERS_COMPONENT,
  SCRIPT_INTERFACES_COMPONENT,
  SCRIPT_REFERENCES_COMPONENT,
} from "../engine/scene/components";
import { readRotation, readScale } from "../engine/scene/transform";
import { EngineApp } from "../engine/core/EngineApp";
import type { Subsystem } from "../engine/core/Subsystem";
import { AnimationSubsystem } from "../engine/render-three/animationSubsystem";
import { ActionMap } from "../engine/input/actionMap";
import { InputSubsystem } from "../engine/input/inputSubsystem";
import { BehaviorSubsystem } from "../engine/behavior/behaviorSubsystem";
import type { BehaviorRegistry } from "../engine/behavior/behaviorSubsystem";
import { ScriptMessageBus } from "../engine/behavior/scriptMessages";
import { PhysicsSubsystem } from "../engine/physics/physicsSubsystem";
import {
  AudioSubsystem,
  DEFAULT_SPATIAL_ATTENUATION,
  resolveSpatialPannerConfig,
} from "../engine/audio/audioSubsystem";
import { DEFAULT_AUDIO_CLIP_MANIFEST, audioClipById } from "../engine/assets/audio";
import { KeyboardInputSource } from "../src/input/keyboardInputSource";
import {
  facingYawFromMove,
  planarMoveStep,
  planarMoveStepRelativeToYaw,
  rotateYawToward,
} from "../src/game/playerMovement";
import { createBehaviorRegistry } from "../src/game/behaviors";
import { CharacterMovementSubsystem } from "../src/game/characterMovementSystem";
import type { TransformComponent } from "../engine/scene/components";
import {
  desiredFollowPose,
  lerpVec3,
  smoothingFactor,
  stepFollowCamera,
  type FollowCameraConfig,
} from "../src/game/followCamera";
import {
  cameraProjectionFromComponent,
  desiredSpringArmCameraPose,
  resolveSpringArmCollision,
} from "../src/game/springArmCamera";
import { groundedAt, stepVerticalMotion } from "../src/game/verticalMotion";
import { resolvePlanarMovement, type Aabb3 } from "../src/game/collision";
import {
  applyMiniGolfPutt,
  createMiniGolfBallState,
  miniGolfSurfaceHeight,
  stepMiniGolfBall,
  type MiniGolfCourse,
} from "../game/minigolf/gameplay/miniGolfBallPhysics";
import { computeMiniGolfAim } from "../game/minigolf/gameplay/miniGolfAim";
import {
  buildMiniGolfCourse,
  formatMiniGolfScore,
  miniGolfResultName,
  miniGolfScoreRelativeToPar,
  summarizeMiniGolfCourse,
} from "../game/minigolf/gameplay/miniGolfGameMode";
import {
  classifyLocomotion,
  locomotionConfigForSkeleton,
  pickLocomotionBlendSpace,
  resolveLocomotionAnimation,
  resolveLocomotionClip,
  selectLocomotionClip,
  type LocomotionAssetConfig,
  type LocomotionInput,
} from "../src/game/locomotionAnimation";
import { initialInteractionState, stepInteractionTrigger } from "../src/game/interaction";
import {
  GameStateStore,
  formatTimer,
  normalizeGameRules,
  parseGameEvent,
} from "../src/game/gameRules";
import { firstConnectedGamepad, readGamepadCodes } from "../src/input/gamepadInput";
import { joystickMoveCodes, joystickVector } from "../src/input/virtualJoystick";
import { parseEffectDefinition } from "../engine/render-three/particleEffect";
import { CrossfadeAnimator } from "../engine/render-three/characterAnimator";
import { collectSubtreeNodeNames, splitClipsByUpperBody } from "../engine/render-three/bodyMask";
import { LayeredCharacterAnimator } from "../engine/render-three/layeredCharacterAnimator";
import { applyRootMotionToClip, rootMotionPositionNodes } from "../engine/render-three/rootMotion";
import { createCharacterSceneObject, entityCharacterItem } from "../engine/render-three/models";
import {
  DEFAULT_GAME_MODE_ID,
  GAME_MODE_OPTIONS,
  isGameModeClassRef,
  isKnownGameModeId,
  normalizeGameModeId,
  TPS_GAME_MODE_ID,
} from "../src/game/gameModes/catalog";
import { resolveGameMode } from "../src/game/gameModes/registry";
import { createProjectGameMode } from "../src/game/gameModes/projectGameMode";
import { formatGameModeDebug, formatUiDebug } from "../src/scene/debugStats";
import {
  applyConfiguredMouseLook,
  applyMouseLook,
  cameraPlanarPan,
  forwardFromLookAngles,
  lookAnglesFromForward,
} from "../src/game/gameModes/cameraControl";
import { PlayerCameraManager } from "../src/game/playerCameraManager";
import { RuntimePlayerController } from "../src/game/playerController";
import {
  computePlayerStartSpawn,
  createDefaultPlayerCharacter,
  findPlayerStartTransform,
  hasPlayerCharacter,
} from "../src/game/gameModes/playerSpawn";
import { defaultCameraGameMode } from "../src/game/gameModes/defaultCameraGameMode";
import { tpsCharacterGameMode } from "../src/game/gameModes/tpsCharacterGameMode";
import { resolveMontageBindings } from "../src/game/montageInputBindings";
import {
  AnimationNotifyTracker,
  collectFiredNotifies,
  groupNotifiesByClip,
} from "../src/game/animationNotifies";
import {
  buildRagdollSpec,
  toRagdollGroupDesc,
  RAGDOLL_DENSITY,
  type BoneWorldTransform,
} from "../src/game/ragdollSpec";
import {
  boneWorldFromBodyPose,
  ragdollJointAngularLimits,
  worldAnchorToBodyLocal,
} from "../engine/physics/ragdoll";
import { getUpBlendFactor } from "../src/game/getUpBlender";
import type {
  GameModeContext,
  InputMode,
  PointerLookMode,
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
  inferImportedAssetTypeFromContent,
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
  validateReflection,
  validateReflectionPlane,
  validateReflectiveSurface,
  validateSphereReflectionCapture,
  validatePostProcess,
  validateSaveActorPayload,
  validateSaveUiPayload,
  validateNewBehaviorPayload,
  resolveBehaviorStub,
  validateSaveCollisionPayload,
  validateForgeMaterialDef,
  validateSaveMaterialPayload,
  validateSaveMaterialSlotsPayload,
  validateSaveSkeletonPayload,
  validateSaveUvwPayload,
} from "./saveValidator";
import {
  defaultActorScriptDef,
  normalizeActorScriptDef,
  readGameModeDefaultPawnClassRef,
} from "../engine/scene/actorScript";
import { actorPreviewNodes } from "../engine/scene/actorPreview";
import { normalizeForgeMaterialDef } from "../engine/assets/material";
import {
  normalizeAssetSkeleton,
  resolveBlendSpaceWeights,
  skeletonSidecarPath,
  type AssetSkeletonBlendSpaceDef,
} from "../src/scene/assetSkeletonLoader";
import {
  createThreeMaterialFromForgeDef,
  EMISSIVE_INTENSITY_SCALE,
} from "../engine/render-three/materials";
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
  inferAssetTypeFromPath,
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
import {
  applySkyToneMapping,
  createSkyObject,
  setSkyLocalToneMappingExposure,
  skyAtmosphereToneMappingExposure,
  sunDirectionFromLightRotation,
} from "../engine/render-three/skyAtmosphere";
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
  applyPostProcessToneMapping,
  createPostProcessAntialiasPass,
  createPostProcessEffectPasses,
  hasPostProcessEffectPasses,
  PostProcessPipeline,
  postProcessToneMappingExposure,
  resolvePostProcess,
  POST_PROCESS_DEFAULTS,
} from "../engine/render-three/postProcess";
import {
  applyReflectionEnvironment,
  resolveReflection,
  REFLECTION_DEFAULTS,
} from "../engine/render-three/reflection";
import {
  applyReflectionPlaneTransform,
  createReflectionPlaneObject,
  resolveReflectionPlane,
  uniqueReflectionPlaneId,
  uniqueReflectionPlaneName,
  REFLECTION_PLANE_DEFAULTS,
} from "../engine/render-three/reflectionPlane";
import {
  applyReflectiveSurfaceTransform,
  createReflectiveSurfaceObject,
  resolveReflectiveSurface,
  uniqueReflectiveSurfaceId,
  uniqueReflectiveSurfaceName,
  REFLECTIVE_SURFACE_DEFAULTS,
} from "../engine/render-three/reflectiveSurface";
import {
  applySphereReflectionCaptureTransform,
  assignProbeEnvMapMaterial,
  createSphereReflectionCaptureObject,
  disposeSphereReflectionCaptureBake,
  isReflectionCaptureBakeStale,
  resolveSphereReflectionCapture,
  selectNearestReflectionCapture,
  setSphereReflectionCaptureStale,
  uniqueSphereReflectionCaptureId,
  uniqueSphereReflectionCaptureName,
  SPHERE_REFLECTION_CAPTURE_DEFAULTS,
  type SphereReflectionCaptureBake,
  type SphereReflectionCaptureRenderItem,
} from "../engine/render-three/reflectionCapture";
import {
  COLLISION_CHANNELS,
  COLLISION_OBJECT_CHANNEL_BITS,
  DEFAULT_COLLISION_COMPLEXITY,
  DEFAULT_COLLISION_PRESET,
  assetCollisionDefHasCollider,
  collisionInteractionGroups,
  complexAsSimpleAssetIds,
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
  ACESFilmicToneMapping,
  Bone,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Euler,
  Fog,
  FogExp2,
  Mesh,
  NeutralToneMapping,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import type { AnimationMixer } from "three";
import {
  createUiNode,
  defaultUiWidgetDef,
  findUiNode,
  findUiNodeParent,
  normalizeUiWidgetDef,
  readUiAction,
  readUiBindingPath,
  readUiTextKey,
  UI_WIDGET_KINDS,
  type UiNode,
} from "../engine/ui/uiWidget";
import {
  buildUiRenderTree,
  buildUiRenderNode,
  resolveInlineStyle,
} from "../engine/ui/uiRenderer";
import { UiViewModelStore } from "../engine/ui/uiViewModel";
import { collectUiBindings, collectUiLocBindings, resolveUiBoundValue } from "../engine/ui/uiBinding";
import { normalizeUiThemeDef, themeToCssVariables, tokenToCssVar } from "../engine/ui/uiTheme";
import {
  applyLocParams,
  LocaleRegistry,
  normalizeUiLocaleTable,
} from "../engine/ui/uiLocale";
import {
  normalizeUiTransition,
  transitionClasses,
  UI_TRANSITION_BASE_CLASS,
} from "../engine/ui/uiTransition";
import {
  auditUiA11y,
  collectFocusables,
  isUiNodeFocusable,
  nextFocusIndex,
  normalizeUiA11y,
  resolveUiA11yAttrs,
} from "../engine/ui/uiA11y";
import {
  ndcToScreen,
  normalizeWorldWidget,
  normalizeWorldWidgets,
  resolveWorldWidgetVisibility,
} from "../engine/ui/uiWorldWidget";

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

// 2. Round-trip on a self-contained, project-agnostic fixture that exercises the
// same legacy-adapter paths a real saved scene would: a placed static mesh (mesh +
// transform components), a default directional light, and a scripted character
// carrying the input-move behavior + collision-chime audio cue the Game Mode demo
// relies on. Previously read from public/layouts/render-test-room.json; inlined here
// so the generic template ships no home-decor demo layout. (cwd is repo root.)
const layout: RoomLayout = {
  schema: 1,
  name: "legacy-adapter-fixture",
  loadGroups: [],
  instances: [{ assetId: "starter-sm-crate", placements: [{ position: [0, 0, 0] }] }],
  characters: [
    {
      assetId: "demo-character",
      position: [0.38, 0, 1.64],
      animation: "idle",
      name: "demo-character",
      behavior: { script: "input-move" },
      audio: { clipId: "collision-chime", volume: 0.35, loop: false, spatial: false },
    },
  ],
  worldSettings: { staticObjectsCastShadow: true, ambientIntensity: 1 },
};
ensureDefaultSceneLights(layout);
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
  const crate = assetManifest.assets.find((asset) => asset.id === "starter-sm-crate");
  assert.ok(crate);
  assert.equal(assetType(crate), "staticMesh");
  assert.equal(
    assetPath(crate),
    "assets/starter-content/StaticMeshes/Props/SM_Prototype_Crate.glb",
  );
  assert.equal(assetLoadGroup(crate), "starter-static-meshes");
  assert.equal(assetByteSize(crate), 2024);
});
check("asset manifest classifies Sound Cue assets separately from prefab JSON", () => {
  const cue = assetManifest.assets.find((asset) => asset.id === "sc-footstep-stone");
  assert.ok(cue);
  assert.equal(assetType(cue), "soundCue");
  assert.equal(inferAssetTypeFromPath("assets/Sounds/SC_Footstep_Stone.soundcue.json"), "soundCue");
  assert.equal(inferAssetTypeFromPath("assets/Sounds/Warning.sound.json"), "prefab");
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

check("character scene object deep-clones skinned skeletons under the placed root", () => {
  const sourceRoot = new Object3D();
  sourceRoot.name = "source-character";
  const hip = new Bone();
  hip.name = "hip";
  const spine = new Bone();
  spine.name = "spine";
  hip.add(spine);
  sourceRoot.add(hip);

  const sourceMesh = new SkinnedMesh(new BoxGeometry(1, 1, 1));
  sourceMesh.name = "body";
  sourceRoot.add(sourceMesh);
  sourceMesh.bind(new Skeleton([hip, spine]));

  const character = createCharacterSceneObject(
    { scene: sourceRoot, animations: [] } as unknown as GLTF,
    {
      name: "placed-character",
      position: [3, 2, 1],
      rotation: [0, 90, 0],
      scale: [0.5, 0.5, 0.5],
      hidden: true,
      castShadow: false,
    },
  );

  let clonedMesh: SkinnedMesh | null = null;
  character.traverse((object) => {
    if (object instanceof SkinnedMesh) clonedMesh = object;
  });
  assert.ok(clonedMesh);
  const clonedHip = character.getObjectByName("hip");
  const clonedSpine = character.getObjectByName("spine");
  assert.ok(clonedHip);
  assert.ok(clonedSpine);
  assert.notEqual(clonedHip, hip);
  assert.notEqual(clonedSpine, spine);
  assert.equal(clonedMesh.skeleton.bones[0], clonedHip);
  assert.equal(clonedMesh.skeleton.bones[1], clonedSpine);
  assert.notEqual(clonedMesh.skeleton.bones[0], hip);
  assert.deepEqual(character.position.toArray(), [3, 2, 1]);
  assert.deepEqual(character.scale.toArray(), [0.5, 0.5, 0.5]);
  assert.equal(character.visible, false);
  assert.equal(clonedMesh.castShadow, false);
  assert.equal(clonedMesh.receiveShadow, true);
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

check("readMeshRendererComponent reads an authored local scale, else leaves it absent", () => {
  const scaled = normalizeActorScriptDef({
    name: "Small",
    parentClass: "character",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "mesh", parent: "root", component: "MeshRenderer", props: { assetId: "hero", scale: [0.3, 0.3, 0.3] } },
    ],
  });
  const entity = actorInstanceToEntity(scaled, { classRef: "Small.actor.json", position: [0, 0, 0] }, 0);
  assert.deepEqual(readMeshRendererComponent(entity)?.scale, [0.3, 0.3, 0.3]);

  const plain = normalizeActorScriptDef({
    name: "Plain",
    parentClass: "character",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "mesh", parent: "root", component: "MeshRenderer", props: { assetId: "hero" } },
    ],
  });
  const plainEntity = actorInstanceToEntity(plain, { classRef: "Plain.actor.json", position: [0, 0, 0] }, 0);
  assert.equal(readMeshRendererComponent(plainEntity)?.scale, undefined);
});

check("entityCharacterItem multiplies the MeshRenderer local scale into the placement scale", () => {
  const def = normalizeActorScriptDef({
    name: "Small",
    parentClass: "character",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "mesh", parent: "root", component: "MeshRenderer", props: { assetId: "hero", scale: [0.3, 0.5, 0.3] } },
    ],
  });
  // Placement scale 2 on a class authored at 0.3/0.5/0.3 -> rendered 0.6/1.0/0.6.
  const entity = actorInstanceToEntity(def, { classRef: "Small.actor.json", position: [0, 0, 0], scale: 2 }, 0);
  assert.deepEqual(entityCharacterItem(entity).scale, [0.6, 1, 0.6]);

  // No authored mesh scale -> the placement scale is used unchanged.
  const plain = normalizeActorScriptDef({
    name: "Plain",
    parentClass: "character",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "mesh", parent: "root", component: "MeshRenderer", props: { assetId: "hero" } },
    ],
  });
  const plainEntity = actorInstanceToEntity(plain, { classRef: "Plain.actor.json", position: [0, 0, 0], scale: [1, 2, 3] }, 0);
  assert.deepEqual(entityCharacterItem(plainEntity).scale, [1, 2, 3]);
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

check("action map resolves analog axes with deadzone scale invert and delta input", () => {
  const actions = new ActionMap(
    {},
    {
      GamepadRightX: { axis: "look-x", deadzone: 0.2, scale: 2 },
      GamepadRightY: { axis: "look-y", invert: true },
      MouseX: { axis: "look-x", scale: 0.01 },
    },
  );
  actions.handleAxis("GamepadRightX", 0.1);
  actions.handleAxis("GamepadRightY", 0.5);
  actions.addAxisDelta("MouseX", 10);
  actions.advance();

  // GamepadRightX is inside deadzone; MouseX delta contributes 0.1 after scale.
  assert.equal(actions.axis("look-x"), 0.1);
  assert.equal(actions.axis("look-y"), -0.5);

  // Relative mouse deltas are one-tick values; absolute gamepad axes persist.
  actions.advance();
  assert.equal(actions.axis("look-x"), 0);
  assert.equal(actions.axis("look-y"), -0.5);
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

check("audio subsystem play handle can cancel a pending request", () => {
  const audio = new AudioSubsystem();
  const handle = audio.play("music-loop", { volume: 0.25, loop: true, pitch: 1.5 });

  assert.equal(handle.clipId, "music-loop");
  assert.equal(handle.volume, 0.25);
  assert.equal(handle.pitch, 1.5);

  handle.setVolume(0.5);
  handle.setPitch(0.75);
  assert.equal(handle.volume, 0.5);
  assert.equal(handle.pitch, 0.75);

  handle.stop();
  audio.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });

  assert.equal(handle.stopped, true);
  assert.deepEqual(audio.playedRequests(), []);
});

check("audio subsystem keeps headless looping playback alive until stopped", () => {
  const audio = new AudioSubsystem();
  const handle = audio.play("music-loop", { volume: 0.4, loop: true });

  audio.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });

  assert.equal(handle.stopped, false);
  assert.deepEqual(audio.playedRequests(), [{ clipId: "music-loop", volume: 0.4, loop: true }]);

  handle.stop(0.25);
  assert.equal(handle.stopped, true);
});

check("audio subsystem finishes headless non-loop playback after update", () => {
  const audio = new AudioSubsystem();
  const handle = audio.play("ui-click", { volume: 0.7 });

  audio.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });

  assert.equal(handle.stopped, true);
  assert.deepEqual(audio.playedRequests(), [{ clipId: "ui-click", volume: 0.7 }]);
});

check("resolveSpatialPannerConfig defaults, clamps, and keeps max > ref", () => {
  assert.deepEqual(resolveSpatialPannerConfig({}), DEFAULT_SPATIAL_ATTENUATION);
  // Negative/zero inputs fall back to the defaults.
  assert.deepEqual(resolveSpatialPannerConfig({ refDistance: -2, rolloff: 0 }), {
    refDistance: DEFAULT_SPATIAL_ATTENUATION.refDistance,
    maxDistance: DEFAULT_SPATIAL_ATTENUATION.maxDistance,
    rolloff: DEFAULT_SPATIAL_ATTENUATION.rolloff,
  });
  // An inverted pair is corrected so the PannerNode can't go silent/NaN.
  const fixed = resolveSpatialPannerConfig({ refDistance: 30, maxDistance: 5 });
  assert.equal(fixed.refDistance, 30);
  assert.equal(fixed.maxDistance, 31);
});

check("audio subsystem records a spatial play's position; listener pose is safe headless", () => {
  const audio = new AudioSubsystem();
  // No Web Audio context exists headless; updating the listener must not throw.
  audio.setListenerPose([1, 2, 3], [0, 0, -1]);
  audio.play("footstep", { spatial: true, position: [4, 0, -2] });
  audio.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });
  assert.deepEqual(audio.playedRequests(), [
    { clipId: "footstep", spatial: true, position: [4, 0, -2] },
  ]);
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

check("script message bus dispatches by message type and target", () => {
  const deliveries: string[] = [];
  const bus = new ScriptMessageBus({
    targetExists: (target) => target === "lamp" || target === "switch",
  });

  bus.subscribe("Toggleable.Toggle", (envelope) => {
    deliveries.push(`any:${envelope.source}->${envelope.target ?? "*"}`);
  });
  bus.subscribe(
    "Toggleable.Toggle",
    (envelope) => {
      deliveries.push(`lamp:${String(envelope.payload.enabled)}`);
    },
    { target: "lamp" },
  );
  bus.subscribe("Lamp.Toggled", (envelope) => {
    deliveries.push(`emit:${String(envelope.payload.enabled)}`);
  });

  const sent = bus.send({
    frame: 12,
    type: "Toggleable.Toggle",
    source: "switch",
    target: "lamp",
    payload: { enabled: true },
  });
  const emitted = bus.emit({
    frame: 12,
    type: "Lamp.Toggled",
    source: "lamp",
    payload: { enabled: true },
  });
  const result = bus.flush();

  assert.equal(sent.id, "script-message:1");
  assert.equal(emitted.id, "script-message:2");
  assert.deepEqual(deliveries, ["any:switch->lamp", "lamp:true", "emit:true"]);
  assert.deepEqual(result, { processed: 2, delivered: 3, warnings: [] });
  assert.deepEqual(
    bus.getRecentTrace().map((entry) => ({
      type: entry.envelope.type,
      source: entry.envelope.source,
      target: entry.envelope.target ?? null,
      status: entry.status,
      delivered: entry.delivered,
    })),
    [
      {
        type: "Toggleable.Toggle",
        source: "switch",
        target: "lamp",
        status: "delivered",
        delivered: 2,
      },
      {
        type: "Lamp.Toggled",
        source: "lamp",
        target: null,
        status: "delivered",
        delivered: 1,
      },
    ],
  );
  assert.equal(bus.pendingCount(), 0);
});

check("script message bus reports missing target and missing handler", () => {
  const bus = new ScriptMessageBus({
    targetExists: (target) => target === "lamp",
  });

  bus.send({
    type: "Toggleable.Toggle",
    source: "switch",
    target: "missing-lamp",
  });
  bus.send({
    type: "Door.Open",
    source: "switch",
    target: "lamp",
  });
  const result = bus.flush();

  assert.equal(result.processed, 2);
  assert.equal(result.delivered, 0);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ["missing-target", "missing-handler"],
  );
  assert.equal(result.warnings[0]?.envelope?.target, "missing-lamp");
  assert.equal(result.warnings[1]?.envelope?.type, "Door.Open");
  assert.deepEqual(
    bus.getRecentTrace().map((entry) => ({
      type: entry.envelope.type,
      target: entry.envelope.target,
      status: entry.status,
      warning: entry.warnings[0]?.code,
    })),
    [
      {
        type: "Toggleable.Toggle",
        target: "missing-lamp",
        status: "missing-target",
        warning: "missing-target",
      },
      {
        type: "Door.Open",
        target: "lamp",
        status: "missing-handler",
        warning: "missing-handler",
      },
    ],
  );
});

check("script message bus keeps dispatch target-indexed under many subscribers", () => {
  const bus = new ScriptMessageBus({ recentTraceLimit: 3 });
  const deliveries: string[] = [];
  for (let i = 0; i < 1000; i += 1) {
    const target = `actor:${i}`;
    bus.subscribe("Perf.Ping", () => deliveries.push(target), { target });
  }

  for (let i = 0; i < 5; i += 1) {
    bus.send({ frame: i, type: "Perf.Ping", source: "sender", target: "actor:999" });
  }
  const result = bus.flush();

  assert.equal(result.processed, 5);
  assert.equal(result.delivered, 5);
  assert.equal(deliveries.length, 5);
  assert.equal(deliveries.every((target) => target === "actor:999"), true);
  assert.deepEqual(
    bus.getRecentTrace().map((entry) => entry.envelope.frame),
    [2, 3, 4],
  );
});

check("script message bus can disable recent debug trace", () => {
  const bus = new ScriptMessageBus({ recentTraceLimit: 0 });
  let delivered = 0;
  bus.subscribe("Trace.Off", () => {
    delivered += 1;
  });

  bus.emit({ frame: 1, type: "Trace.Off", source: "sender" });
  const result = bus.flush();

  assert.equal(delivered, 1);
  assert.equal(result.processed, 1);
  assert.equal(bus.getRecentTrace().length, 0);
});

check("script message bus guards recursive flush while allowing queued follow-up messages", () => {
  const bus = new ScriptMessageBus();
  let nestedWarnings: readonly string[] = [];
  const deliveries: string[] = [];

  bus.subscribe("Ping", (envelope) => {
    nestedWarnings = bus.flush().warnings.map((warning) => warning.code);
    deliveries.push(envelope.type);
    bus.emit({ type: "Pong", source: envelope.source });
  });
  bus.subscribe("Pong", (envelope) => {
    deliveries.push(envelope.type);
  });

  bus.emit({ type: "Ping", source: "switch" });
  const result = bus.flush();

  assert.deepEqual(nestedWarnings, ["recursive-dispatch"]);
  assert.deepEqual(deliveries, ["Ping", "Pong"]);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ["recursive-dispatch"],
  );
  assert.equal(result.processed, 2);
  assert.equal(result.delivered, 2);
});

check("behavior context routes messages through world query, message bindings, and state", () => {
  const events: string[] = [];
  let senderWorld: {
    self: string;
    byName: string | null;
    byTag: string[];
    withInterface: string[];
    nearest: string | null;
  } | null = null;
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId === "sender") {
        return (context) => {
          const target = context.world.nearestWithInterface(
            "Toggleable",
            context.world.self(),
            5,
          );
          senderWorld = {
            self: context.world.self(),
            byName: context.world.byName("Lamp"),
            byTag: context.world.byTag("lighting"),
            withInterface: context.world.withInterface("Toggleable"),
            nearest: target,
          };
          if (target) {
            context.messages.send(target, "Toggleable.Toggle", { requested: true });
          }
          context.messages.emit("Sender.Done", { frame: context.engine.frame });
        };
      }
      if (scriptId === "toggle-handler") {
        return (context) => {
          const enabled = context.state.toggle("enabled");
          context.transform.position[0] = enabled ? 1 : 0;
          events.push(
            `${context.entityId}:${context.message?.type}:${String(context.message?.payload.requested)}:${enabled}`,
          );
        };
      }
      if (scriptId === "broadcast-handler") {
        return (context) => {
          events.push(`${context.entityId}:${context.message?.type}:${context.message?.source}`);
        };
      }
      return undefined;
    },
  };
  const synced: Array<{ id: string; x: number }> = [];
  const behavior = new BehaviorSubsystem(
    registry,
    new ActionMap({}),
    (id, transform) => synced.push({ id, x: transform.position[0] }),
  );
  behavior.setEntities([
    {
      id: "switch",
      name: "Switch",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Behavior: { scriptId: "sender" },
      },
    },
    {
      id: "lamp",
      name: "Lamp",
      tags: ["lighting"],
      components: {
        Transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        [SCRIPT_INTERFACES_COMPONENT]: { interfaces: ["Toggleable"] },
        [MESSAGE_BINDINGS_COMPONENT]: {
          bindings: [{ message: "Toggleable.Toggle", scriptId: "toggle-handler" }],
        },
      },
    },
    {
      id: "observer",
      components: {
        Transform: { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        [MESSAGE_BINDINGS_COMPONENT]: {
          bindings: [{ message: "Sender.Done", scriptId: "broadcast-handler", target: "any" }],
        },
      },
    },
  ]);

  behavior.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });
  behavior.update({ deltaSeconds: 0.016, elapsedSeconds: 0.032, frame: 2 });

  assert.deepEqual(senderWorld, {
    self: "switch",
    byName: "lamp",
    byTag: ["lamp"],
    withInterface: ["lamp"],
    nearest: "lamp",
  });
  assert.deepEqual(events, [
    "lamp:Toggleable.Toggle:true:true",
    "observer:Sender.Done:switch",
    "lamp:Toggleable.Toggle:true:false",
    "observer:Sender.Done:switch",
  ]);
  assert.deepEqual(
    synced.filter((entry) => entry.id === "lamp").map((entry) => entry.x),
    [1, 0],
  );
  assert.deepEqual(behavior.getLastMessageFlushResult(), {
    processed: 2,
    delivered: 2,
    warnings: [],
  });
});

check("behavior world resolves direct actor references and rebuilds query indexes", () => {
  const reports: Array<{
    byName: string | null;
    byTag: string[];
    byClassRef: string[];
    withInterface: string[];
    refByNode: string | null;
    refByName: string | null;
    refByTag: string | null;
    refByClass: string | null;
    refByInterface: string | null;
  }> = [];
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId !== "probe") return undefined;
      return (context) => {
        reports.push({
          byName: context.world.byName("Door A"),
          byTag: context.world.byTag("door"),
          byClassRef: context.world.byClassRef("blueprints/Door.actor.json"),
          withInterface: context.world.withInterface("Openable"),
          refByNode: context.world.ref("nodeDoor"),
          refByName: context.world.ref("nameDoor"),
          refByTag: context.world.ref("tagDoor"),
          refByClass: context.world.ref("classDoor"),
          refByInterface: context.world.ref("interfaceDoor"),
        });
      };
    },
  };
  const behavior = new BehaviorSubsystem(registry, new ActionMap({}), () => undefined);
  const probe: Entity = {
    id: "probe",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Behavior: { scriptId: "probe" },
      [SCRIPT_REFERENCES_COMPONENT]: {
        references: [
          { key: "nodeDoor", selector: { byNodeId: "door-node" } },
          { key: "nameDoor", selector: { byName: "Door A" } },
          { key: "tagDoor", selector: { byTag: "door" } },
          { key: "classDoor", selector: { byClassRef: "blueprints/Door.actor.json" } },
          { key: "interfaceDoor", selector: { byInterface: "Openable" } },
        ],
      },
    },
  };
  const door: Entity = {
    id: "actor:7",
    name: "Door A",
    tags: ["door"],
    components: {
      Transform: { position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      [SCRIPT_ACTOR_COMPONENT]: {
        classRef: "blueprints/Door.actor.json",
        nodeId: "door-node",
      },
      [SCRIPT_INTERFACES_COMPONENT]: { interfaces: ["Openable"] },
    },
  };

  behavior.setEntities([probe]);
  behavior.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });
  behavior.setEntities([probe, door]);
  behavior.update({ deltaSeconds: 0.016, elapsedSeconds: 0.032, frame: 2 });
  behavior.setEntities([probe]);
  behavior.update({ deltaSeconds: 0.016, elapsedSeconds: 0.048, frame: 3 });

  assert.deepEqual(reports, [
    {
      byName: null,
      byTag: [],
      byClassRef: [],
      withInterface: [],
      refByNode: null,
      refByName: null,
      refByTag: null,
      refByClass: null,
      refByInterface: null,
    },
    {
      byName: "actor:7",
      byTag: ["actor:7"],
      byClassRef: ["actor:7"],
      withInterface: ["actor:7"],
      refByNode: "actor:7",
      refByName: "actor:7",
      refByTag: "actor:7",
      refByClass: "actor:7",
      refByInterface: "actor:7",
    },
    {
      byName: null,
      byTag: [],
      byClassRef: [],
      withInterface: [],
      refByNode: null,
      refByName: null,
      refByTag: null,
      refByClass: null,
      refByInterface: null,
    },
  ]);
});

check("behavior subsystem exposes script debug warnings, trace, and actor inspect data", () => {
  const warningCodes: string[][] = [];
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId === "sender") {
        return (context) => {
          context.messages.send("missing-actor", "Door.Open", { locked: false });
        };
      }
      if (scriptId === "door-handler") return () => undefined;
      return undefined;
    },
  };
  const behavior = new BehaviorSubsystem(
    registry,
    new ActionMap({}),
    () => undefined,
    undefined,
    undefined,
    {
      onMessageWarnings: (warnings) => {
        warningCodes.push(warnings.map((warning) => warning.code));
      },
    },
  );
  behavior.setEntities([
    {
      id: "switch",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Behavior: { scriptId: "sender" },
      },
    },
    {
      id: "actor:2",
      name: "Door",
      components: {
        Transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        [SCRIPT_ACTOR_COMPONENT]: {
          classRef: "blueprints/Door.actor.json",
          nodeId: "door-node",
        },
        [SCRIPT_INTERFACES_COMPONENT]: { interfaces: ["Openable"] },
        [SCRIPT_DISPATCHERS_COMPONENT]: {
          dispatchers: [{ name: "Door.Opened", payload: { locked: "boolean" } }],
        },
        [MESSAGE_BINDINGS_COMPONENT]: {
          bindings: [{ message: "Door.Open", scriptId: "door-handler", target: "self" }],
        },
      },
    },
  ]);

  behavior.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });

  assert.deepEqual(warningCodes, [["missing-target"]]);
  assert.deepEqual(behavior.getScriptActorDebugInfo("actor:2"), {
    entityId: "actor:2",
    name: "Door",
    classRef: "blueprints/Door.actor.json",
    nodeId: "door-node",
    interfaces: ["Openable"],
    dispatchers: [{ name: "Door.Opened", payload: { locked: "boolean" } }],
    subscribers: [
      {
        entityId: "actor:2",
        message: "Door.Open",
        scriptId: "door-handler",
        target: "self",
      },
    ],
  });
  const snapshot = behavior.getScriptMessageDebugSnapshot();
  assert.equal(snapshot.lastFlush.processed, 1);
  assert.equal(snapshot.lastFlush.delivered, 0);
  assert.deepEqual(
    snapshot.recentMessages.map((entry) => ({
      type: entry.envelope.type,
      source: entry.envelope.source,
      target: entry.envelope.target,
      status: entry.status,
      delivered: entry.delivered,
      payload: entry.envelope.payload,
    })),
    [
      {
        type: "Door.Open",
        source: "switch",
        target: "missing-actor",
        status: "missing-target",
        delivered: 0,
        payload: { locked: false },
      },
    ],
  );
  assert.deepEqual(snapshot.subscribers, [
    {
      entityId: "actor:2",
      message: "Door.Open",
      scriptId: "door-handler",
      target: "self",
    },
  ]);
});

check("behavior subsystem smoke: 1000 actors receive 1000 targeted script messages", () => {
  const actorCount = 1000;
  let delivered = 0;
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId === "sender") {
        return (context) => {
          for (let i = 0; i < actorCount; i += 1) {
            context.messages.send(`actor:${i}`, "Perf.Ping", { index: i });
          }
        };
      }
      if (scriptId === "receiver") {
        return (context) => {
          delivered += 1;
          context.state.set("lastIndex", context.message?.payload.index ?? -1);
        };
      }
      return undefined;
    },
  };
  const entities: Entity[] = [
    {
      id: "sender",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Behavior: { scriptId: "sender" },
      },
    },
  ];
  for (let i = 0; i < actorCount; i += 1) {
    entities.push({
      id: `actor:${i}`,
      components: {
        Transform: { position: [i, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        [MESSAGE_BINDINGS_COMPONENT]: {
          bindings: [{ message: "Perf.Ping", scriptId: "receiver", target: "self" }],
        },
      },
    });
  }

  const behavior = new BehaviorSubsystem(
    registry,
    new ActionMap({}),
    () => undefined,
    undefined,
    undefined,
    { messageTraceLimit: 5 },
  );
  behavior.setEntities(entities);
  behavior.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });

  assert.equal(delivered, actorCount);
  assert.deepEqual(behavior.getLastMessageFlushResult(), {
    processed: actorCount,
    delivered: actorCount,
    warnings: [],
  });
  const snapshot = behavior.getScriptMessageDebugSnapshot();
  assert.equal(snapshot.subscribers.length, actorCount);
  assert.equal(snapshot.recentMessages.length, 5);
  assert.deepEqual(
    snapshot.recentMessages.map((entry) => ({
      target: entry.envelope.target,
      status: entry.status,
      delivered: entry.delivered,
    })),
    [
      { target: "actor:995", status: "delivered", delivered: 1 },
      { target: "actor:996", status: "delivered", delivered: 1 },
      { target: "actor:997", status: "delivered", delivered: 1 },
      { target: "actor:998", status: "delivered", delivered: 1 },
      { target: "actor:999", status: "delivered", delivered: 1 },
    ],
  );
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

await checkAsync("rapier backend reports static sensor overlap with a kinematic player", async () => {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setEntities([
    {
      id: "actor:0",
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      },
    },
    {
      id: "character:0",
      components: {
        Transform: { position: [0.25, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
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
    app.update(0.016);
    assert.deepEqual(physics.contactsForEntity("actor:0"), [
      { a: "actor:0", b: "character:0", isSensor: true },
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
// the legacy-adapter fixture yields readable mesh and light entities.
// (`doc` was derived from the inline `layout` fixture above.)
check("saved layout derives mesh + light entities with readable components", () => {
  const meshEntities = doc.entities.filter((entity) => readMeshRendererComponent(entity));
  const lightEntities = doc.entities.filter((entity) => readLightComponent(entity));
  assert.ok(meshEntities.length > 0, "at least one mesh entity from the saved layout");
  assert.ok(lightEntities.length > 0, "at least one light entity from the saved layout");
  for (const entity of meshEntities) {
    assert.ok(readTransformComponent(entity), `transform present for ${entity.id}`);
  }
});

// 6.4 Readiness demo (Â§5): the saved layout carries the scripted entity the
// Game Mode demo relies on â€” a character with the input-driven behavior whose
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

  controller.setSelectionCollisionOverrides({
    collisionEnabled: "query",
    objectType: "trigger",
    responses: { pawn: "overlap", visibility: "ignore" },
    physicalMaterialId: "rubber",
    generateOverlapEvents: false,
    simulationGeneratesHitEvents: false,
  });
  assert.equal(layout.instances[0]?.placements[0]?.collisionEnabled, "query");
  assert.equal(layout.characters[0]?.collisionEnabled, "query");
  assert.equal(layout.instances[0]?.placements[0]?.objectType, "trigger");
  assert.deepEqual(layout.characters[0]?.responses, { pawn: "overlap", visibility: "ignore" });
  assert.equal(layout.instances[0]?.placements[0]?.physicalMaterialId, "rubber");
  assert.equal(layout.characters[0]?.generateOverlapEvents, false);
  assert.equal(layout.instances[0]?.placements[0]?.simulationGeneratesHitEvents, false);
  controller.undo();
  assert.equal(layout.instances[0]?.placements[0]?.collisionEnabled, undefined);
  assert.equal(layout.characters[0]?.collisionEnabled, undefined);
  assert.equal(layout.instances[0]?.placements[0]?.responses, undefined);
  assert.equal(layout.characters[0]?.physicalMaterialId, undefined);

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

  // Â§3 Track B: optional components add (set) + undo (remove) across the
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
// was copied but behavior/particle/interaction were dropped before Â§3 Track B).
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
// arithmetic the editor relies on â€” coverage the engine tests could not reach
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

check("planarMoveStepRelativeToYaw rotates WASD by controller yaw", () => {
  const forward = planarMoveStepRelativeToYaw(
    { forward: true, back: false, left: false, right: false },
    4,
    0.5,
    Math.PI / 2,
  );
  assert.ok(forward.dx < 0);
  assert.ok(Math.abs(forward.dz) < 1e-9);
  assert.ok(Math.abs(Math.hypot(forward.dx, forward.dz) - 2) < 1e-9);

  const diagonal = planarMoveStepRelativeToYaw(
    { forward: true, back: false, left: false, right: true },
    4,
    0.5,
    Math.PI / 2,
  );
  assert.ok(Math.abs(Math.hypot(diagonal.dx, diagonal.dz) - 2) < 1e-9);
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

check("rotateYawToward: turns by a capped shortest-path step", () => {
  yawApproxEqual(rotateYawToward(0, 90, 15), 15);
  yawApproxEqual(rotateYawToward(80, 90, 15), 90);
  yawApproxEqual(rotateYawToward(170, -170, 15), -175);
  yawApproxEqual(rotateYawToward(45, 180, 0), 45);
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

check("desiredSpringArmCameraPose orbits around the authored target offset", () => {
  const pose = desiredSpringArmCameraPose({
    playerPosition: [2, 0, 4],
    springArm: {
      targetArmLength: 3,
      targetOffset: [0, 1, 0],
      socketOffset: [0.5, 0.25, 0],
      enableCameraLag: false,
      cameraLagSpeed: 10,
      doCollisionTest: false,
    },
    controlRotation: { yaw: 0, pitch: 0 },
  });
  assert.deepEqual(pose.target, [2, 1, 4]);
  assert.deepEqual(pose.position, [2.5, 1.25, 7]);
});

check("SpringArm doCollisionTest pulls the camera in front of static blockers", () => {
  const blocker: Aabb3 = { min: [-1, -1, 1.2], max: [1, 1, 1.8] };
  const unclamped = desiredSpringArmCameraPose({
    playerPosition: [0, 0, 0],
    springArm: {
      targetArmLength: 3,
      targetOffset: [0, 0, 0],
      socketOffset: [0, 0, 0],
      enableCameraLag: false,
      cameraLagSpeed: 10,
      doCollisionTest: false,
    },
    controlRotation: { yaw: 0, pitch: 0 },
    blockers: [blocker],
  });
  assert.deepEqual(unclamped.position, [0, 0, 3]);

  const clamped = desiredSpringArmCameraPose({
    playerPosition: [0, 0, 0],
    springArm: {
      targetArmLength: 3,
      targetOffset: [0, 0, 0],
      socketOffset: [0, 0, 0],
      enableCameraLag: false,
      cameraLagSpeed: 10,
      doCollisionTest: true,
    },
    controlRotation: { yaw: 0, pitch: 0 },
    blockers: [blocker],
  });
  assert.equal(clamped.target[2], 0);
  assert.ok(clamped.position[2] < blocker.min[2]);
  assert.ok(clamped.position[2] > 0);

  assert.deepEqual(resolveSpringArmCollision([0, 0, 0], [0, 0, 3], []), [0, 0, 3]);
});

check("cameraProjectionFromComponent maps FOV and clip planes", () => {
  assert.deepEqual(cameraProjectionFromComponent(undefined), { fov: 44, near: 0.1, far: 100 });
  assert.deepEqual(
    cameraProjectionFromComponent({
      fieldOfView: 70,
      nearClip: 0.2,
      farClip: 250,
      isOrthographic: false,
      orthoWidth: 10,
    }),
    { fov: 70, near: 0.2, far: 250 },
  );
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

// Mini Golf v1 vertical-slice physics: pure, deterministic, no Three/DOM/Rapier.
check("miniGolf: putt normalizes direction, clamps power, and clears rest", () => {
  const ball = applyMiniGolfPutt(createMiniGolfBallState([0, 0, 0]), [10, 0], 2, {
    maxPuttSpeed: 6,
    puttPowerExponent: 1,
  });
  assert.equal(ball.resting, false);
  assert.ok(Math.abs(ball.vel[0] - 6) <= 1e-12);
  assert.equal(ball.vel[2], 0);
});

check("miniGolf: rolling friction brings the ball to rest deterministically", () => {
  const course: MiniGolfCourse = {};
  const ball = stepMiniGolfBall(createMiniGolfBallState([0, 0, 0], [1, 0, 0]), course, 2, {
    rollingFriction: 1,
    restSpeed: 0.04,
  });
  assert.equal(ball.resting, true);
  assert.ok(Math.abs(ball.vel[0]) <= 1e-12);
  assert.ok(ball.pos[0] > 0.45 && ball.pos[0] < 0.55);
});

check("miniGolf: slope accelerates the ball downhill and updates surface height", () => {
  const course: MiniGolfCourse = {
    defaultSurface: { height: 1, slope: [0.1, 0], friction: 0 },
  };
  const ball = stepMiniGolfBall(createMiniGolfBallState([0, 1, 0]), course, 0.25, {
    rollingFriction: 0,
  });
  assert.equal(ball.resting, false);
  assert.ok(ball.vel[0] < 0);
  assert.ok(ball.pos[0] < 0);
  assert.equal(ball.pos[1], miniGolfSurfaceHeight(course.defaultSurface!, ball.pos[0], ball.pos[2]));
});

check("miniGolf: overlapping sampled surfaces use the highest height", () => {
  const course: MiniGolfCourse = {
    defaultSurface: { height: 0, friction: 0 },
    surfaces: [
      { bounds: { min: [-1, -1], max: [1, 1] }, height: 0.25, friction: 0 },
      {
        bounds: { min: [-0.5, -0.5], max: [0.5, 0.5] },
        friction: 0,
        heightAt: (x, z) => (Math.abs(x) <= 0.5 && Math.abs(z) <= 0.5 ? 0.75 : null),
      },
    ],
  };
  const ball = stepMiniGolfBall(createMiniGolfBallState([0, 0, 0], [0, 0, 0]), course, 1 / 120, {
    rollingFriction: 0,
  });
  assert.equal(ball.pos[1], 0.75);
});

check("miniGolf: course builder turns complex blocker AABBs into sampled surfaces", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "minigolf-complex-surface",
    loadGroups: [],
    instances: [
      { assetId: "floor", placements: [{ position: [0, 0.82, 0] }] },
      { assetId: "hill", placements: [{ position: [0, 0.82, -1] }] },
    ],
    characters: [],
    lights: [],
  };
  const floorDef: AssetCollisionDef = {
    primitives: [{ shape: "box", size: [1, 0.056, 1], center: [0, 0.032, 0] }],
    complexity: "projectDefault",
    preset: "blockAll",
  };
  const defs = new Map<string, AssetCollisionDef>([
    ["floor", floorDef],
    ["hill", { primitives: [], complexity: "complexAsSimple", preset: "blockAll" }],
  ]);
  const floorTop = 0.82 + 0.032 + 0.056 / 2;
  const hillTop = 1.05;
  const course = buildMiniGolfCourse(
    layout,
    (assetId) => defs.get(assetId),
    [
      { min: [-0.5, 0.82, -0.5], max: [0.5, floorTop, 0.5] },
      { min: [-0.35, 0.97, -1.35], max: [0.35, hillTop, -0.65] },
    ],
  );
  const sampled = course.surfaces
    ?.map((surface) => miniGolfSurfaceHeight(surface, 0, -1))
    .filter((height) => height > 1);
  assert.deepEqual(sampled, [hillTop + 0.035]);
});

check("miniGolf: course builder turns authored tall primitives into walls", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "minigolf-authored-wall",
    loadGroups: [],
    instances: [
      { assetId: "floor", placements: [{ position: [0, 0.82, 0] }] },
      { assetId: "wall", placements: [{ position: [0, 0.82, 0] }] },
    ],
    characters: [],
    lights: [],
  };
  const defs = new Map<string, AssetCollisionDef>([
    [
      "floor",
      {
        primitives: [{ shape: "box", size: [1, 0.056, 1], center: [0, 0.032, 0] }],
        complexity: "projectDefault",
        preset: "blockAll",
      },
    ],
    [
      "wall",
      {
        primitives: [{ shape: "box", size: [0.12, 0.1467, 1], center: [0.44, 0.0734, 0] }],
        complexity: "projectDefault",
        preset: "blockAll",
      },
    ],
  ]);
  const course = buildMiniGolfCourse(layout, (assetId) => defs.get(assetId));
  assert.equal(course.walls?.length, 1);
  const wall = course.walls?.[0];
  assert.ok(wall);
  assert.ok(Math.abs(wall.bounds.min[0] - 0.38) <= 1e-12);
  assert.equal(wall.bounds.min[1], -0.5);
  assert.equal(wall.bounds.max[0], 0.5);
  assert.equal(wall.bounds.max[1], 0.5);
});

check("miniGolf: course builder can scope collision and cup data to one hole", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "minigolf-two-hole-course",
    loadGroups: [],
    instances: [
      {
        assetId: "floor",
        placements: [
          { position: [0, 0.82, 0], metadata: { hole: 1 } },
          { position: [10, 0.82, 0], metadata: { hole: 2 } },
        ],
      },
      {
        assetId: "cup",
        placements: [
          { position: [0, 0.82, -3], metadata: { minigolfRole: "cup", hole: 1 } },
          { position: [10, 0.82, -3], metadata: { minigolfRole: "cup", hole: 2 } },
        ],
      },
    ],
    characters: [],
    lights: [],
  };
  const defs = new Map<string, AssetCollisionDef>([
    [
      "floor",
      {
        primitives: [{ shape: "box", size: [1, 0.056, 1], center: [0, 0.032, 0] }],
        complexity: "projectDefault",
        preset: "blockAll",
      },
    ],
  ]);
  const course = buildMiniGolfCourse(layout, (assetId) => defs.get(assetId), [], { hole: 2 });
  assert.equal(course.cup?.center[0], 10);
  assert.ok(course.bounds);
  assert.ok(course.bounds.min[0] > 9);
  assert.ok(course.surfaces?.every((surface) => surface.bounds!.min[0] > 9));
});

check("miniGolf: course summary totals strokes, par, and relative score", () => {
  const results = [
    { number: 1, par: 3, strokes: 2, score: miniGolfScoreRelativeToPar(2, 3) },
    { number: 2, par: 4, strokes: 5, score: miniGolfScoreRelativeToPar(5, 4) },
    { number: 3, par: 5, strokes: 5, score: miniGolfScoreRelativeToPar(5, 5) },
  ];
  assert.deepEqual(summarizeMiniGolfCourse(results), {
    totalPar: 12,
    totalStrokes: 12,
    score: 0,
  });
  assert.equal(formatMiniGolfScore(-1), "-1");
  assert.equal(formatMiniGolfScore(0), "0");
  assert.equal(formatMiniGolfScore(2), "+2");
  assert.equal(miniGolfResultName(-1), "Birdie");
  assert.equal(miniGolfResultName(0), "Par");
  assert.equal(miniGolfResultName(2), "Double Bogey");
});

check("miniGolf: course builder reads hazard metadata for the active hole", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "minigolf-hazards",
    loadGroups: [],
    instances: [
      {
        assetId: "hazard",
        placements: [
          {
            position: [2, 0, -3],
            metadata: { minigolfRole: "hazard", hole: 1, hazardHalfWidth: 0.25, hazardHalfDepth: 0.5 },
          },
          {
            position: [8, 0, -3],
            metadata: { minigolfRole: "hazard", hole: 2, hazardHalfWidth: 0.5, hazardHalfDepth: 0.5 },
          },
        ],
      },
    ],
    characters: [],
    lights: [],
  };
  const course = buildMiniGolfCourse(layout, () => undefined, [], { hole: 1 });
  assert.deepEqual(course.hazards, [{ min: [1.75, -3.5], max: [2.25, -2.5] }]);
});

check("miniGolf: AABB walls bounce the ball with restitution", () => {
  const course: MiniGolfCourse = {
    walls: [{ bounds: { min: [0.9, -1], max: [1.1, 1] }, restitution: 0.5 }],
  };
  const ball = stepMiniGolfBall(createMiniGolfBallState([0, 0, 0], [2, 0, 0]), course, 0.5, {
    ballRadius: 0.1,
    rollingFriction: 0,
  });
  assert.ok(ball.pos[0] < 0.85);
  assert.ok(ball.vel[0] < 0);
  assert.ok(Math.abs(ball.vel[0] + 1) <= 1e-9);
});

check("miniGolf: cup captures slow balls and lets fast lip-outs pass", () => {
  const course: MiniGolfCourse = {
    cup: { center: [1, 0, 0], radius: 0.25, captureSpeed: 0.7 },
  };
  const slow = stepMiniGolfBall(createMiniGolfBallState([0.7, 0, 0], [0.4, 0, 0]), course, 1, {
    rollingFriction: 0,
  });
  assert.equal(slow.inCup, true);
  assert.deepEqual(slow.pos, [1, 0, 0]);

  const fast = stepMiniGolfBall(createMiniGolfBallState([0.7, 0, 0], [2, 0, 0]), course, 0.5, {
    rollingFriction: 0,
  });
  assert.equal(fast.inCup, false);
  assert.ok(fast.pos[0] > 1.2);
});

check("miniGolf: out-of-bounds resets to the last safe position and adds a penalty", () => {
  const course: MiniGolfCourse = { bounds: { min: [-1, -1], max: [1, 1] } };
  const ball = stepMiniGolfBall(createMiniGolfBallState([0, 0, 0], [3, 0, 0]), course, 1, {
    rollingFriction: 0,
  });
  assert.equal(ball.outOfBounds, true);
  assert.equal(ball.penaltyStrokes, 1);
  assert.equal(ball.resting, true);
  assert.deepEqual(ball.pos, [0, 0, 0]);
});

check("miniGolf: drag aim maps screen pull opposite to camera-relative shot direction", () => {
  const aim = computeMiniGolfAim({
    start: [100, 100],
    current: [100, 200],
    maxDragPixels: 100,
    cameraRight: [1, 0],
    cameraForward: [0, -1],
  });
  assert.equal(aim.power, 1);
  assert.ok(Math.abs(aim.direction[0]) <= 1e-12);
  assert.ok(Math.abs(aim.direction[1] + 1) <= 1e-12);
});

check("miniGolf: drag aim clamps power and normalizes diagonal direction", () => {
  const aim = computeMiniGolfAim({
    start: [0, 0],
    current: [-300, 300],
    maxDragPixels: 120,
    cameraRight: [1, 0],
    cameraForward: [0, -1],
  });
  assert.equal(aim.power, 1);
  assert.ok(Math.abs(Math.hypot(aim.direction[0], aim.direction[1]) - 1) <= 1e-12);
  assert.ok(aim.direction[0] > 0);
  assert.ok(aim.direction[1] < 0);
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

// complexAsSimple builds a trimesh collider; the AABB-based player movement must
// see one blocker per triangle (so the player can walk into an L-shaped wall's
// concave corner), not a single enclosing box.
check("physics subsystem expands a trimesh collider into per-triangle blockers", () => {
  const physics = new PhysicsSubsystem();
  physics.setEntities([
    {
      id: "wall",
      components: {
        Transform: { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box",
          size: [4, 1, 4],
          isStatic: true,
          isSensor: false,
          primitives: [
            {
              shape: "trimesh",
              size: [4, 1, 4],
              // Two separate triangles (an L's two arms) with a gap between them.
              vertices: [
                [-2, 0, -2],
                [-1, 0, -2],
                [-2, 1, -2],
                [1, 0, 2],
                [2, 0, 2],
                [1, 1, 2],
              ],
              indices: [0, 1, 2, 3, 4, 5],
            },
          ],
        },
      },
    },
  ]);
  const blockers = physics.staticBlockerAabbs();
  assert.equal(blockers.length, 2); // one AABB per triangle, not one enclosing box
  // Each triangle's AABB is translated by the body origin (10, 0, 0); the gap
  // between x=9 and x=11 is walkable (the concave region of the L).
  assert.deepEqual(blockers[0], { min: [8, 0, -2], max: [9, 1, -2] });
  assert.deepEqual(blockers[1], { min: [11, 0, 2], max: [12, 1, 2] });
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

check("resolveLocomotionClip: an authored anim-set overrides the clip-name heuristic", () => {
  // The asset names its clips arbitrarily; the heuristic vocabulary can't guess them.
  const available = new Set(["Anim_Stand", "Anim_Stroll", "Anim_Dash"]);
  const animationSet = { idle: "Anim_Stand", walk: "Anim_Stroll", run: "Anim_Dash" };
  assert.equal(resolveLocomotionClip("idle", available, animationSet), "Anim_Stand");
  assert.equal(resolveLocomotionClip("walk", available, animationSet), "Anim_Stroll");
  assert.equal(resolveLocomotionClip("run", available, animationSet), "Anim_Dash");
  // Roles with no authored clip walk the role-fallback chain: run->walk->idle,
  // fall->jump->idle. Here jump/fall are unauthored, so both degrade to idle's clip.
  assert.equal(resolveLocomotionClip("jump", available, animationSet), "Anim_Stand");
  assert.equal(resolveLocomotionClip("fall", available, animationSet), "Anim_Stand");
  // A missing run with an authored walk falls back to the authored walk clip.
  assert.equal(
    resolveLocomotionClip("run", new Set(["Anim_Stand", "Anim_Stroll"]), {
      idle: "Anim_Stand",
      walk: "Anim_Stroll",
    }),
    "Anim_Stroll",
  );
  // A stale authored clip (absent from the asset) is skipped for the name heuristic.
  assert.equal(resolveLocomotionClip("idle", new Set(["idle"]), { idle: "Gone" }), "idle");
});

check("locomotionConfigForSkeleton: derives blend space + anim-set, tolerates no sidecar", () => {
  const empty = locomotionConfigForSkeleton(null);
  assert.equal(empty.blendSpace, null);
  assert.deepEqual(empty.animationSet, {});

  const config = locomotionConfigForSkeleton({
    animationSet: { idle: "idle", walk: "walk" },
    blendSpaces: [
      {
        name: "Locomotion",
        type: "1d",
        axisX: { name: "Speed", min: 0, max: 4 },
        samples: [
          { clip: "idle", x: 0 },
          { clip: "walk", x: 4 },
        ],
      },
    ],
  });
  assert.equal(config.blendSpace?.name, "Locomotion");
  assert.deepEqual(config.animationSet, { idle: "idle", walk: "walk" });
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

check("CrossfadeAnimator: playBlend enters blend mode and play() leaves it", () => {
  const root = new Object3D();
  const clips = [
    new AnimationClip("idle", 1, []),
    new AnimationClip("walk", 1, []),
    new AnimationClip("run", 1, []),
    new AnimationClip("jump", 1, []),
  ];
  const animator = new CrossfadeAnimator(root, clips);
  animator.play("idle", 0);
  assert.equal(animator.isBlending, false);

  // A weighted blend takes over: clip mode clears, blend mode engages.
  animator.playBlend([
    { clip: "idle", weight: 0.3 },
    { clip: "walk", weight: 0.7 },
  ]);
  assert.equal(animator.isBlending, true);
  assert.equal(animator.currentClip, null);

  // Unknown / zero-weight clips are ignored; an all-zero set is a no-op (holds).
  animator.playBlend([{ clip: "walk", weight: 1 }, { clip: "ghost", weight: 5 }]);
  assert.equal(animator.isBlending, true);
  animator.playBlend([]);
  assert.equal(animator.isBlending, true);

  // Switching to a single clip (e.g. going airborne) exits blend mode cleanly.
  animator.play("jump", 0.1);
  assert.equal(animator.isBlending, false);
  assert.equal(animator.currentClip, "jump");
});

// A rigid character rig (Kenney "blocky" style): root -> legs + torso -> arms + head.
const buildCharacterRig = (): Object3D => {
  const make = (name: string): Object3D => {
    const node = new Object3D();
    node.name = name;
    return node;
  };
  const character = make("character");
  const root = make("root");
  const torso = make("torso");
  torso.add(make("arm-left"), make("arm-right"), make("head"));
  root.add(make("leg-left"), make("leg-right"), torso);
  character.add(root);
  return character;
};
const positionTrack = (node: string): VectorKeyframeTrack =>
  new VectorKeyframeTrack(`${node}.position`, [0, 0.5], [0, 0, 0, 0, 0, 0]);
const buildLayeredClips = (): AnimationClip[] => [
  new AnimationClip("walk", 0.5, ["root", "leg-left", "leg-right", "arm-left", "arm-right", "head"].map(positionTrack)),
  new AnimationClip("holding-both", 0.5, ["arm-left", "arm-right"].map(positionTrack)),
  new AnimationClip("holding-both-shoot", 0.5, ["torso", "arm-right", "arm-left", "head"].map(positionTrack)),
];

check("root motion clip filtering pins horizontal root translation for in-place playback", () => {
  const root = new VectorKeyframeTrack("Hips.position", [0, 0.5, 1], [0, 1, 0, 2, 2, 4, 5, 3, 9]);
  const hand = new VectorKeyframeTrack("Hand.position", [0, 1], [1, 0, 0, 2, 0, 0]);
  const clip = new AnimationClip("run", 1, [root, hand]);

  const filtered = applyRootMotionToClip(clip, { clip: "run", mode: "lockXZ" });

  assert.notEqual(filtered, clip);
  assert.deepEqual(Array.from(filtered.tracks[0]!.values), [0, 1, 0, 0, 2, 0, 0, 3, 0]);
  assert.deepEqual(Array.from(filtered.tracks[1]!.values), [1, 0, 0, 2, 0, 0]);
  assert.deepEqual(Array.from(clip.tracks[0]!.values), [0, 1, 0, 2, 2, 4, 5, 3, 9]);
});

check("root motion clip filtering can pin XYZ on an authored root node", () => {
  const clip = new AnimationClip("jump", 1, [
    new VectorKeyframeTrack("Armature.position", [0, 1], [0, 4, 0, 0, 6, 3]),
    new VectorKeyframeTrack("Hips.position", [0, 1], [10, 1, 10, 12, 2, 12]),
  ]);

  const filtered = applyRootMotionToClip(clip, {
    clip: "jump",
    mode: "lockXYZ",
    rootNode: "Armature",
  });

  assert.deepEqual(Array.from(filtered.tracks[0]!.values), [0, 4, 0, 0, 4, 0]);
  assert.deepEqual(Array.from(filtered.tracks[1]!.values), [10, 1, 10, 12, 2, 12]);
  assert.deepEqual(rootMotionPositionNodes(clip), ["Armature", "Hips"]);
});

check("splitClipsByUpperBody: routes each track to the half its node belongs to", () => {
  const rig = buildCharacterRig();
  const upper = collectSubtreeNodeNames(rig, "torso");
  assert.deepEqual([...upper].sort(), ["arm-left", "arm-right", "head", "torso"]);
  // An absent root bone yields an empty mask (everything stays lower).
  assert.equal(collectSubtreeNodeNames(rig, "nope").size, 0);

  const split = splitClipsByUpperBody(buildLayeredClips(), upper);
  const walkLower = split.lower.find((clip) => clip.name === "walk")!;
  const walkUpper = split.upper.find((clip) => clip.name === "walk")!;
  assert.deepEqual(
    walkLower.tracks.map((track) => track.name).sort(),
    ["leg-left.position", "leg-right.position", "root.position"],
  );
  assert.deepEqual(
    walkUpper.tracks.map((track) => track.name).sort(),
    ["arm-left.position", "arm-right.position", "head.position"],
  );
  // A purely upper-body clip leaves the lower variant empty (still emitted by name).
  const shootLower = split.lower.find((clip) => clip.name === "holding-both-shoot")!;
  assert.equal(shootLower.tracks.length, 0);
});

check("LayeredCharacterAnimator: upper montage/aim layers over locomotion legs", () => {
  const rig = buildCharacterRig();
  const animator = new LayeredCharacterAnimator(rig, buildLayeredClips(), "torso");
  assert.equal(animator.hasUpperBody, true);

  // Plain locomotion: legs and (passthrough) upper both follow the walk clip.
  animator.playLocomotion("walk", 0);
  assert.equal(animator.lowerClip, "walk");
  assert.equal(animator.upperClip, "walk");

  // Aim holds an upper pose; the legs keep walking.
  animator.setAim("holding-both", 0);
  assert.equal(animator.upperClip, "holding-both");
  assert.equal(animator.lowerClip, "walk");

  // Fire is a one-shot upper montage that returns to the aim pose when it ends.
  animator.playMontage("holding-both-shoot", { blendInSeconds: 0 });
  assert.equal(animator.upperClip, "holding-both-shoot");
  assert.equal(animator.isMontaging, true);
  animator.update(0.1); // mid-montage
  assert.equal(animator.isMontaging, true);
  animator.update(10); // past its 0.5s duration -> returns to aim
  assert.equal(animator.isMontaging, false);
  assert.equal(animator.upperClip, "holding-both");
  assert.equal(animator.lowerClip, "walk");

  // Releasing aim drops the upper body back to locomotion passthrough.
  animator.setAim(null, 0);
  assert.equal(animator.upperClip, "walk");

  // A missing upper-body bone disables layering (caller falls back to single-channel).
  const flat = new LayeredCharacterAnimator(rig, buildLayeredClips(), "missing");
  assert.equal(flat.hasUpperBody, false);
});

check("pickLocomotionBlendSpace: prefers a named 1D space, else the first usable one", () => {
  const oneDimensional = (name: string): AssetSkeletonBlendSpaceDef => ({
    name,
    type: "1d",
    axisX: { name: "Speed", min: 0, max: 4 },
    samples: [
      { clip: "idle", x: 0 },
      { clip: "walk", x: 4 },
    ],
  });
  assert.equal(pickLocomotionBlendSpace([]), null);
  // A 2D space or an empty 1D space never qualifies for ground locomotion.
  assert.equal(
    pickLocomotionBlendSpace([
      { name: "Aim", type: "2d", axisX: { name: "X", min: -1, max: 1 }, axisY: { name: "Y", min: -1, max: 1 }, samples: [{ clip: "c", x: 0, y: 0 }] },
      { name: "Empty", type: "1d", axisX: { name: "Speed", min: 0, max: 4 }, samples: [] },
    ]),
    null,
  );
  // The case-insensitive "Locomotion" name wins over an earlier 1D space.
  const picked = pickLocomotionBlendSpace([oneDimensional("Movement"), oneDimensional("locomotion")]);
  assert.equal(picked?.name, "locomotion");
  // Otherwise the first usable 1D space is chosen.
  assert.equal(pickLocomotionBlendSpace([oneDimensional("Movement")])?.name, "Movement");
});

check("resolveLocomotionAnimation: blends on the ground, falls back to a clip airborne", () => {
  const available = new Set(["idle", "walk", "run", "jump"]);
  const blend: AssetSkeletonBlendSpaceDef = {
    name: "Locomotion",
    type: "1d",
    axisX: { name: "Speed", min: 0, max: 4 },
    samples: [
      { clip: "idle", x: 0 },
      { clip: "walk", x: 2 },
      { clip: "run", x: 4 },
    ],
  };
  const config = (blendSpace: AssetSkeletonBlendSpaceDef | null): LocomotionAssetConfig => ({
    blendSpace,
    animationSet: {},
  });
  // Grounded mid-speed blends the two bracketing clips by weight.
  const blended = resolveLocomotionAnimation(ground(1), available, config(blend));
  assert.equal(blended.kind, "blend");
  if (blended.kind === "blend") {
    assert.deepEqual(blended.weights, [
      { clip: "idle", weight: 0.5 },
      { clip: "walk", weight: 0.5 },
    ]);
  }
  // Airborne ignores the blend space and uses the single-clip selector.
  const airborne = resolveLocomotionAnimation(
    { planarSpeed: 0, grounded: false, velocityY: 4 },
    available,
    config(blend),
  );
  assert.deepEqual(airborne, { kind: "clip", clip: "jump" });
  // No blend space -> single clip even on the ground.
  assert.deepEqual(resolveLocomotionAnimation(ground(2), available, config(null)), {
    kind: "clip",
    clip: "walk",
  });
  // A blend space whose clips the asset lacks degrades to the clip fallback.
  const missingClips: AssetSkeletonBlendSpaceDef = {
    name: "Locomotion",
    type: "1d",
    axisX: { name: "Speed", min: 0, max: 4 },
    samples: [{ clip: "absent", x: 0 }],
  };
  assert.deepEqual(resolveLocomotionAnimation(ground(0), available, config(missingClips)), {
    kind: "clip",
    clip: "idle",
  });
  // The clip-fallback branch honours the authored anim-set (custom clip names).
  const authored: LocomotionAssetConfig = {
    blendSpace: null,
    animationSet: { jump: "Anim_Leap", walk: "Anim_Stroll" },
  };
  assert.deepEqual(
    resolveLocomotionAnimation(
      { planarSpeed: 0, grounded: false, velocityY: 5 },
      new Set(["Anim_Leap", "Anim_Stroll"]),
      authored,
    ),
    { kind: "clip", clip: "Anim_Leap" },
  );
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

check("placement collision overrides beat asset collision defaults at runtime", () => {
  const overrideLayout: RoomLayout = {
    schema: 1,
    name: "collision-override-fixture",
    loadGroups: [],
    instances: [
      {
        assetId: "crate",
        placements: [
          {
            position: [0, 0, 0],
            collisionEnabled: "query",
            objectType: "trigger",
            responses: { pawn: "ignore" },
            physicalMaterialId: "rubber",
            generateOverlapEvents: true,
            simulationGeneratesHitEvents: false,
          },
        ],
      },
    ],
    characters: [],
    lights: [],
  };
  const defs = new Map<string, AssetCollisionDef>([
    [
      "crate",
      {
        primitives: [{ shape: "box", size: [1, 1, 1] }],
        complexity: "projectDefault",
        preset: "blockAll",
        physicalMaterialId: "metal",
        generateOverlapEvents: false,
      },
    ],
  ]);
  const doc = roomLayoutToSceneDocument(overrideLayout, { collisionDefs: defs });
  const entity = doc.entities.find((e) => e.id === instanceEntityId("crate", 0));
  const collider = entity ? readColliderComponent(entity) : undefined;
  assert.equal(collider?.isSensor, true);
  assert.equal(collider?.friction, 0.9);
  assert.equal(collider?.restitution, 0.7);
  assert.equal(collider?.generateOverlapEvents, true);
  assert.equal(collider?.simulationGeneratesHitEvents, false);

  const triggerGroups = collisionInteractionGroups(
    resolveCollisionProfile("custom", {
      collisionEnabled: "query",
      objectType: "trigger",
      responses: { pawn: "ignore" },
    }),
  );
  assert.equal(collider?.collisionGroups, triggerGroups);
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

check("assetCollisionDefHasCollider keeps complexAsSimple even with no primitives", () => {
  const empty: AssetCollisionDef = { primitives: [], complexity: "projectDefault", preset: "blockAll" };
  const complex: AssetCollisionDef = { primitives: [], complexity: "complexAsSimple", preset: "blockAll" };
  const withPrims: AssetCollisionDef = {
    primitives: [{ shape: "box", size: [1, 1, 1] }],
    complexity: "projectDefault",
    preset: "blockAll",
  };
  assert.equal(assetCollisionDefHasCollider(empty), false);
  assert.equal(assetCollisionDefHasCollider(complex), true);
  assert.equal(assetCollisionDefHasCollider(withPrims), true);
  const ids = complexAsSimpleAssetIds(
    new Map([["a", empty], ["b", complex], ["c", withPrims]]),
  );
  assert.deepEqual([...ids], ["b"]);
});

check("adapter builds a static trimesh collider for complexAsSimple and ignores simulate", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "complex-as-simple-fixture",
    loadGroups: [],
    // simulatePhysics is set, but complexAsSimple is static-only and overrides it.
    instances: [
      { assetId: "wall", placements: [{ position: [0, 0, 0], scale: 2, simulatePhysics: true }] },
    ],
    characters: [],
    lights: [],
  };
  const defs = new Map<string, AssetCollisionDef>([
    ["wall", { primitives: [], complexity: "complexAsSimple", preset: "blockAll" }],
  ]);
  const vertices: [number, number, number][] = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const complexCollisionMeshes = new Map([
    [
      "wall",
      {
        vertices,
        indices: [0, 1, 2],
        size: [2, 1, 0] as [number, number, number],
        center: [0, 0.5, 0] as [number, number, number],
      },
    ],
  ]);
  const doc = roomLayoutToSceneDocument(layout, { collisionDefs: defs, complexCollisionMeshes });
  const entity = doc.entities.find((e) => e.id === instanceEntityId("wall", 0));
  const collider = entity ? readColliderComponent(entity) : undefined;
  const primitive = collider?.primitives?.[0];
  assert.equal(primitive?.shape, "trimesh");
  // Placement scale 2 bakes into the vertices and the derived AABB.
  assert.deepEqual(primitive?.vertices?.[1], [2, 0, 0]);
  assert.deepEqual(primitive?.indices, [0, 1, 2]);
  assert.deepEqual(primitive?.size, [4, 2, 0]);
  assert.deepEqual(collider?.center, [0, 1, 0]);
  assert.equal(collider?.isStatic, true);
  // Static-only: the simulatePhysics flag is dropped, not honored.
  assert.equal(collider?.simulatePhysics, undefined);
});

check("complexAsSimple falls back to the auto box when no render mesh is supplied", () => {
  const layout: RoomLayout = {
    schema: 1,
    name: "complex-as-simple-no-mesh",
    loadGroups: [],
    instances: [{ assetId: "wall", placements: [{ position: [0, 0, 0] }] }],
    characters: [],
    lights: [],
  };
  const defs = new Map<string, AssetCollisionDef>([
    ["wall", { primitives: [], complexity: "complexAsSimple", preset: "blockAll" }],
  ]);
  // No complexCollisionMeshes: the adapter can't build a trimesh, so it uses the
  // resolver's bounding box and stays a plain box collider.
  const doc = roomLayoutToSceneDocument(layout, {
    collisionDefs: defs,
    colliderBox: () => ({
      size: [3, 3, 3] as [number, number, number],
      center: [0, 0, 0] as [number, number, number],
    }),
  });
  const entity = doc.entities.find((e) => e.id === instanceEntityId("wall", 0));
  const collider = entity ? readColliderComponent(entity) : undefined;
  assert.equal(collider?.shape, "box");
  assert.equal(collider?.primitives, undefined);
  assert.deepEqual(collider?.size, [3, 3, 3]);
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

check("collisionWireboxes draws convex primitive points instead of the AABB box", () => {
  const wireLayout: RoomLayout = {
    schema: 1,
    name: "convex-wirebox-fixture",
    loadGroups: [],
    instances: [{ assetId: "rock", placements: [{ position: [1, 0, 0], scale: 2 }] }],
    characters: [],
    lights: [],
  };
  const bounds = new Map([["rock", new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))]]);
  const tetra: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const defs = new Map<string, AssetCollisionDef>([
    [
      "rock",
      {
        primitives: [{ shape: "convex", size: [1, 1, 1], points: tetra }],
        complexity: "projectDefault",
        preset: "blockAll",
      },
    ],
  ]);
  const authored = collisionWireboxes(wireLayout, bounds, defs);
  assert.equal(authored.length, 1);
  assert.equal(authored[0]!.segments.length, 12);
  const box = authored[0]!.box;
  assert.deepEqual(box.min.toArray(), [1, 0, 0]);
  assert.deepEqual(box.max.toArray(), [3, 2, 2]);
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

// Â§3 Interaction runtime: the pure trigger core decides fire/cooldown; the
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

check("interact behavior emits an Interaction.Activated script message", () => {
  const gameRegistry = createBehaviorRegistry();
  const messages: Array<{ listener: string; source: string | undefined; action: unknown }> = [];
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId === "record-interaction") {
        return (context) => {
          messages.push({
            listener: context.entityId,
            source: context.message?.source,
            action: context.message?.payload.action,
          });
        };
      }
      return gameRegistry.get(scriptId);
    },
  };
  const physics = new PhysicsSubsystem();
  const lever: Entity = {
    id: "lever:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      Behavior: { scriptId: "interact" },
      Interaction: { action: "pull-lever", prompt: "Pull" },
    },
  };
  const listener: Entity = {
    id: "listener:0",
    components: {
      Transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      [MESSAGE_BINDINGS_COMPONENT]: {
        bindings: [
          { message: "Interaction.Activated", scriptId: "record-interaction", target: "any" },
          { message: "Interaction.pull-lever", scriptId: "record-interaction", target: "any" },
        ],
      },
    },
  };
  const player: Entity = {
    id: "player:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
    },
  };

  physics.setEntities([lever, listener, player]);
  const behavior = new BehaviorSubsystem(registry, new ActionMap({}), () => undefined, physics);
  behavior.setEntities([lever, listener, player]);
  const app = new EngineApp();
  app.registerSubsystem(physics);
  app.registerSubsystem(behavior);
  app.update(0.016);

  assert.deepEqual(messages, [
    { listener: "listener:0", source: "lever:0", action: "pull-lever" },
    { listener: "listener:0", source: "lever:0", action: "pull-lever" },
  ]);
  assert.deepEqual(behavior.getLastMessageFlushResult(), {
    processed: 2,
    delivered: 2,
    warnings: [],
  });
});

check("interact behavior sends Usable.Use and drives Toggleable lamp message chain", () => {
  const lightToggles: Array<{ id: string; enabled: boolean }> = [];
  const particles: string[] = [];
  const overlaps: Array<{ id: string; action: string; prompt: string | undefined; overlapping: boolean }> = [];
  const messages: Array<{ id: string; type: string; enabled: unknown }> = [];
  const gameRegistry = createBehaviorRegistry({
    onActorLightToggle: (id, enabled) => lightToggles.push({ id, enabled }),
    onActorParticleEffect: (id) => particles.push(id),
    onInteractionOverlap: (id, action, prompt, overlapping) =>
      overlaps.push({ id, action, prompt, overlapping }),
  });
  const registry: BehaviorRegistry = {
    get: (scriptId) => {
      if (scriptId === "record-message") {
        return (context) => {
          messages.push({
            id: context.entityId,
            type: context.message?.type ?? "",
            enabled: context.message?.payload.enabled,
          });
        };
      }
      return gameRegistry.get(scriptId);
    },
  };
  const physics = new PhysicsSubsystem();
  const actions = new ActionMap({ KeyE: "interact" });
  const lamp: Entity = {
    id: "actor:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      Behavior: { scriptId: "interact", params: { inputAction: "interact", useRange: 2 } },
      Interaction: { action: "use", prompt: "Press E Key" },
      [SCRIPT_INTERFACES_COMPONENT]: { interfaces: ["Usable", "Toggleable"] },
      [MESSAGE_BINDINGS_COMPONENT]: {
        bindings: [
          { message: "Usable.Use", scriptId: "use-toggleable" },
          { message: "Toggleable.Toggle", scriptId: "lamp-toggle" },
          { message: "Lamp.Toggled", scriptId: "record-message", target: "any" },
          { message: "Interaction.Activated", scriptId: "record-message", target: "any" },
          { message: "Interaction.use", scriptId: "record-message", target: "any" },
        ],
      },
    },
  };
  const player: Entity = {
    id: "player:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
    },
  };
  physics.setEntities([lamp, player]);
  const behavior = new BehaviorSubsystem(registry, actions, () => undefined, physics);
  behavior.setEntities([lamp, player]);
  const app = new EngineApp();
  app.registerSubsystem(new InputSubsystem(actions));
  app.registerSubsystem(physics);
  app.registerSubsystem(behavior);

  app.update(0.016);
  assert.deepEqual(overlaps, [
    { id: "actor:0", action: "use", prompt: "Press E Key", overlapping: true },
  ]);
  assert.deepEqual(lightToggles, []);

  actions.handleDown("KeyE");
  app.update(0.016);
  assert.deepEqual(lightToggles, [{ id: "actor:0", enabled: false }]);
  assert.deepEqual(particles, ["actor:0"]);
  assert.deepEqual(messages.map((message) => message.type), [
    "Interaction.Activated",
    "Interaction.use",
    "Lamp.Toggled",
  ]);
  assert.deepEqual(messages.at(-1), { id: "actor:0", type: "Lamp.Toggled", enabled: false });
  assert.deepEqual(behavior.getLastMessageFlushResult(), {
    processed: 5,
    delivered: 5,
    warnings: [],
  });

  physics.setEntityTransform("player:0", {
    position: [5, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  app.update(0.016);
  assert.deepEqual(overlaps, [
    { id: "actor:0", action: "use", prompt: "Press E Key", overlapping: true },
    { id: "actor:0", action: "use", prompt: "Press E Key", overlapping: false },
  ]);
});

check("interact behavior: can require an input action while inside the sensor", () => {
  const fired: Array<{ id: string; action: string }> = [];
  const overlaps: Array<{ id: string; action: string; prompt: string | undefined; overlapping: boolean }> = [];
  const registry = createBehaviorRegistry({
    onInteraction: (id, action) => fired.push({ id, action }),
    onInteractionOverlap: (id, action, prompt, overlapping) =>
      overlaps.push({ id, action, prompt, overlapping }),
  });
  const physics = new PhysicsSubsystem();
  const actions = new ActionMap({ KeyE: "interact" });
  const lamp: Entity = {
    id: "actor:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: true },
      Behavior: { scriptId: "interact", params: { inputAction: "interact" } },
      Interaction: { action: "toggle-actor-light" },
    },
  };
  const player: Entity = {
    id: "player:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false },
    },
  };
  physics.setEntities([lamp, player]);
  const behavior = new BehaviorSubsystem(registry, actions, () => undefined, physics);
  behavior.setEntities([lamp, player]);
  const app = new EngineApp();
  app.registerSubsystem(new InputSubsystem(actions));
  app.registerSubsystem(physics);
  app.registerSubsystem(behavior);

  app.update(0.016);
  assert.deepEqual(fired, []);
  assert.deepEqual(overlaps, [
    { id: "actor:0", action: "toggle-actor-light", prompt: undefined, overlapping: true },
  ]);

  physics.setEntityTransform("player:0", {
    position: [5, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  app.update(0.016);
  assert.deepEqual(overlaps, [
    { id: "actor:0", action: "toggle-actor-light", prompt: undefined, overlapping: true },
    { id: "actor:0", action: "toggle-actor-light", prompt: undefined, overlapping: false },
  ]);

  actions.handleDown("KeyE");
  physics.setEntityTransform("player:0", {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  app.update(0.016);
  app.update(0.016);
  assert.deepEqual(fired, [{ id: "actor:0", action: "toggle-actor-light" }]);

  actions.handleUp("KeyE");
  app.update(0.016);
  actions.handleDown("KeyE");
  app.update(0.016);
  assert.deepEqual(fired, [
    { id: "actor:0", action: "toggle-actor-light" },
    { id: "actor:0", action: "toggle-actor-light" },
  ]);
});

// playground.json is now a free-editing sandbox scene (no pinned content), so it
// is intentionally not asserted here. Save-validator round-trip coverage lives on
// the curated render-test-room layout above ("save validator round-trips the
// saved layout").

// ---------------------------------------------------------------------------
// Gameplay framework (Game Mode / Pawn / Controller) â€” catalog, registry,
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
  opts: {
    input?: boolean;
    player?: boolean;
    actorMovement?: boolean;
    animations?: AnimationClip[];
    entity?: Entity;
  } = {},
): RuntimeCharacterRef {
  const placement: LayoutCharacter = {
    assetId: "hero",
    position: [0, 0, 0],
  };
  if (opts.input) placement.behavior = { script: "input-move" };
  if (opts.player) placement.metadata = { player: true };
  return {
    index,
    entityId: opts.actorMovement ? actorInstanceEntityId(index) : characterEntityId(index),
    object: new Object3D(),
    gltf: { animations: opts.animations ?? [] } as unknown as GLTF,
    placement,
    ...(opts.actorMovement
      ? {
          classRef: "assets/starter-content/Script/Player.actor.json",
          parentClass: "character" as const,
          hasCharacterMovement: true,
        }
      : {}),
    ...(opts.entity ? { entity: opts.entity } : {}),
  };
}

function makeGameModeContext(options: {
  camera?: PerspectiveCamera;
  actions?: ActionMap;
  characters?: RuntimeCharacterRef[];
  locomotion?: Map<string, LocomotionInput>;
  /** Look deltas to hand out one-per-call (e.g. simulate right-drag turns). */
  lookDeltas?: { dx: number; dy: number }[];
  blockers?: Aabb3[];
}): {
  context: GameModeContext;
  mixers: AnimationMixer[];
  cameraControlled: () => boolean;
  inputModes: InputMode[];
  pointerLookModes: PointerLookMode[];
  mouseCursorVisible: boolean[];
} {
  let controlled = false;
  let inputMode: InputMode = "game";
  const mixers: AnimationMixer[] = [];
  const inputModes: InputMode[] = [];
  const pointerLookModes: PointerLookMode[] = [];
  const mouseCursorVisible: boolean[] = [];
  const locomotion = options.locomotion ?? new Map<string, LocomotionInput>();
  const lookDeltas = options.lookDeltas ? [...options.lookDeltas] : [];
  const blockers = options.blockers ?? [];
  const context: GameModeContext = {
    camera: options.camera ?? new PerspectiveCamera(),
    actions: options.actions ?? new ActionMap(),
    characters: options.characters ?? [],
    getLocomotion: (id) => locomotion.get(id),
    staticBlockerAabbs: () => blockers,
    addMixer: (mixer) => mixers.push(mixer),
    markCameraControlled: () => {
      controlled = true;
    },
    consumeLookDelta: () => lookDeltas.shift() ?? { dx: 0, dy: 0 },
    getInputMode: () => inputMode,
    setInputMode: (mode) => {
      inputMode = mode;
      inputModes.push(mode);
    },
    setMouseCursorVisible: (visible) => {
      mouseCursorVisible.push(visible);
    },
    setPointerLookMode: (mode) => {
      pointerLookModes.push(mode);
    },
  };
  return {
    context,
    mixers,
    cameraControlled: () => controlled,
    inputModes,
    pointerLookModes,
    mouseCursorVisible,
  };
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

check("isGameModeClassRef distinguishes project class refs from built-in ids", () => {
  assert.ok(isGameModeClassRef("assets/Script/MyGameMode.actor.json"));
  assert.equal(isGameModeClassRef("forge.tpsCharacter"), false);
  assert.equal(isGameModeClassRef(undefined), false);
});

check("normalizeGameModeId passes a project Game Mode class ref through unchanged", () => {
  const ref = "assets/Script/MyGameMode.actor.json";
  assert.equal(normalizeGameModeId(ref), ref);
});

check("readGameModeDefaultPawnClassRef reads the authored variable default, else undefined", () => {
  const def = normalizeActorScriptDef({
    name: "GM",
    parentClass: "gameMode",
    variables: [
      { key: "defaultPawnClassRef", type: "text", default: "assets/Script/Player.actor.json" },
    ],
  });
  assert.equal(readGameModeDefaultPawnClassRef(def), "assets/Script/Player.actor.json");
  assert.equal(
    readGameModeDefaultPawnClassRef(defaultActorScriptDef("Empty", "gameMode")),
    undefined,
  );
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

check("save validator preserves worldSettings.hudWidget + pauseMenuWidget + locale", () => {
  const out = validateLayout({
    schema: 1,
    name: "ui",
    loadGroups: [],
    instances: [],
    characters: [],
    worldSettings: { hudWidget: "hud", pauseMenuWidget: "menu", locale: "tr" },
  }) as RoomLayout;
  assert.equal(out.worldSettings?.hudWidget, "hud");
  assert.equal(out.worldSettings?.pauseMenuWidget, "menu");
  assert.equal(out.worldSettings?.locale, "tr");
  assert.throws(() =>
    validateLayout({
      schema: 1,
      name: "ui",
      loadGroups: [],
      instances: [],
      characters: [],
      worldSettings: { hudWidget: "" },
    }),
  );
  assert.throws(() =>
    validateLayout({
      schema: 1,
      name: "ui",
      loadGroups: [],
      instances: [],
      characters: [],
      worldSettings: { locale: "" },
    }),
  );
});

check("save validator preserves worldSettings.gameRules + win/lose screens", () => {
  const out = validateLayout({
    schema: 1,
    name: "rules",
    loadGroups: [],
    instances: [],
    characters: [],
    worldSettings: {
      winScreenWidget: "win",
      loseScreenWidget: "lose",
      gameRules: {
        variables: [{ id: "score", initial: 0, label: "Score" }],
        objectives: [{ id: "coins", label: "Coins", target: 3, optional: false }],
        timer: { durationSeconds: 60, direction: "down", onExpire: "lose" },
        winWhenObjectivesComplete: true,
        loseWhenVariableDepleted: "lives",
      },
    },
  }) as RoomLayout;
  assert.equal(out.worldSettings?.winScreenWidget, "win");
  assert.equal(out.worldSettings?.loseScreenWidget, "lose");
  const rules = out.worldSettings?.gameRules;
  assert.equal(rules?.variables?.[0]?.id, "score");
  assert.equal(rules?.variables?.[0]?.label, "Score");
  assert.equal(rules?.objectives?.[0]?.target, 3);
  assert.equal(rules?.timer?.durationSeconds, 60);
  assert.equal(rules?.timer?.onExpire, "lose");
  assert.equal(rules?.winWhenObjectivesComplete, true);
  assert.equal(rules?.loseWhenVariableDepleted, "lives");
  // The normalizer must accept what the validator preserved (round-trips clean).
  assert.notEqual(normalizeGameRules(rules), null);
});

check("save validator rejects malformed gameRules", () => {
  const base = { schema: 1, name: "r", loadGroups: [], instances: [], characters: [] };
  assert.throws(() => validateLayout({ ...base, worldSettings: { gameRules: 5 } }));
  assert.throws(() =>
    validateLayout({ ...base, worldSettings: { gameRules: { variables: [{ initial: 1 }] } } }),
  );
  assert.throws(() =>
    validateLayout({ ...base, worldSettings: { gameRules: { objectives: [{ id: "x" }] } } }),
  );
  assert.throws(() =>
    validateLayout({
      ...base,
      worldSettings: { gameRules: { timer: { durationSeconds: 10, direction: "sideways" } } },
    }),
  );
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

check("runtime PlayerController owns possession and input policy", () => {
  const { context, inputModes, pointerLookModes, mouseCursorVisible } = makeGameModeContext({});
  const controller = new RuntimePlayerController(
    {
      id: "test.controller",
      inputActions: ["look-x", "look-y"],
      inputMode: "game",
      pointerLookMode: "pointer-lock",
      mouseCursor: "hide",
      possess: "first-input-move-character",
    },
    context,
  );

  controller.setPawn("actor:0");
  assert.deepEqual(controller.playerState, {
    pawnEntityId: "actor:0",
    possessed: false,
    pawnControlSuspended: false,
  });
  controller.possess();
  assert.deepEqual(controller.playerState, {
    pawnEntityId: "actor:0",
    possessed: true,
    pawnControlSuspended: false,
  });
  assert.deepEqual(inputModes, ["game"]);
  assert.deepEqual(mouseCursorVisible, [false]);
  assert.deepEqual(pointerLookModes, ["pointer-lock"]);

  controller.unpossess();
  assert.deepEqual(controller.playerState, {
    pawnEntityId: null,
    possessed: false,
    pawnControlSuspended: false,
  });
  assert.deepEqual(inputModes, ["game", "ui"]);
  assert.deepEqual(mouseCursorVisible, [false, true]);
  assert.deepEqual(pointerLookModes, ["pointer-lock", "right-drag"]);
});

check("runtime PlayerController updates control rotation from mapped look input only", () => {
  const actions = new ActionMap(
    {},
    {
      GamepadRightX: "look-x",
      GamepadRightY: "look-y",
      IgnoredX: "ignored-x",
    },
  );
  actions.handleAxis("GamepadRightX", 1);
  actions.handleAxis("GamepadRightY", -1);
  actions.handleAxis("IgnoredX", 1);
  actions.advance();
  const { context } = makeGameModeContext({
    actions,
    lookDeltas: [{ dx: 10, dy: 0 }, { dx: 100, dy: 0 }],
  });
  const controller = new RuntimePlayerController(
    {
      id: "test.look-controller",
      inputActions: ["look-x", "look-y"],
      inputMode: "game",
      lookSensitivity: 0.01,
      lookAxisRate: 10,
      possess: "camera-pawn",
    },
    context,
  );

  controller.possess(null);
  const rotation = controller.updateControlRotation(1);
  assert.equal(rotation.yaw, -0.2);
  assert.equal(rotation.pitch, 0.1);
  context.setInputMode("ui");
  assert.equal(controller.updateControlRotation(1), rotation);
});

check("PlayerCameraManager applies view targets and blends across camera sources", () => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  const manager = new PlayerCameraManager(camera);
  manager.setViewTarget({
    source: "follow config",
    pose: { position: [0, 1, 4], target: [0, 0, 0] },
    projection: { fov: 50, near: 0.1, far: 100 },
  });
  manager.update(0);
  assert.deepEqual(camera.position.toArray(), [0, 1, 4]);
  assert.equal(manager.cameraSource, "follow config");

  // Same source updates are normal per-frame tracking, not source transitions.
  manager.setViewTarget(
    {
      source: "follow config",
      pose: { position: [2, 1, 4], target: [2, 0, 0] },
      projection: { fov: 55, near: 0.2, far: 150 },
    },
    { blendTimeSeconds: 1 },
  );
  manager.update(0);
  assert.deepEqual(camera.position.toArray(), [2, 1, 4]);
  assert.equal(camera.fov, 55);
  assert.equal(camera.near, 0.2);
  assert.equal(camera.far, 150);

  manager.setViewTarget(
    {
      source: "spring arm component",
      pose: { position: [10, 3, 8], target: [10, 1, 0] },
      projection: { fov: 75, near: 0.3, far: 250 },
    },
    { blendTimeSeconds: 1 },
  );
  manager.update(0.5);
  assert.equal(manager.cameraSource, "spring arm component");
  assert.ok(Math.abs(camera.position.x - 6) < 1e-9);
  assert.ok(Math.abs(camera.position.y - 2) < 1e-9);
  assert.ok(Math.abs(camera.position.z - 6) < 1e-9);
  assert.ok(Math.abs(camera.fov - 65) < 1e-9);
  assert.ok(Math.abs(camera.near - 0.25) < 1e-9);
  assert.ok(Math.abs(camera.far - 200) < 1e-9);
  manager.update(0.5);
  assert.deepEqual(camera.position.toArray(), [10, 3, 8]);
  assert.equal(camera.fov, 75);
  assert.equal(camera.near, 0.3);
  assert.equal(camera.far, 250);
});

check("PlayerCameraManager blends sprint FOV and camera shake effects", () => {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  const manager = new PlayerCameraManager(camera);
  manager.setViewTarget({
    source: "spring arm component",
    pose: { position: [0, 1, 4], target: [0, 1, 0] },
    projection: { fov: 60, near: 0.1, far: 100 },
  });
  manager.setGameplayEffects({ fovOffset: 5, shakeAmplitude: 0.1, shakeFrequencyHz: 2 });
  manager.update(1);

  const position = camera.position.toArray();
  assert.ok(camera.fov > 64.9 && camera.fov < 65.01);
  assert.notDeepEqual(position, [0, 1, 4]);
  assert.ok(Math.hypot(position[0], position[1] - 1, position[2] - 4) <= 0.15);
  assert.ok(manager.gameplayEffects.shakeAmplitude > 0.09);

  manager.setGameplayEffects({});
  manager.update(1);
  assert.ok(camera.fov > 59.99 && camera.fov < 60.01);
  assert.ok(manager.gameplayEffects.shakeAmplitude < 0.001);
});

check("default camera mode never possesses an input-move character", () => {
  const camera = new PerspectiveCamera();
  const actions = new ActionMap(MOVE_BINDINGS);
  actions.handleDown("KeyW");
  actions.advance();
  const characters = [makeCharacterRef(0, { input: true })];
  const { context, cameraControlled, inputModes, pointerLookModes, mouseCursorVisible } = makeGameModeContext({
    camera,
    actions,
    characters,
  });
  const session = defaultCameraGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  assert.equal(session.playerState.pawnEntityId, null);
  assert.ok(session.playerState.possessed);
  assert.ok(cameraControlled());
  assert.deepEqual(inputModes, ["game"]);
  assert.deepEqual(mouseCursorVisible, [true]);
  assert.deepEqual(pointerLookModes, ["right-drag"]);
  const z0 = camera.position.z;
  session.update(0.5);
  assert.ok(camera.position.z < z0); // WASD moved the camera...
  assert.deepEqual(characters[0].object.position.toArray(), [0, 0, 0]); // ...not the character.
});

check("default camera mode ignores movement while input mode is UI", () => {
  const camera = new PerspectiveCamera();
  const actions = new ActionMap(MOVE_BINDINGS);
  actions.handleDown("KeyW");
  actions.advance();
  const { context } = makeGameModeContext({ camera, actions });
  const session = defaultCameraGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  context.setInputMode("ui");
  const z0 = camera.position.z;
  session.update(0.5);
  assert.equal(camera.position.z, z0);
});

check("tps mode possesses the input-move character and follows it", () => {
  const camera = new PerspectiveCamera();
  const characters = [makeCharacterRef(0, { input: true })];
  characters[0].object.position.set(2, 0, 3);
  const { context, mixers, inputModes, pointerLookModes, mouseCursorVisible } = makeGameModeContext({
    camera,
    characters,
  });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  assert.equal(session.playerState.pawnEntityId, characterEntityId(0));
  session.possess();
  assert.ok(session.playerState.possessed);
  assert.equal(mixers.length, 1);
  assert.deepEqual(inputModes, ["game"]);
  assert.deepEqual(mouseCursorVisible, [false]);
  assert.deepEqual(pointerLookModes, ["pointer-lock"]);
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

check("tps mode can possess an Actor Script character with CharacterMovement", () => {
  const characters = [makeCharacterRef(0, { actorMovement: true })];
  const { context } = makeGameModeContext({ characters });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  assert.equal(session.playerState.pawnEntityId, actorInstanceEntityId(0));
});

check("tps mode animates + follows a possessed Actor Script character", () => {
  const camera = new PerspectiveCamera();
  const animations = [
    new AnimationClip("idle", 1, []),
    new AnimationClip("walk", 1, []),
    new AnimationClip("sprint", 1, []),
  ];
  const characters = [makeCharacterRef(0, { actorMovement: true, animations })];
  characters[0].object.position.set(1, 0, -4);
  // The CharacterMovement subsystem reports the possessed actor's locomotion under
  // its actor entity id; a running report should crossfade toward the sprint clip.
  const locomotion = new Map<string, LocomotionInput>([
    [actorInstanceEntityId(0), { planarSpeed: 5, grounded: true, velocityY: 0 }],
  ]);
  const { context, mixers } = makeGameModeContext({ camera, characters, locomotion });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  // possess() builds a CrossfadeAnimator from the actor's own gltf clips (the
  // locomotion animation bridge now spans Actor Script characters).
  assert.equal(mixers.length, 1);
  session.update(0.1);
  // The follow camera tracks behind+above the actor; the running locomotion report
  // now adds a small gameplay shake and sprint FOV on top of that base pose.
  assert.ok(Math.abs(camera.position.x - 1) < 0.03);
  assert.ok(Math.abs(camera.position.y - 1.2) < 0.03);
  assert.ok(Math.abs(camera.position.z - (-4 + 2.6)) < 0.03);
  assert.ok(camera.fov > 44);
});

check("tps mode maps authored SpringArm and Camera components to runtime camera", () => {
  const camera = new PerspectiveCamera();
  const entity: Entity = {
    id: actorInstanceEntityId(0),
    components: {
      SpringArm: {
        targetArmLength: 4,
        targetOffset: [0, 1, 0],
        socketOffset: [0, 0, 0],
        enableCameraLag: false,
        cameraLagSpeed: 10,
        doCollisionTest: false,
      },
      Camera: {
        fieldOfView: 70,
        nearClip: 0.2,
        farClip: 250,
        isOrthographic: false,
        orthoWidth: 10,
        enableSprintCameraShake: true,
      },
    },
  };
  const characters = [makeCharacterRef(0, { actorMovement: true, entity })];
  characters[0].object.position.set(2, 0, -1);
  const { context } = makeGameModeContext({
    camera,
    characters,
    lookDeltas: [{ dx: 100, dy: 0 }],
  });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  session.beforeEngineUpdate?.(0.016);
  session.update(0.1);

  const pivot = [2, 1, -1] as const;
  const distance = Math.hypot(
    camera.position.x - pivot[0],
    camera.position.y - pivot[1],
    camera.position.z - pivot[2],
  );
  assert.ok(Math.abs(distance - 4) < 1e-6);
  assert.equal(camera.fov, 70);
  assert.equal(camera.near, 0.2);
  assert.equal(camera.far, 250);

  const debug = session.getCameraDebug?.();
  assert.equal(debug?.cameraSource, "spring arm component");
  assert.ok(Math.abs((debug?.controlYawDeg ?? 0) - (-0.3 * 180 / Math.PI)) < 1e-6);
});

check("tps mode can disable sprint camera shake from the authored Camera component", () => {
  const camera = new PerspectiveCamera();
  const entity: Entity = {
    id: actorInstanceEntityId(0),
    components: {
      Camera: {
        fieldOfView: 44,
        nearClip: 0.1,
        farClip: 100,
        enableSprintCameraShake: false,
      },
    },
  };
  const characters = [makeCharacterRef(0, { actorMovement: true, entity })];
  characters[0].object.position.set(1, 0, -4);
  const locomotion = new Map<string, LocomotionInput>([
    [actorInstanceEntityId(0), { planarSpeed: 5, grounded: true, velocityY: 0 }],
  ]);
  const { context } = makeGameModeContext({ camera, characters, locomotion });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  session.update(0.1);

  assert.deepEqual(camera.position.toArray(), [1, 1.2, -1.4]);
  assert.ok(camera.fov > 44);
});

check("tps mode applies analog look axes to control rotation", () => {
  const actions = new ActionMap({}, { GamepadRightX: "look-x", GamepadRightY: "look-y" });
  actions.handleAxis("GamepadRightX", 1);
  actions.handleAxis("GamepadRightY", -1);
  actions.advance();
  const characters = [makeCharacterRef(0, { actorMovement: true })];
  const { context } = makeGameModeContext({ actions, characters });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  session.beforeEngineUpdate?.(1);

  const debug = session.getCameraDebug?.();
  assert.ok(Math.abs((debug?.controlYawDeg ?? 0) - (-0.72 * 180 / Math.PI)) < 1e-6);
  assert.ok((debug?.controlPitchDeg ?? 0) > 0);
});

check("tps mode uses SpringArm doCollisionTest against runtime blockers", () => {
  const camera = new PerspectiveCamera();
  const entity: Entity = {
    id: actorInstanceEntityId(0),
    components: {
      SpringArm: {
        targetArmLength: 4,
        targetOffset: [0, 0, 0],
        socketOffset: [0, 0, 0],
        enableCameraLag: false,
        cameraLagSpeed: 10,
        doCollisionTest: true,
      },
    },
  };
  const characters = [makeCharacterRef(0, { actorMovement: true, entity })];
  const { context } = makeGameModeContext({
    camera,
    characters,
    blockers: [{ min: [-1, 0, 1], max: [1, 2, 2] }],
  });
  const session = tpsCharacterGameMode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  session.update(0.1);

  assert.ok(camera.position.z < 1);
  assert.ok(Math.hypot(camera.position.x, camera.position.y, camera.position.z) < 4);
});

check("locomotion bridge selects an Actor Script character's run clip from its movement state", () => {
  // The exact composition TpsCharacterSession.updateAnimation runs, exercised over
  // an Actor Script character's clip vocabulary via the public CrossfadeAnimator API.
  const clips = [
    new AnimationClip("idle", 1, []),
    new AnimationClip("walk", 1, []),
    new AnimationClip("sprint", 1, []),
  ];
  const animator = new CrossfadeAnimator(new Object3D(), clips);
  animator.play("idle", 0);
  assert.equal(animator.currentClip, "idle");
  const running: LocomotionInput = { planarSpeed: 5, grounded: true, velocityY: 0 };
  const clip = selectLocomotionClip(running, animator.clips);
  assert.equal(clip, "sprint"); // run state -> sprint clip via the fallback chain
  if (clip) animator.play(clip, 0.18);
  assert.equal(animator.currentClip, "sprint");
});

check("project game mode carries its pawn class ref and possesses an actor character", () => {
  const mode = createProjectGameMode({
    classRef: "assets/Script/MyGameMode.actor.json",
    displayName: "MyGameMode",
    defaultPawnClassRef: "assets/Script/Player.actor.json",
  });
  assert.equal(mode.id, "assets/Script/MyGameMode.actor.json");
  assert.equal(mode.displayName, "MyGameMode");
  assert.equal(mode.defaultPawn.kind, "character");
  assert.equal(mode.defaultPawn.pawnClassRef, "assets/Script/Player.actor.json");

  const characters = [makeCharacterRef(0, { actorMovement: true })];
  const { context } = makeGameModeContext({ characters });
  const session = mode.createSession(context);
  session.spawnDefaultPawn();
  session.possess();
  assert.equal(session.playerState.pawnEntityId, actorInstanceEntityId(0));
  assert.ok(session.playerState.possessed);
});

check("createProjectGameMode without a default pawn omits pawnClassRef", () => {
  const mode = createProjectGameMode({ classRef: "a.actor.json", displayName: "A" });
  assert.equal(mode.defaultPawn.pawnClassRef, undefined);
});

check("formatGameModeDebug renders a possessed pawn's mode + movement state", () => {
  const lines = formatGameModeDebug({
    gameMode: "TPS Character",
    possessed: "actor:0",
    movementMode: "walking",
    grounded: false,
    velocityY: 3.5,
    planarSpeed: 2,
    controlYawDeg: -17.2,
    controlPitchDeg: -15,
    cameraSource: "spring arm component",
    inputMode: "game",
  });
  assert.deepEqual(lines, [
    "game mode",
    "mode: TPS Character",
    "possessed: actor:0",
    "movement: walking (airborne)",
    "vel y:3.50 planar:2.00",
    "control yaw:-17.20 pitch:-15.00",
    "camera: spring arm component",
    "input: game",
  ]);
});

check("formatGameModeDebug shows placeholders when nothing is possessed", () => {
  const lines = formatGameModeDebug({
    gameMode: "Default Camera",
    possessed: null,
    movementMode: null,
    grounded: null,
    velocityY: null,
    planarSpeed: null,
    controlYawDeg: null,
    controlPitchDeg: null,
    cameraSource: null,
    inputMode: "ui",
  });
  assert.deepEqual(lines, [
    "game mode",
    "mode: Default Camera",
    "possessed: none",
    "movement: —",
    "vel y:— planar:—",
    "control yaw:— pitch:—",
    "camera: â€”",
    "input: ui",
  ]);
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

check("CharacterMovement subsystem only moves the possessed character", () => {
  const actions = new ActionMap({ KeyW: "move-forward" });
  actions.handleDown("KeyW");
  actions.advance();
  const entity: Entity = {
    id: "actor:0",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      CharacterMovement: {
        maxWalkSpeed: 4,
        sprintMultiplier: 2,
        jumpSpeed: 5,
        gravityScale: 1,
        orientRotationToMovement: true,
      },
    },
  };

  let unpossessed: TransformComponent | null = null;
  const idle = new CharacterMovementSubsystem(
    actions,
    (_id, transform) => {
      unpossessed = transform;
    },
    undefined,
    { isPlayerControlled: () => false },
  );
  idle.setEntities([entity]);
  idle.update({ deltaSeconds: 0.5, elapsedSeconds: 0.5, frame: 1 });
  assert.equal(unpossessed, null);

  let possessed: TransformComponent | null = null;
  const reports = new Map<string, LocomotionInput>();
  const driven = new CharacterMovementSubsystem(
    actions,
    (_id, transform) => {
      possessed = transform;
    },
    undefined,
    {
      isPlayerControlled: () => true,
      reportLocomotion: (entityId, report) => reports.set(entityId, report),
    },
  );
  driven.setEntities([entity]);
  driven.update({ deltaSeconds: 0.5, elapsedSeconds: 0.5, frame: 1 });
  assert.ok(possessed);
  assert.ok(possessed.position[2] < 0);
  yawApproxEqual(possessed.rotation[1], 180);
  assert.equal(reports.get("actor:0")?.grounded, true);
});

check("CharacterMovement subsystem can orient a character to controller yaw", () => {
  const actions = new ActionMap({});
  actions.advance();
  const entity: Entity = {
    id: "actor:aim",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 15, 0], scale: [1, 1, 1] },
      CharacterMovement: {
        maxWalkSpeed: 4,
        sprintMultiplier: 2,
        jumpSpeed: 5,
        gravityScale: 1,
        orientRotationToMovement: true,
        orientRotationToControl: true,
      },
    },
  };

  let transform: TransformComponent | null = null;
  const movement = new CharacterMovementSubsystem(
    actions,
    (_id, next) => {
      transform = next;
    },
    undefined,
    {
      getControlYaw: () => Math.PI / 2,
      isPlayerControlled: () => true,
    },
  );
  movement.setEntities([entity]);
  movement.update({ deltaSeconds: 0.5, elapsedSeconds: 0.5, frame: 1 });
  assert.ok(transform);
  yawApproxEqual(transform.rotation[1], -90);
});

check("CharacterMovement subsystem applies Rotation Rate Z to smooth yaw turns", () => {
  const actions = new ActionMap({ KeyS: "move-back" });
  actions.handleDown("KeyS");
  actions.advance();
  const entity: Entity = {
    id: "actor:turn",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 180, 0], scale: [1, 1, 1] },
      CharacterMovement: {
        maxWalkSpeed: 4,
        sprintMultiplier: 2,
        jumpSpeed: 5,
        gravityScale: 1,
        rotationRate: [0, 0, 90],
        orientRotationToMovement: true,
      },
    },
  };

  let transform: TransformComponent | null = null;
  const movement = new CharacterMovementSubsystem(
    actions,
    (_id, next) => {
      transform = next;
    },
    undefined,
    { isPlayerControlled: () => true },
  );
  movement.setEntities([entity]);
  movement.update({ deltaSeconds: 0.1, elapsedSeconds: 0.1, frame: 1 });
  assert.ok(transform);
  yawApproxEqual(transform.rotation[1], -171);
});

check("CharacterMovement subsystem applies jump and gravity from component props", () => {
  const actions = new ActionMap({ Space: "jump" });
  actions.handleDown("Space");
  actions.advance();
  const entity: Entity = {
    id: "actor:jump",
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      CharacterMovement: {
        maxWalkSpeed: 3,
        sprintMultiplier: 2,
        jumpSpeed: 5,
        gravityScale: 1,
      },
    },
  };
  let transform: TransformComponent | null = null;
  const movement = new CharacterMovementSubsystem(
    actions,
    (_id, next) => {
      transform = next;
    },
    undefined,
    { getGravityY: () => -10, isPlayerControlled: () => true },
  );
  movement.setEntities([entity]);
  movement.update({ deltaSeconds: 0.1, elapsedSeconds: 0.1, frame: 1 });
  assert.ok(transform);
  assert.ok(transform.position[1] > 0);

  actions.handleUp("Space");
  actions.advance();
  let landed = false;
  for (let frame = 2; frame < 100 && !landed; frame += 1) {
    movement.update({ deltaSeconds: 0.1, elapsedSeconds: frame / 10, frame });
    landed = transform?.position[1] === 0;
  }
  assert.equal(landed, true);
});

check("applyMouseLook turns with the pointer delta and clamps pitch", () => {
  const turned = applyMouseLook({ yaw: 0, pitch: 0 }, 100, 0, 0.01, 1);
  assert.ok(Math.abs(turned.yaw - -1) < 1e-9);
  assert.equal(applyMouseLook({ yaw: 0, pitch: 0 }, 0, -1000, 0.01, 1).pitch, 1);
  assert.equal(applyMouseLook({ yaw: 0, pitch: 0 }, 0, 1000, 0.01, 1).pitch, -1);
});

check("applyConfiguredMouseLook honors sensitivity and invert Y", () => {
  const normal = applyConfiguredMouseLook({ yaw: 0, pitch: 0 }, 10, 10, {
    sensitivity: 0.01,
  });
  assert.ok(Math.abs(normal.yaw - -0.1) < 1e-9);
  assert.ok(Math.abs(normal.pitch - -0.1) < 1e-9);
  const inverted = applyConfiguredMouseLook({ yaw: 0, pitch: 0 }, 10, 10, {
    sensitivity: 0.01,
    invertY: true,
  });
  assert.ok(Math.abs(inverted.yaw - -0.1) < 1e-9);
  assert.ok(Math.abs(inverted.pitch - 0.1) < 1e-9);
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
  // The custom object filters out the pawn channel, so it skips a pawn objectâ€¦
  assert.equal(interactionGroupsInteract(ignoresPawn, pawn), false);
  // â€¦but still interacts with a world-static block-all object, and an unset
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
    collisionEnabled: "query",
    objectType: "trigger",
    responses: { pawn: "overlap", visibility: "ignore" },
    physicalMaterialId: "rubber",
    generateOverlapEvents: false,
    simulationGeneratesHitEvents: true,
  });
  assert.equal(placement.collisionPreset, "trigger");
  assert.equal(placement.collisionEnabled, "query");
  assert.equal(placement.objectType, "trigger");
  assert.deepEqual(placement.responses, { pawn: "overlap", visibility: "ignore" });
  assert.equal(placement.physicalMaterialId, "rubber");
  assert.equal(placement.generateOverlapEvents, false);
  assert.equal(placement.simulationGeneratesHitEvents, true);
  assert.throws(() => validatePlacement({ position: [0, 0, 0], collisionPreset: "nope" }));
  assert.throws(() => validatePlacement({ position: [0, 0, 0], collisionEnabled: "maybe" }));
  assert.throws(() => validatePlacement({ position: [0, 0, 0], objectType: "camera" }));
  assert.throws(() => validatePlacement({ position: [0, 0, 0], physicalMaterialId: "ice" }));
  assert.throws(() => validatePlacement({ position: [0, 0, 0], responses: { pawn: "bounce" } }));
  // Absent override stays absent (inherits asset default).
  assert.equal(validatePlacement({ position: [0, 0, 0] }).collisionPreset, undefined);
  assert.equal(validatePlacement({ position: [0, 0, 0] }).collisionEnabled, undefined);
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
  // Wrong schema or empty effectId â†’ null.
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

check("skeleton save payload requires a .skeleton.json path and canonical metadata", () => {
  const payload = validateSaveSkeletonPayload({
    path: "assets/characters/Hero.skeleton.json",
    skeleton: {
      schema: 1,
      sockets: [
        {
          name: "weapon_r",
          bone: "hand_r",
          position: [0, 0, 0],
          rotation: [0, 90.12345, 0],
          scale: [1, 1, 1],
          previewAssetId: "starter-sword",
        },
      ],
      animationSet: { idle: "Idle", walk: "Walk", run: "Run", unknown: "Ignored" },
      blendSpaces: [
        {
          name: "Locomotion",
          type: "1d",
          axisX: { name: "Speed", min: 0, max: 4.123456 },
          samples: [
            { clip: "Idle", x: 0 },
            { clip: "Run", x: 4.987654 },
          ],
        },
      ],
      notifies: [],
      montages: [
        { name: "fire", clip: "holding-both-shoot", slot: "upperBody", loop: false, blendInSeconds: 0.08 },
        { name: "aim", clip: "holding-both", slot: "upperBody", loop: true },
      ],
      rootMotion: [
        { clip: "Run", mode: "lockXZ", rootNode: "Hips" },
        { clip: "Jump", mode: "lockXYZ" },
      ],
      upperBodyBone: "torso",
      preview: { selectedClip: "Idle" },
    },
  });
  assert.equal(payload.path, "assets/characters/Hero.skeleton.json");
  assert.deepEqual(payload.skeleton.animationSet, {
    idle: "Idle",
    walk: "Walk",
    run: "Run",
  });
  assert.equal(payload.skeleton.upperBodyBone, "torso");
  assert.deepEqual(payload.skeleton.montages, [
    { name: "fire", clip: "holding-both-shoot", slot: "upperBody", loop: false, blendInSeconds: 0.08, blendOutSeconds: 0.2 },
    { name: "aim", clip: "holding-both", slot: "upperBody", loop: true, blendInSeconds: 0.12, blendOutSeconds: 0.2 },
  ]);
  assert.deepEqual(payload.skeleton.rootMotion, [
    { clip: "Run", mode: "lockXZ", rootNode: "Hips" },
    { clip: "Jump", mode: "lockXYZ" },
  ]);
  assert.equal(payload.skeleton.sockets[0]?.previewAssetId, "starter-sword");
  assert.deepEqual(payload.skeleton.preview, { selectedClip: "Idle" });
  const savedBlend = payload.skeleton.blendSpaces[0]!;
  assert.equal(savedBlend.name, "Locomotion");
  assert.equal(savedBlend.type, "1d");
  assert.equal(savedBlend.axisY, undefined);
  assert.deepEqual(savedBlend.axisX, { name: "Speed", min: 0, max: 4.1235 });
  assert.deepEqual(savedBlend.samples, [
    { clip: "Idle", x: 0 },
    { clip: "Run", x: 4.9877 },
  ]);
  assert.throws(() =>
    validateSaveSkeletonPayload({ path: "assets/characters/Hero.json", skeleton: {} }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({ path: "../secret.skeleton.json", skeleton: {} }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { sockets: [{ name: "bad", bone: "", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] },
    }),
  );
  // A 2d blend space sample without a Y coordinate is rejected.
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: {
        blendSpaces: [
          {
            name: "Aim",
            type: "2d",
            axisX: { name: "Yaw", min: -1, max: 1 },
            axisY: { name: "Pitch", min: -1, max: 1 },
            samples: [{ clip: "Center", x: 0 }],
          },
        ],
      },
    }),
  );
  // Duplicate blend-space names are rejected.
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: {
        blendSpaces: [
          { name: "Dup", type: "1d", axisX: { name: "Speed", min: 0, max: 4 }, samples: [] },
          { name: "Dup", type: "1d", axisX: { name: "Speed", min: 0, max: 4 }, samples: [] },
        ],
      },
    }),
  );
  // A montage with no clip, an unknown slot, or a duplicate name is rejected.
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { montages: [{ name: "fire", clip: "" }] },
    }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { montages: [{ name: "fire", clip: "Shoot", slot: "legs" }] },
    }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: {
        montages: [
          { name: "fire", clip: "A" },
          { name: "fire", clip: "B" },
        ],
      },
    }),
  );
  // Montages round-trip; defaults fill, explicit fields preserved. Input binding
  // is code-owned (montageInputBindings.ts), so the sidecar carries no trigger:
  // a legacy `trigger` field is dropped rather than persisted.
  const validated = validateSaveSkeletonPayload({
    path: "assets/characters/Hero.skeleton.json",
    skeleton: {
      montages: [
        { name: "emote1", clip: "wave", slot: "upperBody", trigger: { action: "emote", mode: "press" } },
        { name: "block", clip: "guard", slot: "upperBody", loop: true, blendInSeconds: 0.3 },
      ],
    },
  });
  assert.deepEqual(validated.skeleton.montages, [
    { name: "emote1", clip: "wave", slot: "upperBody", loop: false, blendInSeconds: 0.12, blendOutSeconds: 0.2 },
    { name: "block", clip: "guard", slot: "upperBody", loop: true, blendInSeconds: 0.3, blendOutSeconds: 0.2 },
  ]);
});

check("asset skeleton montages normalize and ignore legacy trigger fields", () => {
  const skeleton = normalizeAssetSkeleton({
    schema: 1,
    montages: [
      { name: "emote1", clip: "wave", slot: "upperBody", trigger: { action: "emote", mode: "press" } },
      { name: "guard", clip: "block", slot: "fullBody", loop: true, blendInSeconds: 0.3 },
      { name: "", clip: "c", slot: "upperBody" },
      { name: "emote1", clip: "dup", slot: "upperBody" },
    ],
  });
  // Empty name and duplicate name drop; the legacy trigger field is stripped.
  assert.deepEqual(skeleton.montages, [
    { name: "emote1", clip: "wave", slot: "upperBody", loop: false, blendInSeconds: 0.12, blendOutSeconds: 0.2 },
    { name: "guard", clip: "block", slot: "fullBody", loop: true, blendInSeconds: 0.3, blendOutSeconds: 0.2 },
  ]);
});

check("resolveMontageBindings applies the aim/fire convention and the code-owned map", () => {
  const montages = [
    { name: "emote1", clip: "wave", slot: "upperBody", loop: false, blendInSeconds: 0.1, blendOutSeconds: 0.2 },
    { name: "aim", clip: "hold", slot: "upperBody", loop: true, blendInSeconds: 0.18, blendOutSeconds: 0.22 },
    { name: "fire", clip: "shoot", slot: "upperBody", loop: false, blendInSeconds: 0.06, blendOutSeconds: 0.18 },
    // Non-convention name with no code-map entry: skipped (game code triggers it).
    { name: "stagger", clip: "hit", slot: "upperBody", loop: false, blendInSeconds: 0.1, blendOutSeconds: 0.1 },
    // fullBody montages are not input-bound: skipped even via the code map.
    { name: "dance", clip: "spin", slot: "fullBody", loop: false, blendInSeconds: 0.1, blendOutSeconds: 0.2 },
  ] as const;
  // No code map: only the aim/fire name convention binds (backward compatible).
  assert.deepEqual(
    resolveMontageBindings(montages).map((b) => ({ clip: b.clip, action: b.action, mode: b.mode })),
    [
      { clip: "hold", action: "aim", mode: "hold" },
      { clip: "shoot", action: "fire", mode: "press" },
    ],
  );
  // A code-owned binding adds a montage and overrides the convention by name.
  const bindings = resolveMontageBindings(montages, [
    { action: "emote", montage: "emote1", mode: "press" },
    { action: "block", montage: "aim", mode: "press" },
    { action: "dance", montage: "dance", mode: "press" },
  ]);
  assert.deepEqual(
    bindings.map((b) => ({ clip: b.clip, action: b.action, mode: b.mode })),
    [
      { clip: "wave", action: "emote", mode: "press" },
      // "aim" convention (hold) overridden by the code map (block/press).
      { clip: "hold", action: "block", mode: "press" },
      { clip: "shoot", action: "fire", mode: "press" },
    ],
  );
  assert.equal(resolveMontageBindings(undefined).length, 0);
});

check("asset skeleton notifies normalize: drop invalid, clamp negative time, default missing", () => {
  const skeleton = normalizeAssetSkeleton({
    schema: 1,
    notifies: [
      { name: "footL", clip: "walk", time: 0.25 },
      { name: "footR", clip: "walk", time: -1 },
      { name: "", clip: "walk", time: 0.1 },
      { name: "x", clip: "", time: 0.1 },
      { name: "y", clip: "walk" },
      "nope",
    ],
  });
  assert.deepEqual(skeleton.notifies, [
    { name: "footL", clip: "walk", time: 0.25 },
    { name: "footR", clip: "walk", time: 0 },
    { name: "y", clip: "walk", time: 0 },
  ]);
});

check("asset skeleton notifies round-trip through the save validator; bad fields rejected", () => {
  const validated = validateSaveSkeletonPayload({
    path: "assets/characters/Hero.skeleton.json",
    skeleton: {
      notifies: [
        { name: "hit", clip: "attack", time: 0.5 },
        { name: "z", clip: "attack" },
      ],
    },
  });
  assert.deepEqual(validated.skeleton.notifies, [
    { name: "hit", clip: "attack", time: 0.5 },
    { name: "z", clip: "attack", time: 0 },
  ]);
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { notifies: [{ name: "n", clip: "c", time: -1 }] },
    }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { notifies: [{ name: "", clip: "c", time: 0 }] },
    }),
  );
});

check("collectFiredNotifies fires markers crossed forward and across a loop wrap", () => {
  const markers = [
    { name: "a", time: 0.1 },
    { name: "b", time: 0.5 },
    { name: "c", time: 0.9 },
  ];
  const dur = 1;
  // Forward, no wrap: (0.05, 0.6] → a, b.
  assert.deepEqual(
    collectFiredNotifies(markers, { prevTime: 0.05, currTime: 0.6, duration: dur, looped: true }).map((m) => m.name),
    ["a", "b"],
  );
  // Exactly on the marker time fires once (half-open at currTime).
  assert.deepEqual(
    collectFiredNotifies(markers, { prevTime: 0.4, currTime: 0.5, duration: dur, looped: true }).map((m) => m.name),
    ["b"],
  );
  // No movement → nothing fires.
  assert.equal(
    collectFiredNotifies(markers, { prevTime: 0.5, currTime: 0.5, duration: dur, looped: true }).length,
    0,
  );
  // Loop wrap 0.95 → 0.15: tail (0.95,1] has none, head [0,0.15] → a.
  assert.deepEqual(
    collectFiredNotifies(markers, { prevTime: 0.95, currTime: 0.15, duration: dur, looped: true }).map((m) => m.name),
    ["a"],
  );
  // Same backward jump but not looped → no forward progress, nothing fires.
  assert.equal(
    collectFiredNotifies(markers, { prevTime: 0.95, currTime: 0.15, duration: dur, looped: false }).length,
    0,
  );
  assert.equal(collectFiredNotifies([], { prevTime: 0, currTime: 1, duration: dur, looped: true }).length, 0);
});

check("groupNotifiesByClip groups markers by clip in order", () => {
  const byClip = groupNotifiesByClip([
    { name: "footL", clip: "walk", time: 0.2 },
    { name: "footR", clip: "walk", time: 0.7 },
    { name: "hit", clip: "attack", time: 0.4 },
  ]);
  assert.deepEqual(byClip.get("walk"), [
    { name: "footL", time: 0.2 },
    { name: "footR", time: 0.7 },
  ]);
  assert.deepEqual(byClip.get("attack"), [{ name: "hit", time: 0.4 }]);
  assert.equal(groupNotifiesByClip(undefined).size, 0);
});

check("AnimationNotifyTracker fires across ticks, re-arms on clip switch and stop", () => {
  const byClip = groupNotifiesByClip([
    { name: "footL", clip: "walk", time: 0.2 },
    { name: "footR", clip: "walk", time: 0.7 },
    { name: "hit", clip: "attack", time: 0.3 },
  ]);
  const tracker = new AnimationNotifyTracker();
  // First sample of a clip arms without firing past markers.
  assert.deepEqual(tracker.sample({ clip: "walk", time: 0.1, duration: 1 }, byClip), []);
  assert.deepEqual(
    tracker.sample({ clip: "walk", time: 0.3, duration: 1 }, byClip).map((m) => m.name),
    ["footL"],
  );
  assert.deepEqual(
    tracker.sample({ clip: "walk", time: 0.8, duration: 1 }, byClip).map((m) => m.name),
    ["footR"],
  );
  // Loop wrap 0.8 → 0.25 fires footL again (head of the loop).
  assert.deepEqual(
    tracker.sample({ clip: "walk", time: 0.25, duration: 1 }, byClip).map((m) => m.name),
    ["footL"],
  );
  // Switching clips re-arms from the new playhead (no spurious fire).
  assert.deepEqual(tracker.sample({ clip: "attack", time: 0.5, duration: 1 }, byClip), []);
  assert.deepEqual(tracker.sample({ clip: "attack", time: 0.9, duration: 1 }, byClip), []);
  // Stopping (null) resets; re-entering and crossing 0.3 fires hit.
  assert.deepEqual(tracker.sample(null, byClip), []);
  assert.deepEqual(tracker.sample({ clip: "attack", time: 0.1, duration: 1 }, byClip), []);
  assert.deepEqual(
    tracker.sample({ clip: "attack", time: 0.4, duration: 1 }, byClip).map((m) => m.name),
    ["hit"],
  );
  // A clip with no authored notifies fires nothing.
  assert.deepEqual(tracker.sample({ clip: "idle", time: 0.5, duration: 1 }, byClip), []);
});

check("asset skeleton physics bodies normalize: drop invalid, default shape, clamp size", () => {
  const skeleton = normalizeAssetSkeleton({
    schema: 1,
    physicsBodies: [
      { name: "pelvis", bone: "hips", shape: "box", position: [0, 0.1, 0], rotation: [0, 0, 0], size: [0.3, 0.2, 0.25] },
      { name: "head", bone: "neck", shape: "weird", size: [0.15, 0.15, 0.15] },
      { name: "", bone: "hips", size: [1, 1, 1] },
      { name: "noBone", bone: "", size: [1, 1, 1] },
      { name: "pelvis", bone: "dup", size: [1, 1, 1] },
      { name: "badSize", bone: "x", size: [0, -1, 2] },
    ],
  });
  assert.deepEqual(skeleton.physicsBodies, [
    { name: "pelvis", bone: "hips", shape: "box", position: [0, 0.1, 0], rotation: [0, 0, 0], size: [0.3, 0.2, 0.25] },
    // Unknown shape falls back to capsule; missing position/rotation default.
    { name: "head", bone: "neck", shape: "capsule", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.15, 0.15, 0.15] },
    // Non-positive size axes clamp to a small positive minimum.
    { name: "badSize", bone: "x", shape: "capsule", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.01, 0.01, 2] },
  ]);
});

check("asset skeleton physics bodies round-trip through the save validator; bad fields rejected", () => {
  const validated = validateSaveSkeletonPayload({
    path: "assets/characters/Hero.skeleton.json",
    skeleton: {
      physicsBodies: [
        { name: "pelvis", bone: "hips", shape: "capsule", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.2, 0.5, 0.2] },
      ],
    },
  });
  assert.deepEqual(validated.skeleton.physicsBodies, [
    { name: "pelvis", bone: "hips", shape: "capsule", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.2, 0.5, 0.2] },
  ]);
  // Empty name, non-positive size, and duplicate name are rejected.
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { physicsBodies: [{ name: "", bone: "hips", size: [1, 1, 1] }] },
    }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { physicsBodies: [{ name: "b", bone: "hips", size: [1, 0, 1] }] },
    }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: {
        physicsBodies: [
          { name: "b", bone: "hips", size: [1, 1, 1] },
          { name: "b", bone: "spine", size: [1, 1, 1] },
        ],
      },
    }),
  );
  // Root-motion entries require a valid mode and one row per clip.
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { rootMotion: [{ clip: "Run", mode: "bake" }] },
    }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: {
        rootMotion: [
          { clip: "Run", mode: "lockXZ" },
          { clip: "Run", mode: "lockXYZ" },
        ],
      },
    }),
  );
});

check("asset skeleton physics constraints normalize: drop invalid/self/dupes, clamp angles", () => {
  const skeleton = normalizeAssetSkeleton({
    schema: 1,
    physicsConstraints: [
      { name: "hip_l", bodyA: "pelvis", bodyB: "thigh_l", swingDeg: 60, twistDeg: 20 },
      { name: "overswing", bodyA: "pelvis", bodyB: "thigh_r", swingDeg: 999, twistDeg: -5 },
      { name: "self", bodyA: "pelvis", bodyB: "pelvis", swingDeg: 30, twistDeg: 30 },
      { name: "", bodyA: "a", bodyB: "b" },
      { name: "noB", bodyA: "a", bodyB: "" },
      { name: "hip_l", bodyA: "x", bodyB: "y" },
    ],
  });
  assert.deepEqual(skeleton.physicsConstraints, [
    { name: "hip_l", bodyA: "pelvis", bodyB: "thigh_l", swingDeg: 60, twistDeg: 20 },
    // Out-of-range angles clamp to [0,180]; missing twist would default.
    { name: "overswing", bodyA: "pelvis", bodyB: "thigh_r", swingDeg: 180, twistDeg: 0 },
  ]);
});

check("asset skeleton physics constraints round-trip through the save validator; bad fields rejected", () => {
  const validated = validateSaveSkeletonPayload({
    path: "assets/characters/Hero.skeleton.json",
    skeleton: {
      physicsConstraints: [
        { name: "hip_l", bodyA: "pelvis", bodyB: "thigh_l", swingDeg: 60, twistDeg: 20 },
        { name: "spine", bodyA: "pelvis", bodyB: "chest" },
      ],
    },
  });
  assert.deepEqual(validated.skeleton.physicsConstraints, [
    { name: "hip_l", bodyA: "pelvis", bodyB: "thigh_l", swingDeg: 60, twistDeg: 20 },
    // Missing angles default (swing 45 / twist 30).
    { name: "spine", bodyA: "pelvis", bodyB: "chest", swingDeg: 45, twistDeg: 30 },
  ]);
  // Self-link, out-of-range angle, and duplicate name are rejected.
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { physicsConstraints: [{ name: "c", bodyA: "a", bodyB: "a" }] },
    }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: { physicsConstraints: [{ name: "c", bodyA: "a", bodyB: "b", swingDeg: 200 }] },
    }),
  );
  assert.throws(() =>
    validateSaveSkeletonPayload({
      path: "assets/characters/Hero.skeleton.json",
      skeleton: {
        physicsConstraints: [
          { name: "c", bodyA: "a", bodyB: "b" },
          { name: "c", bodyA: "a", bodyB: "d" },
        ],
      },
    }),
  );
});

const boneResolver =
  (map: Record<string, BoneWorldTransform>) =>
  (bone: string): BoneWorldTransform | null =>
    map[bone] ?? null;

const approxVec = (actual: readonly number[], expected: readonly number[], eps = 1e-5): void => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(Math.abs(actual[i]! - expected[i]!) < eps, `axis ${i}: ${actual[i]} !~= ${expected[i]}`);
  }
};

check("ragdoll spec: identity bone places body at its local offset; box mass = volume × density", () => {
  const resolve = boneResolver({ hips: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } });
  const spec = buildRagdollSpec(
    [{ name: "pelvis", bone: "hips", shape: "box", position: [1, 2, 3], rotation: [0, 0, 0], size: [2, 2, 2] }],
    [],
    resolve,
  );
  assert.equal(spec.bodies.length, 1);
  const body = spec.bodies[0]!;
  approxVec(body.position, [1, 2, 3]);
  approxVec(body.quaternion, [0, 0, 0, 1]);
  // 2×2×2 box → 8 m³ × 1000 kg/m³.
  assert.equal(body.mass, 8 * RAGDOLL_DENSITY);
});

check("ragdoll spec: bone rotation composes into world position; body rotation into world orientation", () => {
  // Bone rotated +90° about Y, sitting at x=5.
  const yawY = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number];
  const resolve = boneResolver({
    spine: { position: [5, 0, 0], quaternion: yawY },
    root: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
  });
  const spec = buildRagdollSpec(
    [
      // Local +X offset, rotated by the bone's +90°Y → swings to -Z, plus bone origin.
      { name: "armB", bone: "spine", shape: "box", position: [1, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] },
      // Identity bone, body's own +90°Y rotation surfaces as the world orientation.
      { name: "armA", bone: "root", shape: "box", position: [0, 0, 0], rotation: [0, 90, 0], size: [1, 1, 1] },
    ],
    [],
    resolve,
  );
  approxVec(spec.bodies[0]!.position, [5, 0, -1]);
  approxVec(spec.bodies[0]!.quaternion, yawY);
  approxVec(spec.bodies[1]!.quaternion, yawY);
});

check("ragdoll spec: sphere/capsule mass from volume; degenerate body hits the mass floor", () => {
  const resolve = boneResolver({ b: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } });
  const spec = buildRagdollSpec(
    [
      { name: "head", bone: "b", shape: "sphere", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.5, 0.5, 0.5] },
      { name: "limb", bone: "b", shape: "capsule", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.2, 0.6, 0.2] },
      { name: "speck", bone: "b", shape: "box", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.01, 0.01, 0.01] },
    ],
    [],
    resolve,
  );
  // Sphere r=0.25 → (4/3)πr³ × 1000 ≈ 65.45 kg.
  assert.ok(Math.abs(spec.bodies[0]!.mass - 65.4498) < 1e-3, `sphere mass ${spec.bodies[0]!.mass}`);
  // Capsule r=0.1, cyl height 0.4 → (πr²h + (4/3)πr³) × 1000 ≈ 16.76 kg.
  assert.ok(Math.abs(spec.bodies[1]!.mass - 16.7552) < 1e-3, `capsule mass ${spec.bodies[1]!.mass}`);
  // 0.01³ box → 0.001 kg, clamped up to the 0.1 kg floor.
  assert.equal(spec.bodies[2]!.mass, 0.1);
});

check("ragdoll spec: joint anchors at the child body and converts limits to radians", () => {
  const resolve = boneResolver({
    hips: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
    leg: { position: [0, 0.5, 0], quaternion: [0, 0, 0, 1] },
  });
  const spec = buildRagdollSpec(
    [
      { name: "pelvis", bone: "hips", shape: "box", position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] },
      { name: "thigh", bone: "leg", shape: "capsule", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.2, 0.5, 0.2] },
    ],
    [{ name: "hip", bodyA: "pelvis", bodyB: "thigh", swingDeg: 90, twistDeg: 45 }],
    resolve,
  );
  assert.equal(spec.joints.length, 1);
  const joint = spec.joints[0]!;
  assert.equal(joint.bodyA, "pelvis");
  assert.equal(joint.bodyB, "thigh");
  approxVec(joint.anchor, [0, 0.5, 0]); // child (bodyB) world origin
  assert.ok(Math.abs(joint.swingRad - Math.PI / 2) < 1e-9, `swing ${joint.swingRad}`);
  assert.ok(Math.abs(joint.twistRad - Math.PI / 4) < 1e-9, `twist ${joint.twistRad}`);
});

check("ragdoll spec: skips unknown-bone bodies and joints with a missing endpoint", () => {
  const resolve = boneResolver({ hips: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } });
  const spec = buildRagdollSpec(
    [
      { name: "pelvis", bone: "hips", shape: "box", position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] },
      // "ghost" bone has no world transform → body dropped.
      { name: "phantom", bone: "ghost", shape: "box", position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] },
    ],
    [
      { name: "ok", bodyA: "pelvis", bodyB: "pelvis", swingDeg: 10, twistDeg: 10 }, // both present (self ok at spec level)
      { name: "dangling", bodyA: "pelvis", bodyB: "phantom", swingDeg: 10, twistDeg: 10 }, // bodyB dropped → joint dropped
    ],
    resolve,
  );
  assert.deepEqual(spec.bodies.map((body) => body.name), ["pelvis"]);
  assert.deepEqual(spec.joints.map((joint) => joint.name), ["ok"]);
});

check("ragdoll joint: world anchor → body-local frame (translation + inverse rotation)", () => {
  // Identity body: local anchor is just the offset from the body origin.
  approxVec(worldAnchorToBodyLocal([1, 2, 3], [1, 1, 1], [0, 0, 0, 1]), [0, 1, 2]);
  // Body rotated +90° about Y at the origin: a world +X anchor maps to local +Z.
  const yawY = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number];
  approxVec(worldAnchorToBodyLocal([1, 0, 0], [0, 0, 0], yawY), [0, 0, 1]);
});

check("ragdoll group desc: bodies map 1:1; joint anchors lower to per-body local frames", () => {
  const resolve = boneResolver({
    hips: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
    leg: { position: [0, 0.5, 0], quaternion: [0, 0, 0, 1] },
  });
  const spec = buildRagdollSpec(
    [
      { name: "pelvis", bone: "hips", shape: "box", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.3, 0.3, 0.2] },
      { name: "thigh", bone: "leg", shape: "capsule", position: [0, 0, 0], rotation: [0, 0, 0], size: [0.2, 0.5, 0.2] },
    ],
    [{ name: "hip", bodyA: "pelvis", bodyB: "thigh", swingDeg: 60, twistDeg: 20 }],
    resolve,
  );
  const group = toRagdollGroupDesc(spec);
  assert.deepEqual(group.bodies.map((body) => body.name), ["pelvis", "thigh"]);
  assert.equal(group.bodies[0]!.shape, "box");
  assert.equal(group.joints.length, 1);
  const joint = group.joints[0]!;
  // Anchor lives at the child (thigh) origin → local-to-thigh ≈ 0; local-to-pelvis
  // is that point relative to the pelvis (1 unit below, both identity-rotated).
  approxVec(joint.anchorB, [0, 0, 0]);
  approxVec(joint.anchorA, [0, -0.5, 0]);
  assert.ok(Math.abs(joint.swingRad - (60 * Math.PI) / 180) < 1e-9);
  assert.ok(Math.abs(joint.twistRad - (20 * Math.PI) / 180) < 1e-9);
});

check("ragdoll bone driving: boneWorldFromBodyPose inverts buildRagdollSpec placement", () => {
  // The driver poses a bone by inverting the spec's body placement. Round-trip a
  // non-trivial bone world transform + body offset through both directions.
  const boneWorld = {
    position: [5, 1, 2] as [number, number, number],
    quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number],
  };
  const body = {
    name: "b",
    bone: "k",
    shape: "box" as const,
    position: [0.1, -0.2, 0.05] as [number, number, number],
    rotation: [0, 0, 90] as [number, number, number],
    size: [0.2, 0.4, 0.2] as [number, number, number],
  };
  const placed = buildRagdollSpec([body], [], boneResolver({ k: boneWorld })).bodies[0]!;
  const offsetQuat = new Quaternion().setFromEuler(new Euler(0, 0, (90 * Math.PI) / 180, "XYZ"));
  const recovered = boneWorldFromBodyPose(placed.position, placed.quaternion, body.position, [
    offsetQuat.x,
    offsetQuat.y,
    offsetQuat.z,
    offsetQuat.w,
  ]);
  approxVec(recovered.position, boneWorld.position);
  approxVec(recovered.quaternion, boneWorld.quaternion);
});

check("ragdoll joint limits: authored kept when bodies align; widened past the rest angle", () => {
  const identity = [0, 0, 0, 1] as [number, number, number, number];
  // Aligned bodies (rest angle ~0): authored swing/twist survive (both > the margin).
  const aligned = ragdollJointAngularLimits(identity, identity, 0.6, 0.4);
  assert.ok(Math.abs(aligned.swing - 0.6) < 1e-9, `swing ${aligned.swing}`);
  assert.ok(Math.abs(aligned.twist - 0.4) < 1e-9, `twist ${aligned.twist}`);
  // 90°-apart bodies (a hip/shoulder root): a tight authored limit is widened to
  // restAngle (π/2) + margin so the joint can't start in violation.
  const yaw90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number];
  const widened = ragdollJointAngularLimits(identity, yaw90, 0.3, 0.2);
  const expected = Math.PI / 2 + 0.0873;
  assert.ok(Math.abs(widened.swing - expected) < 1e-3, `widened swing ${widened.swing}`);
  assert.ok(Math.abs(widened.twist - expected) < 1e-3, `widened twist ${widened.twist}`);
  // A generous authored limit (larger than rest) is preserved.
  assert.equal(ragdollJointAngularLimits(identity, identity, 2, 2).swing, 2);
});

check("get-up blend factor: clamps, smoothsteps, and snaps on a zero window", () => {
  // Endpoints hold the ragdoll pose (0) and reach the animation pose (1).
  assert.equal(getUpBlendFactor(0, 0.5), 0);
  assert.equal(getUpBlendFactor(0.5, 0.5), 1);
  // Clamped outside [0, duration].
  assert.equal(getUpBlendFactor(-1, 0.5), 0);
  assert.equal(getUpBlendFactor(2, 0.5), 1);
  // Smoothstep: midpoint is 0.5 with zero slope at the ends (monotonic between).
  assert.ok(Math.abs(getUpBlendFactor(0.25, 0.5) - 0.5) < 1e-9);
  assert.ok(getUpBlendFactor(0.1, 0.5) < getUpBlendFactor(0.2, 0.5));
  // A zero/negative window snaps straight to the animation pose.
  assert.equal(getUpBlendFactor(0, 0), 1);
});

check("BehaviorSubsystem.subscribeScriptMessage delivers target-scoped events then unsubscribes", () => {
  // Inject a bus without a targetExists guard so the test needn't register runtime
  // entities; this exercises the subscribe/target forwarding of the new method.
  const bus = new ScriptMessageBus();
  const subsystem = new BehaviorSubsystem(
    createBehaviorRegistry(),
    new ActionMap({}),
    () => undefined,
    undefined,
    undefined,
    { messageBus: bus },
  );
  const sources: string[] = [];
  const unsubscribe = subsystem.subscribeScriptMessage(
    "death",
    (envelope) => sources.push(envelope.source),
    { target: "player" },
  );
  subsystem.emitScriptMessage("death", "enemy", {}, "player"); // targeted at player → delivered
  subsystem.emitScriptMessage("death", "enemy", {}, "npc"); // other target → not delivered
  subsystem.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 });
  assert.deepEqual(sources, ["enemy"]);
  unsubscribe();
  subsystem.emitScriptMessage("death", "enemy", {}, "player");
  subsystem.update({ deltaSeconds: 0.016, elapsedSeconds: 0.032, frame: 2 });
  assert.deepEqual(sources, ["enemy"]);
});

check("asset skeleton sidecar normalizes animation metadata", () => {
  assert.equal(
    skeletonSidecarPath("assets/characters/Hero.glb"),
    "assets/characters/Hero.skeleton.json",
  );
  const skeleton = normalizeAssetSkeleton({
    schema: 1,
    sockets: [
      {
        name: "weapon_r",
        bone: "hand_r",
        position: [1.123456, 2, 3],
        rotation: [0, 90, 0],
        scale: [1, 1, 1],
        previewAssetId: "starter-sword",
      },
      { name: "", bone: "bad" },
    ],
    animationSet: { idle: "Idle", walk: "Walk", unknown: "Ignored" },
    blendSpaces: [
      {
        name: "Locomotion",
        type: "1d",
        axisX: { name: "Speed", min: 0, max: 4 },
        // max <= min and out-of-range/NaN sample positions are repaired/clamped.
        samples: [
          { clip: "Idle", x: -2 },
          { clip: "Run", x: 9 },
          { clip: "", x: 2 },
          { clip: "Walk", x: "bad" },
        ],
      },
      { name: "Locomotion", type: "1d" }, // duplicate name dropped
      { name: "", type: "1d" }, // empty name dropped
    ],
    notifies: [],
    montages: [
      { name: "fire", clip: "Shoot", slot: "upperBody", loop: false },
      { name: "aim", clip: "Hold", loop: true, blendInSeconds: 0.25, blendOutSeconds: 9 },
      { name: "fire", clip: "Dup" }, // duplicate name dropped
      { name: "bad", clip: "" }, // empty clip dropped
    ],
    upperBodyBone: "torso",
    preview: { selectedClip: "Idle" },
  });
  assert.deepEqual(skeleton.animationSet, { idle: "Idle", walk: "Walk" });
  assert.equal(skeleton.sockets.length, 1);
  assert.deepEqual(skeleton.sockets[0]?.position, [1.1235, 2, 3]);
  assert.equal(skeleton.sockets[0]?.previewAssetId, "starter-sword");
  assert.deepEqual(skeleton.preview, { selectedClip: "Idle" });
  assert.equal(skeleton.upperBodyBone, "torso");
  // Montages: duplicate name + empty clip dropped; defaults filled; blend clamped.
  assert.deepEqual(skeleton.montages, [
    { name: "fire", clip: "Shoot", slot: "upperBody", loop: false, blendInSeconds: 0.12, blendOutSeconds: 0.2 },
    { name: "aim", clip: "Hold", slot: "upperBody", loop: true, blendInSeconds: 0.25, blendOutSeconds: 4 },
  ]);
  assert.equal(skeleton.blendSpaces.length, 1);
  const blend = skeleton.blendSpaces[0]!;
  assert.equal(blend.name, "Locomotion");
  assert.equal(blend.type, "1d");
  assert.equal(blend.axisY, undefined);
  // Empty-clip / NaN-position samples dropped or clamped to the axis domain.
  assert.deepEqual(
    blend.samples,
    [
      { clip: "Idle", x: 0 },
      { clip: "Run", x: 4 },
      { clip: "Walk", x: 0 },
    ],
  );
});

check("blend space 1d resolver interpolates between bracketing samples", () => {
  const blend: AssetSkeletonBlendSpaceDef = {
    name: "Locomotion",
    type: "1d",
    axisX: { name: "Speed", min: 0, max: 4 },
    samples: [
      { clip: "Idle", x: 0 },
      { clip: "Walk", x: 2 },
      { clip: "Run", x: 4 },
    ],
  };
  // Exact sample positions resolve to a single clip.
  assert.deepEqual(resolveBlendSpaceWeights(blend, { x: 0 }), [{ clip: "Idle", weight: 1 }]);
  assert.deepEqual(resolveBlendSpaceWeights(blend, { x: 2 }), [{ clip: "Walk", weight: 1 }]);
  // Midpoints split weight evenly between the two neighbours.
  assert.deepEqual(resolveBlendSpaceWeights(blend, { x: 1 }), [
    { clip: "Idle", weight: 0.5 },
    { clip: "Walk", weight: 0.5 },
  ]);
  assert.deepEqual(resolveBlendSpaceWeights(blend, { x: 3 }), [
    { clip: "Walk", weight: 0.5 },
    { clip: "Run", weight: 0.5 },
  ]);
  // Out-of-range params clamp to the nearest end sample.
  assert.deepEqual(resolveBlendSpaceWeights(blend, { x: -5 }), [{ clip: "Idle", weight: 1 }]);
  assert.deepEqual(resolveBlendSpaceWeights(blend, { x: 50 }), [{ clip: "Run", weight: 1 }]);
});

check("blend space resolver weights are normalized and merge duplicate clips", () => {
  const oneSample: AssetSkeletonBlendSpaceDef = {
    name: "Single",
    type: "1d",
    axisX: { name: "Speed", min: 0, max: 4 },
    samples: [{ clip: "Idle", x: 2 }],
  };
  assert.deepEqual(resolveBlendSpaceWeights(oneSample, { x: 99 }), [{ clip: "Idle", weight: 1 }]);
  assert.deepEqual(resolveBlendSpaceWeights({ ...oneSample, samples: [] }, { x: 0 }), []);

  // A clip appearing on two neighbouring samples collapses to one entry summing to 1.
  const duplicate: AssetSkeletonBlendSpaceDef = {
    name: "Dup",
    type: "1d",
    axisX: { name: "Speed", min: 0, max: 4 },
    samples: [
      { clip: "Walk", x: 0 },
      { clip: "Walk", x: 4 },
    ],
  };
  assert.deepEqual(resolveBlendSpaceWeights(duplicate, { x: 2 }), [{ clip: "Walk", weight: 1 }]);

  // 2D inverse-distance weighting: an exact hit wins outright; weights stay normalized.
  const blend2d: AssetSkeletonBlendSpaceDef = {
    name: "Aim",
    type: "2d",
    axisX: { name: "X", min: -1, max: 1 },
    axisY: { name: "Y", min: -1, max: 1 },
    samples: [
      { clip: "A", x: -1, y: -1 },
      { clip: "B", x: 1, y: -1 },
      { clip: "C", x: -1, y: 1 },
      { clip: "D", x: 1, y: 1 },
    ],
  };
  assert.deepEqual(resolveBlendSpaceWeights(blend2d, { x: -1, y: -1 }), [{ clip: "A", weight: 1 }]);
  const centre = resolveBlendSpaceWeights(blend2d, { x: 0, y: 0 });
  assert.equal(centre.length, 4);
  const total = centre.reduce((sum, entry) => sum + entry.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "2d weights sum to 1");
  for (const entry of centre) {
    assert.ok(Math.abs(entry.weight - 0.25) < 1e-9, "equidistant centre weights are equal");
  }
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
      roughnessTexture: "tex-stone-r",
      metalnessTexture: "tex-stone-metal",
      aoTexture: "tex-stone-ao",
      opacityTexture: "tex-stone-opacity",
      emissiveTexture: "tex-stone-emissive",
      ormTexture: null,
      uvTiling: { x: 2, y: 3 },
      roughness: 0.72,
      metalness: 0,
      aoIntensity: 0.6,
      opacity: 1,
      alphaMode: "opaque",
      alphaTest: 0.5,
      side: "front",
      emissive: "#000000",
      emissiveIntensity: 0,
      layerBlend: {
        layer1: {
          baseColor: "#f0f8ff",
          baseColorTexture: "tex-snow-d",
          normalTexture: "tex-snow-n",
          roughnessTexture: "tex-snow-r",
          metalnessTexture: null,
          opacityTexture: "tex-snow-o",
          emissiveTexture: "tex-snow-e",
          aoTexture: "tex-snow-ao",
          roughness: 0.9,
          metalness: 0,
          opacity: 0.85,
          emissive: "#203040",
          emissiveIntensity: 1.25,
          aoIntensity: 0.7,
          uvTiling: { x: 4, y: 4 },
        },
        driver: "slope",
        amount: 0.5,
        min: 0.35,
        max: 0.85,
        contrast: 1.5,
        maskTexture: null,
      },
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
    roughnessTexture: "tex-stone-r",
    metalnessTexture: "tex-stone-metal",
    aoTexture: "tex-stone-ao",
    opacityTexture: "tex-stone-opacity",
    emissiveTexture: "tex-stone-emissive",
    ormTexture: "tex-stone-m",
    uvTiling: { x: 2, y: 3 },
    roughness: 0.72,
    metalness: 0,
    aoIntensity: 0.6,
    opacity: 1,
    alphaMode: "opaque",
    alphaTest: 0.5,
    side: "front",
    emissive: "#000000",
    emissiveIntensity: 0,
    layerBlend: {
      layer1: {
        baseColor: "#f0f8ff",
        baseColorTexture: "tex-snow-d",
        normalTexture: "tex-snow-n",
        roughnessTexture: "tex-snow-r",
        metalnessTexture: null,
        opacityTexture: "tex-snow-o",
        emissiveTexture: "tex-snow-e",
        aoTexture: "tex-snow-ao",
        roughness: 0.9,
        metalness: 0,
        opacity: 0.85,
        emissive: "#203040",
        emissiveIntensity: 1.25,
        aoIntensity: 0.7,
        uvTiling: { x: 4, y: 4 },
      },
      driver: "slope",
      amount: 0.5,
      min: 0.35,
      max: 0.85,
      contrast: 1.5,
      maskTexture: null,
    },
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
  assert.throws(() =>
    validateForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Bad",
      uvTiling: { x: 0, y: 1 },
    }),
  );
  assert.throws(() =>
    validateForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Bad",
      aoIntensity: 2,
    }),
  );
  assert.throws(() =>
    validateForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Bad",
      layerBlend: { driver: "vertexColor", layer1: {} },
    }),
  );
  const maskDriven = validateForgeMaterialDef({
    schema: 1,
    type: "material",
    materialType: "standard",
    name: "Mask Driven",
    layerBlend: {
      driver: "maskTexture",
      maskTexture: "blend-mask",
      layer1: {},
    },
  });
  assert.equal((maskDriven.layerBlend as Record<string, unknown>).maskTexture, "blend-mask");

  const legacyLayerMask = normalizeForgeMaterialDef({
    schema: 1,
    type: "material",
    materialType: "standard",
    name: "Legacy Layer Mask",
    maskTexture: "legacy-mask",
    layerBlend: {
      driver: "maskTexture",
      layer1: {},
    },
  });
  assert.equal(legacyLayerMask.maskTexture, null);
  assert.equal(legacyLayerMask.ormTexture, null);
  assert.equal(legacyLayerMask.layerBlend?.maskTexture, "legacy-mask");

  const savedLegacyLayerMask = validateForgeMaterialDef({
    schema: 1,
    type: "material",
    materialType: "standard",
    name: "Saved Legacy Layer Mask",
    maskTexture: "legacy-mask",
    layerBlend: {
      driver: "maskTexture",
      layer1: {},
    },
  });
  assert.equal(savedLegacyLayerMask.maskTexture, null);
  assert.equal(savedLegacyLayerMask.ormTexture, null);
  assert.equal((savedLegacyLayerMask.layerBlend as Record<string, unknown>).maskTexture, "legacy-mask");
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
    assert.ok(material.aoIntensity >= 0 && material.aoIntensity <= 1);
    assert.ok(material.opacity >= 0 && material.opacity <= 1);
    assert.ok(material.uvTiling.x > 0 && material.uvTiling.y > 0);
    assert.ok(material.layerBlend === null || material.layerBlend.layer1.baseColor.length === 7);
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
  assert.equal(standard.emissiveIntensity, 2 * EMISSIVE_INTENSITY_SCALE);
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
      uvTiling: { x: 3, y: 4 },
    }),
    { baseColorTexture, normalTexture },
    { maxAnisotropy: 16 },
  );
  assert.ok(textured instanceof MeshStandardMaterial);
  assert.equal(textured.map, baseColorTexture);
  assert.equal(textured.normalMap, normalTexture);
  assert.equal(baseColorTexture.colorSpace, SRGBColorSpace);
  assert.equal(baseColorTexture.wrapS, RepeatWrapping);
  assert.equal(baseColorTexture.wrapT, RepeatWrapping);
  assert.equal(baseColorTexture.repeat.x, 3);
  assert.equal(baseColorTexture.repeat.y, 4);
  assert.equal(baseColorTexture.anisotropy, 8);
  assert.equal(normalTexture.colorSpace, NoColorSpace);
  assert.equal(normalTexture.wrapS, RepeatWrapping);
  assert.equal(normalTexture.wrapT, RepeatWrapping);
  assert.equal(normalTexture.repeat.x, 3);
  assert.equal(normalTexture.repeat.y, 4);
  assert.equal(normalTexture.anisotropy, 8);
  textured.dispose();

  const roughnessTexture = new Texture();
  const metalnessTexture = new Texture();
  const aoTexture = new Texture();
  const opacityTexture = new Texture();
  const emissiveTexture = new Texture();
  const mapped = createThreeMaterialFromForgeDef(
    normalizeForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Surface Maps",
      roughnessTexture: "rough",
      metalnessTexture: "metal",
      aoTexture: "ao",
      opacityTexture: "opacity",
      emissiveTexture: "emissive",
      aoIntensity: 0.4,
    }),
    { roughnessTexture, metalnessTexture, aoTexture, opacityTexture, emissiveTexture },
    { maxAnisotropy: 4 },
  );
  assert.ok(mapped instanceof MeshStandardMaterial);
  assert.equal(mapped.roughnessMap, roughnessTexture);
  assert.equal(mapped.metalnessMap, metalnessTexture);
  assert.equal(mapped.aoMap, aoTexture);
  assert.equal(mapped.alphaMap, opacityTexture);
  assert.equal(mapped.emissiveMap, emissiveTexture);
  assert.equal(mapped.transparent, true);
  assert.equal(mapped.aoMapIntensity, 0.4);
  assert.equal(roughnessTexture.colorSpace, NoColorSpace);
  assert.equal(metalnessTexture.colorSpace, NoColorSpace);
  assert.equal(aoTexture.colorSpace, NoColorSpace);
  assert.equal(opacityTexture.colorSpace, NoColorSpace);
  assert.equal(emissiveTexture.colorSpace, SRGBColorSpace);
  assert.equal(roughnessTexture.anisotropy, 4);
  mapped.dispose();

  const ormTexture = new Texture();
  const orm = createThreeMaterialFromForgeDef(
    normalizeForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Packed ORM",
      maskTexture: "legacy-orm",
      aoIntensity: 0.75,
    }),
    { ormTexture },
  );
  assert.ok(orm instanceof MeshStandardMaterial);
  assert.equal(orm.roughnessMap, ormTexture);
  assert.equal(orm.metalnessMap, ormTexture);
  assert.equal(orm.aoMap, ormTexture);
  assert.equal(orm.aoMapIntensity, 0.75);
  assert.equal(ormTexture.colorSpace, NoColorSpace);
  orm.dispose();

  const layer1BaseColorTexture = new Texture();
  const layer1NormalTexture = new Texture();
  const layer1RoughnessTexture = new Texture();
  const layer1MetalnessTexture = new Texture();
  const layer1OpacityTexture = new Texture();
  const layer1EmissiveTexture = new Texture();
  const layer1AoTexture = new Texture();
  const layerBlendMaskTexture = new Texture();
  const layerBlend = createThreeMaterialFromForgeDef(
    normalizeForgeMaterialDef({
      schema: 1,
      type: "material",
      materialType: "standard",
      name: "Layer Blend",
      baseColorTexture: "rock-d",
      normalTexture: "rock-n",
      layerBlend: {
        layer1: {
          baseColor: "#ffffff",
          baseColorTexture: "snow-d",
          normalTexture: "snow-n",
          roughnessTexture: "snow-r",
          metalnessTexture: "snow-m",
          opacityTexture: "snow-o",
          emissiveTexture: "snow-e",
          aoTexture: "snow-ao",
          roughness: 0.9,
          metalness: 0.1,
          opacity: 0.55,
          emissive: "#101820",
          emissiveIntensity: 1.5,
          aoIntensity: 0.65,
          uvTiling: { x: 5, y: 6 },
        },
        driver: "maskTexture",
        amount: 0.25,
        min: 2,
        max: 8,
        contrast: 1.2,
        maskTexture: "snow-mask",
      },
    }),
    {
      baseColorTexture: new Texture(),
      normalTexture: new Texture(),
      layer1BaseColorTexture,
      layer1NormalTexture,
      layer1RoughnessTexture,
      layer1MetalnessTexture,
      layer1OpacityTexture,
      layer1EmissiveTexture,
      layer1AoTexture,
      layerBlendMaskTexture,
    },
    { maxAnisotropy: 16 },
  );
  assert.ok(layerBlend instanceof MeshStandardMaterial);
  assert.equal(layerBlend.defines?.FORGE_LAYER_BLEND, "");
  assert.equal(layerBlend.defines?.USE_FORGE_LAYER_MAP, "");
  assert.equal(layerBlend.defines?.USE_FORGE_LAYER_NORMALMAP, "");
  assert.equal(layerBlend.defines?.USE_FORGE_LAYER_MASKMAP, "");
  assert.equal(layerBlend.defines?.USE_FORGE_LAYER_OPACITYMAP, "");
  assert.equal(layerBlend.defines?.USE_FORGE_LAYER_EMISSIVEMAP, "");
  assert.equal(layerBlend.defines?.USE_FORGE_LAYER_AOMAP, "");
  assert.equal(layerBlend.transparent, true);
  assert.match(layerBlend.customProgramCacheKey(), /forge-layer-blend-v1:maskTexture:bc:n:r:m:o:e:ao:mask/);
  assert.equal(layer1BaseColorTexture.repeat.x, 5);
  assert.equal(layer1BaseColorTexture.repeat.y, 6);
  assert.equal(layer1BaseColorTexture.anisotropy, 8);
  assert.equal(layer1OpacityTexture.colorSpace, NoColorSpace);
  assert.equal(layer1EmissiveTexture.colorSpace, SRGBColorSpace);
  assert.equal(layer1AoTexture.colorSpace, NoColorSpace);
  assert.equal(layerBlendMaskTexture.colorSpace, NoColorSpace);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\nvoid main(){\n#include <worldpos_vertex>\n}",
    fragmentShader:
      "#include <common>\nvoid main(){\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <alphamap_fragment>\n#include <emissivemap_fragment>\n#include <aomap_fragment>\n#include <normal_fragment_maps>\n}",
  } as Parameters<MeshStandardMaterial["onBeforeCompile"]>[0];
  layerBlend.onBeforeCompile(shader, null!);
  assert.ok("forgeLayerMap" in shader.uniforms);
  assert.ok("forgeLayerNormalMap" in shader.uniforms);
  assert.ok("forgeLayerOpacityMap" in shader.uniforms);
  assert.ok("forgeLayerEmissiveMap" in shader.uniforms);
  assert.ok("forgeLayerAoMap" in shader.uniforms);
  assert.ok("forgeLayerMaskMap" in shader.uniforms);
  assert.match(shader.vertexShader, /vForgeLayerWorldPosition/);
  assert.match(shader.fragmentShader, /forgeLayerBlendFactor/);
  assert.match(shader.fragmentShader, /forgeLayerMaskMap/);
  // Regression guard for the "vUv undeclared" blank-material bug: forgeLayerBlendFactor
  // is injected into <common>, which precedes <uv_pars_fragment> (where three declares
  // `vUv`). Nothing before <map_fragment> may reference vUv, or the whole material fails
  // to compile and renders black the moment a mask is assigned.
  const mapFragmentIndex = shader.fragmentShader.indexOf("#include <map_fragment>");
  const fragBeforeMap = shader.fragmentShader
    .slice(0, mapFragmentIndex)
    .replace(/\/\/[^\n]*/g, ""); // strip line comments (which may mention vUv in prose)
  assert.ok(fragBeforeMap.includes("forgeLayerBlendFactor"), "blend factor declared in <common>");
  assert.ok(!fragBeforeMap.includes("vUv"), "no vUv usage before <map_fragment>");
  assert.ok(
    shader.fragmentShader.indexOf("texture2D( forgeLayerMaskMap, vUv )") > mapFragmentIndex,
    "mask sampled at/after <map_fragment> where vUv is in scope",
  );
  // The blend mask is a whole-surface selector: it samples raw `vUv` (1:1) — where vUv is
  // in scope (at/after <map_fragment>) — never the per-layer detail tiling.
  assert.match(shader.fragmentShader, /texture2D\( forgeLayerMaskMap, vUv \)\.r/);
  assert.match(shader.fragmentShader, /forgeLayerBlendFactor\( forgeLayerMaskSample \)/);
  assert.equal(layerBlendMaskTexture.repeat.x, 1);
  assert.equal(layerBlendMaskTexture.repeat.y, 1);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb = mix/);
  assert.match(shader.fragmentShader, /roughnessFactor = mix/);
  assert.match(shader.fragmentShader, /metalnessFactor = mix/);
  assert.match(shader.fragmentShader, /diffuseColor\.a = mix/);
  assert.match(shader.fragmentShader, /totalEmissiveRadiance = mix/);
  assert.match(shader.fragmentShader, /ambientOcclusion = mix/);
  assert.match(shader.fragmentShader, /normalize\( mix\( normal/);
  layerBlend.dispose();

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
  assert.equal(validateContentNewPayload({ kind: "material", dir: "", name: "Light" }).name, "Light");
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
    roughnessTexture: null,
    metalnessTexture: null,
    aoTexture: null,
    opacityTexture: null,
    emissiveTexture: null,
    ormTexture: null,
    uvTiling: { x: 1, y: 1 },
    roughness: 0.8,
    metalness: 0,
    aoIntensity: 1,
    opacity: 1,
    alphaMode: "opaque",
    alphaTest: 0.5,
    side: "front",
    emissive: "#000000",
    emissiveIntensity: 0,
    layerBlend: null,
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
    roughnessTexture: null,
    metalnessTexture: null,
    aoTexture: null,
    opacityTexture: null,
    emissiveTexture: null,
    ormTexture: null,
    uvTiling: { x: 1, y: 1 },
    roughness: 0.3,
    metalness: 1,
    aoIntensity: 1,
    opacity: 1,
    alphaMode: "opaque",
    alphaTest: 0.5,
    side: "front",
    emissive: "#000000",
    emissiveIntensity: 0,
    layerBlend: null,
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

  const cue = resolveContentNewFile({ kind: "soundCue", dir: "assets/sounds", name: "Footstep Cue" });
  assert.equal(cue.path, "assets/sounds/Footstep Cue.soundcue.json");
  assert.deepEqual(JSON.parse(cue.content ?? ""), {
    schema: 1,
    type: "soundCue",
    name: "Footstep Cue",
    output: { volume: 1, pitch: 1, bus: "sfx" },
    nodes: [{ id: "output", kind: "output", volume: 1, pitch: 1 }],
    connections: [],
  });
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
  assert.deepEqual(def.interfaces, []);
  assert.deepEqual(def.references, []);
  assert.deepEqual(def.dispatchers, []);
  assert.deepEqual(def.messageBindings, []);
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
  // Plain safe names are allowed in the base name.
  assert.equal(
    validateContentRenamePayload({ path: "assets/a.glb", name: "Light" }).name,
    "Light",
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
  // Legacy stub (old `type:"script"` with a dead graph) â†’ empty actor class.
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
    interfaces: ["Usable", "Toggleable", "Usable", ""],
    references: [
      { key: "nodeDoor", selector: { byNodeId: "door-node" } },
      { key: "door", selector: { byName: "Door_01", bogus: true } },
      { key: "", selector: { byName: "Bad" } },
      { key: "empty", selector: {} },
    ],
    dispatchers: [
      { name: "Lamp.Toggled", payload: { enabled: "boolean", bad: 42 } },
      { name: "", payload: {} },
    ],
    eventBindings: [
      { event: "tick", scriptId: "spin", params: { speedDeg: 90 } },
      { event: "tick", scriptId: "" }, // dropped (empty id)
      { event: "bogus", scriptId: "x" }, // dropped (bad event)
    ],
    messageBindings: [
      { message: "Toggleable.Toggle", scriptId: "lamp-toggle", target: "self" },
      { message: "", scriptId: "bad" },
      { message: "Bad", scriptId: "" },
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
  assert.deepEqual(messy.interfaces, ["Usable", "Toggleable"]);
  assert.deepEqual(messy.references, [
    { key: "nodeDoor", selector: { byNodeId: "door-node" } },
    { key: "door", selector: { byName: "Door_01" } },
  ]);
  assert.deepEqual(messy.dispatchers, [
    { name: "Lamp.Toggled", payload: { enabled: "boolean" } },
  ]);
  assert.deepEqual(messy.messageBindings, [
    { message: "Toggleable.Toggle", scriptId: "lamp-toggle", target: "self" },
  ]);

  const character = defaultActorScriptDef("Player", "character");
  assert.equal(character.components.some((node) => node.component === "Collider"), true);
  assert.equal(character.components.some((node) => node.component === "MeshRenderer"), true);
  assert.equal(character.components.some((node) => node.component === "CharacterMovement"), true);
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

check("actor save payload preserves CharacterMovement control-orientation props", () => {
  const payload = validateSaveActorPayload({
    path: "assets/blueprints/Player.actor.json",
    actor: {
      name: "Player",
      parentClass: "character",
      components: [
        { id: "root", component: "Transform", props: {} },
        {
          id: "move",
          parent: "root",
          component: "CharacterMovement",
          props: {
            rotationRate: [0, 0, 270],
            orientRotationToMovement: false,
            orientRotationToControl: true,
          },
        },
      ],
    },
  });
  const movement = (payload.actor.components as Array<{ component: string; props: Record<string, unknown> }>).find(
    (node) => node.component === "CharacterMovement",
  );
  assert.deepEqual(movement?.props.rotationRate, [0, 0, 270]);
  assert.equal(movement?.props.orientRotationToMovement, false);
  assert.equal(movement?.props.orientRotationToControl, true);
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
  assert.ok(stub.source.includes("context.messages.send"));
  assert.ok(stub.source.includes("context.world.ref"));
  assert.ok(stub.source.includes("context.message"));

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
      {
        id: "move",
        parent: "root",
        component: "CharacterMovement",
        props: {
          maxWalkSpeed: 4,
          jumpSpeed: 6,
          rotationRate: [0, 0, 360],
          orientRotationToControl: true,
        },
      },
      // Second MeshRenderer is ignored: first node of each kind wins (flat entity).
      { id: "mesh2", parent: "root", component: "MeshRenderer", props: { assetId: "ignored" } },
    ],
    interfaces: ["Usable", "Toggleable"],
    references: [
      { key: "panel", selector: { byNodeId: "panel-node" } },
      { key: "controller", selector: { byClassRef: "blueprints/Controller.actor.json" } },
    ],
    dispatchers: [{ name: "Door.Opened", payload: { locked: "boolean" } }],
    messageBindings: [
      {
        message: "Toggleable.Toggle",
        scriptId: "door-toggle",
        params: { sound: "door" },
        target: "self",
      },
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
  const movement = readCharacterMovementComponent(entity);
  assert.equal(movement?.maxWalkSpeed, 4);
  assert.equal(movement?.jumpSpeed, 6);
  assert.deepEqual(movement?.rotationRate, [0, 0, 360]);
  assert.equal(movement?.orientRotationToControl, true);
  // The first event binding compiles to the single Behavior.
  const behavior = readBehaviorComponent(entity);
  assert.equal(behavior?.scriptId, "spin");
  assert.deepEqual(behavior?.params, { speedDeg: 45 });
  assert.deepEqual(readScriptActorComponent(entity), {
    classRef: "blueprints/DoorBP.actor.json",
  });
  assert.deepEqual(readScriptInterfacesComponent(entity), {
    interfaces: ["Usable", "Toggleable"],
  });
  assert.deepEqual(readScriptReferencesComponent(entity), {
    references: [
      { key: "panel", selector: { byNodeId: "panel-node" } },
      { key: "controller", selector: { byClassRef: "blueprints/Controller.actor.json" } },
    ],
  });
  assert.deepEqual(readScriptDispatchersComponent(entity), {
    dispatchers: [{ name: "Door.Opened", payload: { locked: "boolean" } }],
  });
  assert.deepEqual(readMessageBindingsComponent(entity), {
    bindings: [
      {
        message: "Toggleable.Toggle",
        scriptId: "door-toggle",
        params: { sound: "door" },
        target: "self",
      },
    ],
  });

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

check("readCameraComponent reads authored projection, else runtime-camera defaults", () => {
  const def = normalizeActorScriptDef({
    name: "Cam",
    components: [
      { id: "root", component: "Transform", props: {} },
      {
        id: "cam",
        parent: "root",
        component: "Camera",
        props: {
          fieldOfView: 60,
          nearClip: 0.5,
          farClip: 200,
          isOrthographic: true,
          orthoWidth: 14,
          enableSprintCameraShake: false,
        },
      },
    ],
  });
  const entity = actorInstanceToEntity(def, { classRef: "Cam.actor.json", position: [0, 0, 0] }, 0);
  assert.deepEqual(readCameraComponent(entity), {
    fieldOfView: 60,
    nearClip: 0.5,
    farClip: 200,
    isOrthographic: true,
    orthoWidth: 14,
    enableSprintCameraShake: false,
  });

  // Empty props fall back to the runtime camera defaults (FOV 44, near 0.1, far 100).
  const bare = normalizeActorScriptDef({
    name: "Cam2",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "cam", parent: "root", component: "Camera", props: {} },
    ],
  });
  const bareEntity = actorInstanceToEntity(bare, { classRef: "Cam2.actor.json", position: [0, 0, 0] }, 0);
  assert.deepEqual(readCameraComponent(bareEntity), {
    fieldOfView: 44,
    nearClip: 0.1,
    farClip: 100,
    isOrthographic: false,
    orthoWidth: 10,
    enableSprintCameraShake: true,
  });
});

check("readSpringArmComponent reads authored boom, else defaults; doCollisionTest defaults true", () => {
  const def = normalizeActorScriptDef({
    name: "Boom",
    components: [
      { id: "root", component: "Transform", props: {} },
      {
        id: "arm",
        parent: "root",
        component: "SpringArm",
        props: {
          targetArmLength: 4.5,
          socketOffset: [0, 1, 0],
          targetOffset: [0, 0.5, 0],
          enableCameraLag: true,
          cameraLagSpeed: 12,
          doCollisionTest: false,
        },
      },
    ],
  });
  const entity = actorInstanceToEntity(def, { classRef: "Boom.actor.json", position: [0, 0, 0] }, 0);
  assert.deepEqual(readSpringArmComponent(entity), {
    targetArmLength: 4.5,
    socketOffset: [0, 1, 0],
    targetOffset: [0, 0.5, 0],
    enableCameraLag: true,
    cameraLagSpeed: 12,
    doCollisionTest: false,
  });

  const bare = normalizeActorScriptDef({
    name: "Boom2",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "arm", parent: "root", component: "SpringArm", props: {} },
    ],
  });
  const bareEntity = actorInstanceToEntity(bare, { classRef: "Boom2.actor.json", position: [0, 0, 0] }, 0);
  assert.deepEqual(readSpringArmComponent(bareEntity), {
    targetArmLength: 3,
    socketOffset: [0, 0, 0],
    targetOffset: [0, 0, 0],
    enableCameraLag: false,
    cameraLagSpeed: 10,
    doCollisionTest: true, // absent means on (Unreal default)
  });
});

check("normalizeActorScriptDef keeps SpringArm + Camera component nodes (survive save)", () => {
  const def = normalizeActorScriptDef({
    name: "Player",
    parentClass: "character",
    components: [
      { id: "root", component: "Transform", props: {} },
      { id: "boom", parent: "root", component: "SpringArm", props: { targetArmLength: 3 } },
      { id: "cam", parent: "boom", component: "Camera", props: { fieldOfView: 50 } },
    ],
  });
  const kinds = def.components.map((node) => node.component);
  assert.ok(kinds.includes("SpringArm"));
  assert.ok(kinds.includes("Camera"));
  // The camera node hangs off the spring arm, mirroring the Unreal boom→camera chain.
  assert.equal(def.components.find((node) => node.component === "Camera")?.parent, "boom");
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
    sensor: true, // not an instance field â†’ dropped
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
    skyLightCapture: {
      intensity: 1.7,
      bogusNestedField: "dropped",
    },
    // Sun fields live on the directional light now; they must NOT round-trip here.
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
    skyLightCapture: {
      intensity: 1.7,
    },
  });
  // Out-of-range numbers reject the save, mirroring the light-actor validator.
  assert.throws(() => validateSkyAtmosphere({ rayleigh: 999 }));
  assert.throws(() => validateSkyAtmosphere({ mie: 5 }));
  assert.throws(() => validateSkyAtmosphere({ skyLightCapture: { intensity: 99 } }));
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

  // Pitched -90Â° about X aims the light straight down, so the sun is at the zenith.
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
    skyAtmosphere: { turbidity: 6, rayleigh: 2.5, skyLightCapture: { intensity: 1.25 } },
  }) as RoomLayout;
  assert.deepEqual(layout.skyAtmosphere, {
    turbidity: 6,
    rayleigh: 2.5,
    skyLightCapture: { intensity: 1.25 },
  });
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
  // speed 0 â†’ zero-length wind vector (fully static).
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

check("resolveReflection fills defaults and overrides per field", () => {
  assert.deepEqual(resolveReflection(null), REFLECTION_DEFAULTS);
  assert.deepEqual(resolveReflection(undefined), REFLECTION_DEFAULTS);
  const resolved = resolveReflection({ intensity: 2, name: "Sky IBL" });
  assert.equal(resolved.intensity, 2);
  assert.equal(resolved.name, "Sky IBL");
  // Unset fields fall back to defaults.
  assert.equal(resolved.source, REFLECTION_DEFAULTS.source);
  assert.equal(resolved.hidden, REFLECTION_DEFAULTS.hidden);
});

check("applyReflectionEnvironment hangs/clears the captured environment", () => {
  const texture = new Texture();
  const target = { texture } as unknown as import("three").WebGLRenderTarget;
  const scene = {
    environment: null,
    environmentIntensity: 1,
  } as unknown as import("three").Scene;

  applyReflectionEnvironment(scene, target, resolveReflection({ intensity: 1.5 }));
  assert.equal(scene.environment, texture);
  assert.equal(scene.environmentIntensity, 1.5);

  // A hidden reflection clears the environment.
  applyReflectionEnvironment(scene, target, resolveReflection({ hidden: true }));
  assert.equal(scene.environment, null);

  // A missing capture target clears too, even when visible.
  scene.environment = texture;
  applyReflectionEnvironment(scene, null, resolveReflection({}));
  assert.equal(scene.environment, null);
});

check("validateReflection allowlists fields and migrates through validateLayout", () => {
  // The legacy Reflection Environment validator remains for old save payloads.
  assert.deepEqual(validateReflection({}), {});
  assert.equal(validateReflection(undefined), null);

  const reflection = validateReflection({
    name: "Sky Light",
    hidden: true,
    source: "sky",
    intensity: 2.5,
    bogusField: "dropped",
  });
  assert.deepEqual(reflection, {
    name: "Sky Light",
    hidden: true,
    source: "sky",
    intensity: 2.5,
  });
  // Unknown source rejects; out-of-range intensity rejects the save.
  assert.throws(() => validateReflection({ source: "scene" }));
  assert.throws(() => validateReflection({ intensity: 99 }));

  const layout = validateLayout({
    schema: 1,
    name: "WithReflection",
    loadGroups: [],
    instances: [],
    characters: [],
    skyAtmosphere: {},
    reflection: { intensity: 1.5 },
  }) as RoomLayout;
  assert.deepEqual(layout.skyAtmosphere, { skyLightCapture: { intensity: 1.5 } });
  assert.equal("reflection" in layout, false);
  assert.deepEqual(validateLayout(layout), layout);
});


check("resolveReflectionPlane fills defaults and overrides per field", () => {
  assert.deepEqual(resolveReflectionPlane(null), REFLECTION_PLANE_DEFAULTS);
  const resolved = resolveReflectionPlane({
    id: "rp",
    position: [0, 0, 0],
    color: "#102030",
    resolution: 1024,
  });
  assert.equal(resolved.color, "#102030");
  assert.equal(resolved.resolution, 1024);
  // Unset fields fall back to defaults.
  assert.equal(resolved.name, REFLECTION_PLANE_DEFAULTS.name);
  assert.equal(resolved.hidden, REFLECTION_PLANE_DEFAULTS.hidden);
});

check("uniqueReflectionPlaneId/Name avoid collisions", () => {
  const planes = [{ id: "reflection-plane-1", name: "Reflection Plane", position: [0, 0, 0] }];
  assert.equal(uniqueReflectionPlaneId(planes), "reflection-plane-2");
  assert.equal(uniqueReflectionPlaneName("Reflection Plane", planes), "Reflection Plane 2");
});

check("createReflectionPlaneObject builds a reflector with the transform + tint", () => {
  const item = {
    name: "Mirror",
    hidden: false,
    color: "#abcdef",
    resolution: 256,
    position: [1, 2, 3] as [number, number, number],
    rotation: [-90, 0, 0] as [number, number, number],
    scale: [4, 4, 1] as [number, number, number],
  };
  const reflector = createReflectionPlaneObject(item);
  assert.equal(reflector.name, "Mirror");
  assert.equal(reflector.position.x, 1);
  assert.equal(reflector.visible, true);
  // Hidden hides the reflector via the shared transform path.
  applyReflectionPlaneTransform(reflector, { ...item, hidden: true });
  assert.equal(reflector.visible, false);
});

check("validateReflectionPlane allowlists fields and round-trips through validateLayout", () => {
  const plane = validateReflectionPlane({
    id: "rp1",
    position: [1, 2, 3],
    name: "Water",
    color: "#102030",
    resolution: 1024,
    rotation: [-90, 0, 0],
    scale: [4, 4, 1],
    bogusField: "dropped",
  });
  assert.deepEqual(plane, {
    id: "rp1",
    position: [1, 2, 3],
    name: "Water",
    rotation: [-90, 0, 0],
    scale: [4, 4, 1],
    color: "#102030",
    resolution: 1024,
  });
  // A missing id rejects; out-of-range resolution rejects the save.
  assert.throws(() => validateReflectionPlane({ position: [0, 0, 0] }));
  assert.throws(() => validateReflectionPlane({ id: "x", position: [0, 0, 0], resolution: 9999 }));

  const layout = validateLayout({
    schema: 1,
    name: "WithMirror",
    loadGroups: [],
    instances: [],
    characters: [],
    reflectionPlanes: [{ id: "rp1", position: [0, 0, 0] }],
  }) as RoomLayout;
  assert.deepEqual(layout.reflectionPlanes, [{ id: "rp1", position: [0, 0, 0] }]);
  assert.deepEqual(validateLayout(layout), layout);
});

check("resolveReflectiveSurface fills defaults and overrides per field", () => {
  assert.deepEqual(resolveReflectiveSurface(null), REFLECTIVE_SURFACE_DEFAULTS);
  const resolved = resolveReflectiveSurface({
    id: "rs",
    position: [0, 0, 0],
    material: "M_Asphalt",
    reflectionStrength: 0.4,
    fresnelPower: 6,
    fresnelBias: 0.1,
    distortion: 0.2,
    tint: "#101010",
    resolution: 1024,
  });
  assert.equal(resolved.material, "M_Asphalt");
  assert.equal(resolved.reflectionStrength, 0.4);
  assert.equal(resolved.fresnelPower, 6);
  assert.equal(resolved.distortion, 0.2);
  assert.equal(resolved.resolution, 1024);
  // Unset fields fall back to defaults.
  assert.equal(resolved.name, REFLECTIVE_SURFACE_DEFAULTS.name);
  assert.equal(resolved.fresnelBias, 0.1);
});

check("uniqueReflectiveSurfaceId/Name avoid collisions", () => {
  const surfaces = [
    { id: "reflective-surface-1", name: "Reflective Surface", position: [0, 0, 0] as [number, number, number] },
  ];
  assert.equal(uniqueReflectiveSurfaceId(surfaces), "reflective-surface-2");
  assert.equal(uniqueReflectiveSurfaceName("Reflective Surface", surfaces), "Reflective Surface 2");
});

check("createReflectiveSurfaceObject builds a textured plane with the transform", () => {
  const item = {
    ...REFLECTIVE_SURFACE_DEFAULTS,
    position: [1, 2, 3] as [number, number, number],
    rotation: [-90, 0, 0] as [number, number, number],
    scale: [4, 4, 1] as [number, number, number],
  };
  const surface = createReflectiveSurfaceObject(item, null);
  assert.equal(surface.name, REFLECTIVE_SURFACE_DEFAULTS.name);
  assert.equal(surface.position.x, 1);
  assert.equal(surface.visible, true);
  // Hidden hides the surface via the shared transform path.
  applyReflectiveSurfaceTransform(surface, { ...item, hidden: true });
  assert.equal(surface.visible, false);
});

check("validateReflectiveSurface allowlists fields and round-trips through validateLayout", () => {
  const surface = validateReflectiveSurface({
    id: "rs1",
    position: [1, 2, 3],
    name: "Wet Road",
    material: "M_Asphalt",
    reflectionStrength: 0.4,
    fresnelPower: 6,
    fresnelBias: 0.1,
    distortion: 0.2,
    tint: "#101010",
    resolution: 1024,
    rotation: [-90, 0, 0],
    scale: [4, 4, 1],
    bogusField: "dropped",
  });
  assert.deepEqual(surface, {
    id: "rs1",
    position: [1, 2, 3],
    name: "Wet Road",
    rotation: [-90, 0, 0],
    scale: [4, 4, 1],
    material: "M_Asphalt",
    reflectionStrength: 0.4,
    fresnelPower: 6,
    fresnelBias: 0.1,
    distortion: 0.2,
    tint: "#101010",
    resolution: 1024,
  });
  // A missing id rejects; out-of-range strength rejects the save.
  assert.throws(() => validateReflectiveSurface({ position: [0, 0, 0] }));
  assert.throws(() =>
    validateReflectiveSurface({ id: "x", position: [0, 0, 0], reflectionStrength: 5 }),
  );

  const layout = validateLayout({
    schema: 1,
    name: "WithSurface",
    loadGroups: [],
    instances: [],
    characters: [],
    reflectiveSurfaces: [{ id: "rs1", position: [0, 0, 0] }],
  }) as RoomLayout;
  assert.deepEqual(layout.reflectiveSurfaces, [{ id: "rs1", position: [0, 0, 0] }]);
  assert.deepEqual(validateLayout(layout), layout);
});

check("resolveSphereReflectionCapture fills defaults and overrides per field", () => {
  assert.deepEqual(resolveSphereReflectionCapture(null), SPHERE_REFLECTION_CAPTURE_DEFAULTS);
  assert.deepEqual(resolveSphereReflectionCapture(undefined), SPHERE_REFLECTION_CAPTURE_DEFAULTS);
  const resolved = resolveSphereReflectionCapture({
    id: "rc",
    position: [0, 0, 0],
    radius: 8,
    intensity: 1.5,
    resolution: 512,
    priority: 3,
  });
  assert.equal(resolved.radius, 8);
  assert.equal(resolved.intensity, 1.5);
  assert.equal(resolved.resolution, 512);
  assert.equal(resolved.priority, 3);
  // Unset fields fall back to defaults.
  assert.equal(resolved.near, SPHERE_REFLECTION_CAPTURE_DEFAULTS.near);
  assert.equal(resolved.far, SPHERE_REFLECTION_CAPTURE_DEFAULTS.far);
  assert.equal(resolved.parallax, SPHERE_REFLECTION_CAPTURE_DEFAULTS.parallax);
  assert.equal(resolved.name, SPHERE_REFLECTION_CAPTURE_DEFAULTS.name);
});

check("uniqueSphereReflectionCaptureId/Name avoid collisions", () => {
  const captures = [
    { id: "reflection-capture-1", name: "Sphere Reflection Capture", position: [0, 0, 0] as const },
  ];
  assert.equal(uniqueSphereReflectionCaptureId(captures), "reflection-capture-2");
  assert.equal(
    uniqueSphereReflectionCaptureName("Sphere Reflection Capture", captures),
    "Sphere Reflection Capture 2",
  );
});

check("createSphereReflectionCaptureObject builds a helper scaled by radius", () => {
  const item = {
    name: "Probe",
    hidden: false,
    radius: 5,
    intensity: 1,
    resolution: 256,
    near: 0.1,
    far: 100,
    parallax: false,
    priority: 0,
    position: [1, 2, 3] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
  };
  const helper = createSphereReflectionCaptureObject(item);
  assert.equal(helper.name, "Probe");
  assert.equal(helper.position.x, 1);
  // Radius maps to a uniform scale on the unit sphere.
  assert.equal(helper.scale.x, 5);
  assert.equal(helper.visible, true);
  // Hidden hides the helper and a radius change re-scales it via the shared path.
  applySphereReflectionCaptureTransform(helper, { ...item, hidden: true, radius: 9 });
  assert.equal(helper.visible, false);
  assert.equal(helper.scale.x, 9);
});

check("selectNearestReflectionCapture scores by distance/radius and gates on radius", () => {
  // No probes / out of every radius â†’ null (global environment fallback).
  assert.equal(selectNearestReflectionCapture([0, 0, 0], []), null);
  assert.equal(
    selectNearestReflectionCapture([100, 0, 0], [{ position: [0, 0, 0], radius: 5, priority: 0 }]),
    null,
  );
  // A single covering probe wins; the boundary (score === 1) still counts.
  assert.equal(
    selectNearestReflectionCapture([3, 0, 0], [{ position: [0, 0, 0], radius: 5, priority: 0 }]),
    0,
  );
  assert.equal(
    selectNearestReflectionCapture([5, 0, 0], [{ position: [0, 0, 0], radius: 5, priority: 0 }]),
    0,
  );
  // Lowest score wins: the point is closer (relative to radius) to probe 1.
  assert.equal(
    selectNearestReflectionCapture([4, 0, 0], [
      { position: [0, 0, 0], radius: 5, priority: 0 },
      { position: [5, 0, 0], radius: 5, priority: 0 },
    ]),
    1,
  );
  // Radius <= 0 probes are ignored.
  assert.equal(
    selectNearestReflectionCapture([0, 0, 0], [{ position: [0, 0, 0], radius: 0, priority: 0 }]),
    null,
  );
});

check("selectNearestReflectionCapture tie-breaks by priority, then radius, then order", () => {
  const point: [number, number, number] = [0, 0, 0];
  // Equal score (both at distance 0) â†’ higher priority wins.
  assert.equal(
    selectNearestReflectionCapture(point, [
      { position: [0, 0, 0], radius: 5, priority: 0 },
      { position: [0, 0, 0], radius: 5, priority: 2 },
    ]),
    1,
  );
  // Equal score + priority â†’ smaller radius wins (more local).
  assert.equal(
    selectNearestReflectionCapture(point, [
      { position: [0, 0, 0], radius: 8, priority: 1 },
      { position: [0, 0, 0], radius: 4, priority: 1 },
    ]),
    1,
  );
  // Equal score + priority + radius â†’ earliest layout order wins.
  assert.equal(
    selectNearestReflectionCapture(point, [
      { position: [0, 0, 0], radius: 5, priority: 1 },
      { position: [0, 0, 0], radius: 5, priority: 1 },
    ]),
    0,
  );
});

check("selectNearestReflectionCapture: smaller probe overrides a larger one (priority first)", () => {
  // A small local probe wins over a larger, more-centered one (Unreal-style
  // small-refines-large): point sits dead-center of the big r10 probe (score 0)
  // yet still inside the small r4 probe (score 0.75) â€” the small one wins.
  assert.equal(
    selectNearestReflectionCapture([3, 0, 0], [
      { position: [3, 0, 0], radius: 10, priority: 0 },
      { position: [0, 0, 0], radius: 4, priority: 0 },
    ]),
    1,
  );
  // Explicit priority outranks the small-probe rule: the larger high-priority
  // probe wins even though a smaller probe also covers the point.
  assert.equal(
    selectNearestReflectionCapture([0, 0, 0], [
      { position: [0, 0, 0], radius: 2, priority: 0 },
      { position: [0, 0, 0], radius: 10, priority: 3 },
    ]),
    1,
  );
  // A probe that does NOT cover the point never wins, however small it is.
  assert.equal(
    selectNearestReflectionCapture([6, 0, 0], [
      { position: [0, 0, 0], radius: 8, priority: 0 },
      { position: [0, 0, 0], radius: 1, priority: 0 },
    ]),
    0,
  );
});

check("disposeSphereReflectionCaptureBake frees the cached PMREM target", () => {
  // The bake itself needs a live WebGL renderer (so it is exercised in the editor,
  // like captureSkyEnvironment), but the dispose lifecycle is pure and testable.
  let disposed = 0;
  const bake = {
    target: {
      dispose() {
        disposed += 1;
      },
    },
    position: [0, 0, 0] as [number, number, number],
    radius: 5,
    intensity: 1,
    priority: 0,
    resolution: 256,
  } as unknown as SphereReflectionCaptureBake;
  disposeSphereReflectionCaptureBake(bake);
  assert.equal(disposed, 1);
});

check("assignProbeEnvMapMaterial clones standard mats; parallax patches the shader", () => {
  const fakeTexture = { isTexture: true } as unknown;
  const makeBake = (
    parallax: boolean,
    position: [number, number, number],
  ): SphereReflectionCaptureBake =>
    ({
      target: { texture: fakeTexture },
      position,
      radius: 4,
      intensity: 1.5,
      priority: 0,
      resolution: 256,
      parallax,
    }) as unknown as SphereReflectionCaptureBake;

  // MeshBasicMaterial is not a probe-env material â€” returned as-is, never tracked.
  const basic = new MeshBasicMaterial();
  const basicTracked: Material[] = [];
  assert.equal(assignProbeEnvMapMaterial(basic, makeBake(true, [0, 0, 0]), basicTracked), basic);
  assert.equal(basicTracked.length, 0);

  const base = new MeshStandardMaterial();

  // Parallax off: a clone with the probe envMap + intensity and the stock program key.
  const plainTracked: Material[] = [];
  const plain = assignProbeEnvMapMaterial(
    base,
    makeBake(false, [0, 0, 0]),
    plainTracked,
  ) as MeshStandardMaterial;
  assert.notEqual(plain, base);
  assert.equal(plain.envMap, fakeTexture);
  assert.equal(plain.envMapIntensity, 1.5);
  // No parallax patch â†’ same program cache key as an untouched standard material.
  assert.equal(plain.customProgramCacheKey(), base.customProgramCacheKey());
  assert.deepEqual(plainTracked, [plain]);

  // Parallax on: a distinct, stable program key shared across probes; each clone's
  // onBeforeCompile injects its own probe position/radius and rewrites both stages.
  const tracked: Material[] = [];
  const a = assignProbeEnvMapMaterial(base, makeBake(true, [2, 0, 0]), tracked) as MeshStandardMaterial;
  const b = assignProbeEnvMapMaterial(base, makeBake(true, [-5, 1, 0]), tracked) as MeshStandardMaterial;
  assert.notEqual(a.customProgramCacheKey(), plain.customProgramCacheKey());
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey());

  // three.js hands onBeforeCompile the sources with `#include <...>` directives
  // still UNEXPANDED, so the stub mirrors that â€” the patch must anchor on the raw
  // includes (not on text that only exists after three resolves them).
  const runPatch = (material: MeshStandardMaterial) => {
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "void main() {\n\t#include <worldpos_vertex>\n}",
      fragmentShader: "#include <envmap_physical_pars_fragment>\nvoid main() {}",
    };
    material.onBeforeCompile(shader as never, null as never);
    return shader;
  };

  const shaderA = runPatch(a);
  assert.equal((shaderA.uniforms.captureProbePosition?.value as { x: number }).x, 2);
  assert.equal(shaderA.uniforms.captureProbeRadius?.value, 4);
  assert.ok(shaderA.vertexShader.includes("vCaptureWorldPos = worldPosition.xyz;"));
  assert.ok(shaderA.fragmentShader.includes("uniform vec3 captureProbePosition;"));
  // The IBL include is expanded inline (no leftover directive) and carries the
  // re-aimed reflection lookup.
  assert.ok(!shaderA.fragmentShader.includes("#include <envmap_physical_pars_fragment>"));
  assert.ok(shaderA.fragmentShader.includes("getIBLRadiance"));
  assert.ok(
    shaderA.fragmentShader.includes(
      "reflectVec = normalize( vCaptureWorldPos + reflectVec * captureDist - captureProbePosition )",
    ),
  );
  // Parallax-only (no global env to fall back to): diffuse irradiance still comes
  // from the probe envMap â€” the specular-only redirect is gated on blend.
  assert.ok(
    shaderA.fragmentShader.includes(
      "vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );",
    ),
  );

  const shaderB = runPatch(b);
  assert.equal((shaderB.uniforms.captureProbePosition?.value as { x: number }).x, -5);

  const globalEnv = new Texture();
  const blended = assignProbeEnvMapMaterial(
    base,
    makeBake(false, [0, 0, 0]),
    [],
    globalEnv,
    2.75,
  ) as MeshStandardMaterial;
  const blendShader = runPatch(blended);
  assert.equal(blendShader.uniforms.captureGlobalEnv?.value, globalEnv);
  assert.equal(blendShader.uniforms.captureGlobalEnvIntensity?.value, 2.75);
  assert.ok(blendShader.fragmentShader.includes("uniform float captureGlobalEnvIntensity;"));
  assert.ok(
    blendShader.fragmentShader.includes(
      "captureGlobalColor.rgb *= captureGlobalEnvIntensity / max( envMapIntensity, 0.0001 );",
    ),
  );
  // Specular-only: with a global env present the probe's diffuse irradiance is
  // redirected to the sky env (sampled along the world normal), so getIBLIrradiance
  // no longer floods the surface with the probe's bake.
  assert.ok(
    blendShader.fragmentShader.includes(
      "vec4 envMapColor = textureCubeUV( captureGlobalEnv, envMapRotation * worldNormal, 1.0 );",
    ),
  );
  assert.ok(
    !blendShader.fragmentShader.includes(
      "vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );",
    ),
  );

  // The patch degrades gracefully (no-op) when the three.js shader anchors are gone.
  const noAnchors = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: "x",
    fragmentShader: "y",
  };
  a.onBeforeCompile(noAnchors as never, null as never);
  assert.equal(noAnchors.vertexShader, "x");
  assert.equal(Object.keys(noAnchors.uniforms).length, 0);
});

check("assignProbeEnvMapMaterial chains a base layer-blend patch with the capture patch", () => {
  const fakeTexture = { isTexture: true } as unknown;
  const makeBake = (parallax: boolean): SphereReflectionCaptureBake =>
    ({
      target: { texture: fakeTexture },
      position: [0, 0, 0],
      radius: 4,
      intensity: 1,
      priority: 0,
      resolution: 256,
      parallax,
    }) as unknown as SphereReflectionCaptureBake;

  const makeLayerBlendMaterial = () =>
    createThreeMaterialFromForgeDef(
      normalizeForgeMaterialDef({
        schema: 1,
        type: "material",
        materialType: "standard",
        name: "Blend Base",
        baseColorTexture: "rock-d",
        layerBlend: {
          layer1: { baseColor: "#ffffff", baseColorTexture: "snow-d" },
          driver: "slope",
        },
      }),
      { baseColorTexture: new Texture(), layer1BaseColorTexture: new Texture() },
      { maxAnisotropy: 8 },
    ) as MeshStandardMaterial;

  // A stub carrying BOTH the layer-blend anchors and the capture anchors, exactly as
  // three.js hands them to onBeforeCompile (unexpanded `#include` directives).
  const runComposed = (material: MeshStandardMaterial) => {
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\nvoid main(){\n#include <worldpos_vertex>\n}",
      fragmentShader:
        "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n" +
        "#include <metalnessmap_fragment>\n#include <alphamap_fragment>\n" +
        "#include <emissivemap_fragment>\n#include <aomap_fragment>\n" +
        "#include <normal_fragment_maps>\n#include <envmap_physical_pars_fragment>\nvoid main(){}",
    };
    material.onBeforeCompile(shader as never, null as never);
    return shader;
  };

  const tracked: Material[] = [];
  const composed = assignProbeEnvMapMaterial(
    makeLayerBlendMaterial(),
    makeBake(true),
    tracked,
  ) as MeshStandardMaterial;
  assert.deepEqual(tracked, [composed]);
  const shader = runComposed(composed);
  // Layer blend survived the probe clone...
  assert.match(shader.fragmentShader, /forgeLayerBlendFactor/);
  assert.match(shader.vertexShader, /vForgeLayerWorldPosition/);
  assert.ok("forgeLayerMap" in shader.uniforms);
  // ...and the capture patch is layered on top.
  assert.ok(shader.fragmentShader.includes("uniform vec3 captureProbePosition;"));
  assert.ok(shader.vertexShader.includes("vCaptureWorldPos = worldPosition.xyz;"));
  assert.ok("captureProbePosition" in shader.uniforms);
  // The clone must keep the base material's `defines`: MeshStandardMaterial.copy() resets
  // them to `{ STANDARD }`, which would compile out every #ifdef-gated layer sample (mask,
  // layer maps) and silently kill a texture-driven blend inside a probe.
  assert.equal(composed.defines?.STANDARD, "");
  assert.equal(composed.defines?.FORGE_LAYER_BLEND, "");
  assert.equal(composed.defines?.USE_FORGE_LAYER_MAP, "");
  // The cache key carries both feature sets so composed programs never collide with
  // either a plain capture clone or a non-captured layer-blend material.
  const key = composed.customProgramCacheKey();
  assert.match(key, /forge-layer-blend-v1/);
  assert.match(key, /forge-reflection-capture/);

  // Even when the capture itself is a no-op (no parallax, no global env), the base
  // layer-blend patch must still survive the clone.
  const preserved = assignProbeEnvMapMaterial(
    makeLayerBlendMaterial(),
    makeBake(false),
    [],
  ) as MeshStandardMaterial;
  const preservedShader = runComposed(preserved);
  assert.match(preservedShader.fragmentShader, /forgeLayerBlendFactor/);
  assert.match(preserved.customProgramCacheKey(), /forge-layer-blend-v1/);
  assert.ok(!preserved.customProgramCacheKey().includes("forge-reflection-capture"));
});

check("isReflectionCaptureBakeStale flags moved / near-far edits; tint follows", () => {
  const item: SphereReflectionCaptureRenderItem = {
    ...resolveSphereReflectionCapture(null),
    position: [1, 2, 3],
    rotation: [0, 0, 0],
  };
  const bake = {
    target: { texture: {} },
    position: [1, 2, 3] as [number, number, number],
    radius: 5,
    intensity: 1,
    priority: 0,
    resolution: 256,
    parallax: false,
    near: item.near,
    far: item.far,
  } as unknown as SphereReflectionCaptureBake;

  // Matching position + near + far â†’ fresh.
  assert.equal(isReflectionCaptureBakeStale(bake, item), false);
  // Probe moved since the bake â†’ stale.
  assert.equal(isReflectionCaptureBakeStale(bake, { ...item, position: [1, 2, 3.5] }), true);
  // near / far edited since the bake â†’ stale.
  assert.equal(isReflectionCaptureBakeStale(bake, { ...item, near: item.near + 1 }), true);
  assert.equal(isReflectionCaptureBakeStale(bake, { ...item, far: item.far + 1 }), true);
  // Radius / intensity / priority are live-patched, never stale.
  assert.equal(isReflectionCaptureBakeStale(bake, { ...item, radius: 99, intensity: 9, priority: 9 }), false);

  // The tint setter swaps the helper wireframe color between fresh and warning.
  const helper = createSphereReflectionCaptureObject(item);
  const fresh = helper.material.color.getHex();
  setSphereReflectionCaptureStale(helper, true);
  const stale = helper.material.color.getHex();
  assert.notEqual(stale, fresh);
  setSphereReflectionCaptureStale(helper, false);
  assert.equal(helper.material.color.getHex(), fresh);
});

check("validateSphereReflectionCapture allowlists fields and round-trips through validateLayout", () => {
  const capture = validateSphereReflectionCapture({
    id: "rc1",
    position: [1, 2, 3],
    name: "Probe",
    rotation: [0, 45, 0],
    radius: 8,
    intensity: 1.5,
    resolution: 512,
    near: 0.5,
    far: 80,
    parallax: true,
    priority: 2,
    bogusField: "dropped",
  });
  assert.deepEqual(capture, {
    id: "rc1",
    position: [1, 2, 3],
    name: "Probe",
    rotation: [0, 45, 0],
    radius: 8,
    intensity: 1.5,
    resolution: 512,
    near: 0.5,
    far: 80,
    parallax: true,
    priority: 2,
  });
  // A missing id rejects; out-of-range radius rejects the save.
  assert.throws(() => validateSphereReflectionCapture({ position: [0, 0, 0] }));
  assert.throws(() =>
    validateSphereReflectionCapture({ id: "x", position: [0, 0, 0], radius: 9999 }),
  );

  const layout = validateLayout({
    schema: 1,
    name: "WithCapture",
    loadGroups: [],
    instances: [],
    characters: [],
    reflectionCaptures: [{ id: "rc1", position: [0, 0, 0] }],
  }) as RoomLayout;
  assert.deepEqual(layout.reflectionCaptures, [{ id: "rc1", position: [0, 0, 0] }]);
  assert.deepEqual(validateLayout(layout), layout);
});

check("resolvePostProcess fills defaults and overrides per field", () => {
  assert.deepEqual(resolvePostProcess(null), POST_PROCESS_DEFAULTS);
  assert.deepEqual(resolvePostProcess(undefined), POST_PROCESS_DEFAULTS);
  const resolved = resolvePostProcess({ exposure: 1.5, toneMapping: "neutral" });
  assert.equal(resolved.exposure, 1.5);
  assert.equal(resolved.toneMapping, "neutral");
  assert.equal(resolved.bloom.enabled, POST_PROCESS_DEFAULTS.bloom.enabled);
  assert.equal(resolved.vignette.intensity, POST_PROCESS_DEFAULTS.vignette.intensity);
  assert.equal(resolved.antialias, POST_PROCESS_DEFAULTS.antialias);
  assert.equal(resolved.name, POST_PROCESS_DEFAULTS.name);
  assert.equal(resolved.hidden, POST_PROCESS_DEFAULTS.hidden);

  const effects = resolvePostProcess({
    antialias: "smaa",
    bloom: { enabled: true, intensity: 1.2 },
    vignette: { enabled: true, offset: 0.8 },
    chromaticAberration: { enabled: true, amount: 0.4 },
    grain: { enabled: true, intensity: 0.7 },
    dof: { enabled: true, focusDistance: 25, aperture: 1.5 },
    ao: { enabled: true, radius: 1.5 },
    saturation: 1.25,
    contrast: 0.9,
    temperature: 0.3,
    tint: -0.2,
  });
  assert.equal(effects.antialias, "smaa");
  assert.equal(effects.bloom.enabled, true);
  assert.equal(effects.bloom.intensity, 1.2);
  assert.equal(effects.bloom.threshold, POST_PROCESS_DEFAULTS.bloom.threshold);
  assert.equal(effects.vignette.enabled, true);
  assert.equal(effects.vignette.offset, 0.8);
  assert.equal(effects.chromaticAberration.enabled, true);
  assert.equal(effects.chromaticAberration.amount, 0.4);
  assert.equal(effects.grain.enabled, true);
  assert.equal(effects.grain.intensity, 0.7);
  assert.equal(effects.dof.enabled, true);
  assert.equal(effects.dof.focusDistance, 25);
  assert.equal(effects.dof.aperture, 1.5);
  assert.equal(effects.dof.maxBlur, POST_PROCESS_DEFAULTS.dof.maxBlur);
  assert.equal(effects.ao.enabled, true);
  assert.equal(effects.ao.radius, 1.5);
  assert.equal(effects.ao.intensity, POST_PROCESS_DEFAULTS.ao.intensity);
  assert.equal(effects.saturation, 1.25);
  assert.equal(effects.contrast, 0.9);
  assert.equal(effects.temperature, 0.3);
  assert.equal(effects.tint, -0.2);
});

check("applyPostProcessToneMapping maps tonemapper enum and ignores hidden/null", () => {
  const renderer = {
    toneMapping: NoToneMapping,
    toneMappingExposure: 1,
  } as unknown as import("three").WebGLRenderer;

  applyPostProcessToneMapping(renderer, resolvePostProcess({ toneMapping: "aces", exposure: 1.25 }));
  assert.equal(renderer.toneMapping, ACESFilmicToneMapping);
  assert.equal(renderer.toneMappingExposure, 0.25);

  applyPostProcessToneMapping(renderer, resolvePostProcess({ toneMapping: "neutral", exposure: 0.8 }));
  assert.equal(renderer.toneMapping, NeutralToneMapping);
  assert.equal(renderer.toneMappingExposure, 0.16000000000000003);

  applyPostProcessToneMapping(renderer, resolvePostProcess({ toneMapping: "none", exposure: 2 }));
  assert.equal(renderer.toneMapping, NoToneMapping);
  assert.equal(renderer.toneMappingExposure, 0.4);

  applyPostProcessToneMapping(renderer, resolvePostProcess({ hidden: true, exposure: 3 }));
  assert.equal(renderer.toneMapping, NoToneMapping);
  assert.equal(renderer.toneMappingExposure, 0.4);
  applyPostProcessToneMapping(renderer, null);
  assert.equal(renderer.toneMappingExposure, 0.4);
});

check("sky local exposure temporarily overrides renderer exposure for its draw call", () => {
  const sky = createSkyObject();
  const renderer = { toneMappingExposure: 1.7 } as import("three").WebGLRenderer;

  setSkyLocalToneMappingExposure(sky, 0.35);
  sky.onBeforeRender(renderer, null!, null!, null!, null!, null!);
  assert.equal(renderer.toneMappingExposure, 0.35);
  sky.onAfterRender(renderer, null!, null!, null!, null!, null!);
  assert.equal(renderer.toneMappingExposure, 1.7);

  setSkyLocalToneMappingExposure(sky, null);
  sky.onBeforeRender(renderer, null!, null!, null!, null!, null!);
  assert.equal(renderer.toneMappingExposure, 1.7);

  sky.geometry.dispose();
  sky.material.dispose();
});

check("post process tone mapping can override scene exposure after sky", () => {
  const renderer = {
    toneMapping: NoToneMapping,
    toneMappingExposure: 1,
  } as unknown as import("three").WebGLRenderer;

  applySkyToneMapping(renderer, {
    name: "Sky",
    hidden: false,
    rayleigh: 2,
    turbidity: 10,
    mie: 0.005,
    mieDirectionalG: 0.8,
    exposure: 0.4,
    skyLightCapture: { intensity: 1 },
  });
  assert.equal(renderer.toneMapping, ACESFilmicToneMapping);
  assert.equal(renderer.toneMappingExposure, 0.08000000000000002);

  applyPostProcessToneMapping(renderer, resolvePostProcess({ toneMapping: "neutral", exposure: 1.7 }));
  assert.equal(renderer.toneMapping, NeutralToneMapping);
  assert.equal(renderer.toneMappingExposure, 0.34);

  applySkyToneMapping(renderer, {
    name: "Sky",
    hidden: false,
    rayleigh: 2,
    turbidity: 10,
    mie: 0.005,
    mieDirectionalG: 0.8,
    exposure: 0.6,
    skyLightCapture: { intensity: 1 },
  });
  applyPostProcessToneMapping(renderer, null);
  assert.equal(renderer.toneMapping, ACESFilmicToneMapping);
  assert.equal(renderer.toneMappingExposure, 0.12);
});

check("authored exposure 1 maps to the previous 0.2 renderer exposure", () => {
  assert.equal(postProcessToneMappingExposure(1), 0.2);
  assert.equal(skyAtmosphereToneMappingExposure(1), 0.2);
  assert.equal(postProcessToneMappingExposure(1) * skyAtmosphereToneMappingExposure(1), 0.04000000000000001);
});

check("hasPostProcessEffectPasses tracks enabled pass effects only", () => {
  assert.equal(hasPostProcessEffectPasses(null), false);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({})), false);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ hidden: true, bloom: { enabled: true } })), false);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ bloom: { enabled: true } })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ vignette: { enabled: true } })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ saturation: 1.1 })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ contrast: 0.9 })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ chromaticAberration: { enabled: true } })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ grain: { enabled: true } })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ dof: { enabled: true } })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ ao: { enabled: true } })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ antialias: "smaa" })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ temperature: 0.5 })), true);
  assert.equal(hasPostProcessEffectPasses(resolvePostProcess({ tint: -0.5 })), true);
  // Disabled DoF/CA/grain plus neutral white balance leave the chain empty.
  assert.equal(
    hasPostProcessEffectPasses(resolvePostProcess({ dof: { focusDistance: 30 }, temperature: 0 })),
    false,
  );
});

class TrackedPass extends Pass {
  disposed = 0;
  lastSize: [number, number] | null = null;

  constructor(readonly label: string) {
    super();
  }

  override setSize(width: number, height: number): void {
    this.lastSize = [width, height];
  }

  override dispose(): void {
    this.disposed += 1;
  }
}

function postProcessPipelinePassLabels(pipeline: PostProcessPipeline): string[] {
  const composer = (pipeline as unknown as { composer: { passes: Pass[] } }).composer;
  return composer.passes.map((pass) =>
    pass instanceof TrackedPass ? pass.label : pass.constructor.name,
  );
}

function createPostProcessPipelineForTest(): PostProcessPipeline {
  const renderer = {
    getPixelRatio: () => 1,
    getSize: (target: Vector2) => target.set(320, 180),
  } as unknown as import("three").WebGLRenderer;
  return new PostProcessPipeline({
    renderer,
    scene: new Scene(),
    camera: new PerspectiveCamera(60, 1, 0.1, 100),
    width: 320,
    height: 180,
  });
}

check("createPostProcessEffectPasses follows enabled-set ordering", () => {
  const context = {
    scene: new Scene(),
    camera: new PerspectiveCamera(60, 1, 0.1, 100),
    width: 320,
    height: 180,
  };
  assert.deepEqual(createPostProcessEffectPasses(null, context), []);
  assert.deepEqual(createPostProcessEffectPasses(resolvePostProcess({ hidden: true, bloom: { enabled: true } }), context), []);
  assert.deepEqual(createPostProcessEffectPasses(resolvePostProcess({}), context), []);

  const passes = createPostProcessEffectPasses(
    resolvePostProcess({
      ao: { enabled: true },
      dof: { enabled: true },
      bloom: { enabled: true },
      saturation: 1.1,
      chromaticAberration: { enabled: true },
      vignette: { enabled: true },
      grain: { enabled: true },
    }),
    context,
  );
  assert.deepEqual(
    passes.map((pass) => pass.constructor.name.replace(/^_/, "")),
    [
      "ForgeGtaoPass",
      "BokehPass",
      "UnrealBloomPass",
      "ShaderPass",
      "ShaderPass",
      "ShaderPass",
      "FilmPass",
    ],
  );
  passes.forEach((pass) => pass.dispose());
});

check("createPostProcessAntialiasPass creates SMAA only when enabled", () => {
  assert.equal(createPostProcessAntialiasPass(null, { width: 320, height: 180 }), null);
  assert.equal(
    createPostProcessAntialiasPass(resolvePostProcess({ hidden: true, antialias: "smaa" }), {
      width: 320,
      height: 180,
    }),
    null,
  );
  assert.equal(
    createPostProcessAntialiasPass(resolvePostProcess({ antialias: "none" }), {
      width: 320,
      height: 180,
    }),
    null,
  );

  const previousImage = (globalThis as unknown as { Image?: typeof Image }).Image;
  class TestImage {
    onload: (() => void) | null = null;
    set src(_value: string) {
      this.onload?.();
    }
  }
  (globalThis as unknown as { Image?: typeof Image }).Image = TestImage as unknown as typeof Image;
  try {
    const pass = createPostProcessAntialiasPass(resolvePostProcess({ antialias: "smaa" }), {
      width: 320,
      height: 180,
    });
    assert.equal(pass?.constructor.name, "SMAAPass");
    pass?.dispose();
  } finally {
    (globalThis as unknown as { Image?: typeof Image }).Image = previousImage;
  }
});

check("PostProcessPipeline keeps effect, outline, SMAA, output order and lifecycles", () => {
  const pipeline = createPostProcessPipelineForTest();
  assert.deepEqual(postProcessPipelinePassLabels(pipeline), ["RenderPass", "OutputPass"]);

  const outline = new TrackedPass("outline");
  pipeline.addPassBeforeOutput(outline);
  assert.deepEqual(postProcessPipelinePassLabels(pipeline), ["RenderPass", "outline", "OutputPass"]);

  const bloom = new TrackedPass("bloom");
  const vignette = new TrackedPass("vignette");
  pipeline.setEffectPasses([bloom, vignette]);
  assert.deepEqual(postProcessPipelinePassLabels(pipeline), [
    "RenderPass",
    "bloom",
    "vignette",
    "outline",
    "OutputPass",
  ]);

  const smaa = new TrackedPass("smaa");
  pipeline.setAntialiasPass(smaa);
  assert.deepEqual(postProcessPipelinePassLabels(pipeline), [
    "RenderPass",
    "bloom",
    "vignette",
    "outline",
    "smaa",
    "OutputPass",
  ]);

  const grain = new TrackedPass("grain");
  pipeline.setEffectPasses([grain]);
  assert.equal(bloom.disposed, 1);
  assert.equal(vignette.disposed, 1);
  assert.deepEqual(postProcessPipelinePassLabels(pipeline), [
    "RenderPass",
    "grain",
    "outline",
    "smaa",
    "OutputPass",
  ]);

  pipeline.setAntialiasPass(null);
  assert.equal(smaa.disposed, 1);
  assert.deepEqual(postProcessPipelinePassLabels(pipeline), [
    "RenderPass",
    "grain",
    "outline",
    "OutputPass",
  ]);

  pipeline.setSize(640, 360);
  assert.deepEqual(grain.lastSize, [640, 360]);
  assert.deepEqual(outline.lastSize, [640, 360]);

  pipeline.dispose();
  assert.equal(grain.disposed, 1);
  assert.equal(outline.disposed, 1);
  assert.equal(bloom.disposed, 1);
  assert.equal(vignette.disposed, 1);
});

check("validatePostProcess allowlists fields and round-trips through validateLayout", () => {
  assert.deepEqual(validatePostProcess({}), {});
  assert.deepEqual(validatePostProcess({ antialias: "none" }), {});
  assert.equal(validatePostProcess(undefined), null);

  const post = validatePostProcess({
    name: "Cinematic",
    hidden: true,
    exposure: 1.35,
    toneMapping: "neutral",
    antialias: "smaa",
    bloom: { enabled: true, threshold: 0.7, intensity: 1.1, radius: 0.3 },
    vignette: { enabled: true, intensity: 0.45, offset: 0.9 },
    chromaticAberration: { enabled: true, amount: 0.6 },
    grain: { enabled: true, intensity: 0.4 },
    dof: { enabled: true, focusDistance: 20, aperture: 1.2, maxBlur: 0.8 },
    ao: { enabled: true, radius: 1.5, intensity: 0.75 },
    saturation: 1.2,
    contrast: 0.85,
    temperature: 0.25,
    tint: -0.15,
    bogusField: "dropped",
  });
  assert.deepEqual(post, {
    name: "Cinematic",
    hidden: true,
    exposure: 1.35,
    toneMapping: "neutral",
    antialias: "smaa",
    bloom: { enabled: true, threshold: 0.7, intensity: 1.1, radius: 0.3 },
    vignette: { enabled: true, intensity: 0.45, offset: 0.9 },
    chromaticAberration: { enabled: true, amount: 0.6 },
    grain: { enabled: true, intensity: 0.4 },
    dof: { enabled: true, focusDistance: 20, aperture: 1.2, maxBlur: 0.8 },
    ao: { enabled: true, radius: 1.5, intensity: 0.75 },
    saturation: 1.2,
    contrast: 0.85,
    temperature: 0.25,
    tint: -0.15,
  });
  assert.throws(() => validatePostProcess({ exposure: 99 }));
  assert.throws(() => validatePostProcess({ toneMapping: "filmic" }));
  assert.throws(() => validatePostProcess({ antialias: "fxaa" }));
  assert.throws(() => validatePostProcess({ bloom: { enabled: "yes" } }));
  assert.throws(() => validatePostProcess({ vignette: { intensity: 99 } }));
  assert.throws(() => validatePostProcess({ chromaticAberration: { amount: 99 } }));
  assert.throws(() => validatePostProcess({ grain: { intensity: 99 } }));
  assert.throws(() => validatePostProcess({ dof: { focusDistance: 999 } }));
  assert.throws(() => validatePostProcess({ dof: { enabled: "yes" } }));
  assert.throws(() => validatePostProcess({ ao: { radius: 99 } }));
  assert.throws(() => validatePostProcess({ ao: { enabled: "yes" } }));
  assert.throws(() => validatePostProcess({ temperature: 5 }));
  assert.throws(() => validatePostProcess({ tint: -5 }));

  const layout = validateLayout({
    schema: 1,
    name: "WithPost",
    loadGroups: [],
    instances: [],
    characters: [],
    postProcess: {
      exposure: 1.2,
      toneMapping: "none",
      antialias: "smaa",
      bloom: { enabled: true, intensity: 0.6 },
      dof: { enabled: true, focusDistance: 15 },
      ao: { enabled: true, radius: 2 },
      saturation: 1.1,
      temperature: 0.2,
    },
  }) as RoomLayout;
  assert.deepEqual(layout.postProcess, {
    exposure: 1.2,
    toneMapping: "none",
    antialias: "smaa",
    bloom: { enabled: true, intensity: 0.6 },
    dof: { enabled: true, focusDistance: 15 },
    ao: { enabled: true, radius: 2 },
    saturation: 1.1,
    temperature: 0.2,
  });
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

  const soundCue = buildImportedAssetRecord("assets/sounds/SC_Footstep.soundcue.json", 120, []);
  assert.equal(soundCue?.assetType, "soundCue");
  assert.equal(soundCue?.category, "sounds");
  assert.equal(soundCue?.placeable, false);

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

check("imported GLTF content with skins or animations registers as skeletal mesh", () => {
  const animatedGltf = JSON.stringify({ asset: { version: "2.0" }, animations: [{}] });
  assert.equal(
    inferImportedAssetTypeFromContent("assets/characters/Hero.gltf", animatedGltf),
    "skeletalMesh",
  );

  const skinnedGlb = minimalGlbJson({ asset: { version: "2.0" }, skins: [{}] });
  const type = inferImportedAssetTypeFromContent("assets/characters/Hero.glb", skinnedGlb);
  assert.equal(type, "skeletalMesh");
  assert.equal(
    buildImportedAssetRecord("assets/characters/Hero.glb", skinnedGlb.byteLength, [], type)
      ?.assetType,
    "skeletalMesh",
  );

  const staticGltf = JSON.stringify({ asset: { version: "2.0" }, meshes: [{}] });
  assert.equal(
    inferImportedAssetTypeFromContent("assets/models/Crate.gltf", staticGltf),
    "staticMesh",
  );
});

// --- UI Widget (UMG Lite): schema normalization + render-tree builder ---

check("normalizeUiWidgetDef upgrades the legacy empty-root stub to a Canvas", () => {
  const def = normalizeUiWidgetDef({ schema: 1, type: "ui", name: "Menu", root: {} });
  assert.equal(def.type, "ui");
  assert.equal(def.name, "Menu");
  assert.equal(def.root.widget, "Canvas");
  assert.deepEqual(def.root.children, []);
  assert.deepEqual(def.preview, { width: 1280, height: 720 });
});

check("normalizeUiWidgetDef coerces garbage into a valid Canvas-rooted def", () => {
  const def = normalizeUiWidgetDef(null, "Fallback");
  assert.equal(def.name, "Fallback");
  assert.equal(def.root.widget, "Canvas");
});

check("normalizeUiWidgetDef maps unknown kinds to Panel and drops leaf children", () => {
  const def = normalizeUiWidgetDef({
    name: "X",
    root: {
      id: "root",
      widget: "Canvas",
      children: [
        { id: "weird", widget: "Hologram", children: [{ widget: "Text" }] },
        { id: "label", widget: "Text", props: { text: "hi" }, children: [{ widget: "Text" }] },
      ],
    },
  });
  const weird = def.root.children[0]!;
  const label = def.root.children[1]!;
  assert.equal(weird.widget, "Panel"); // unknown -> safe container, keeps its child
  assert.equal(weird.children.length, 1);
  assert.equal(label.widget, "Text"); // leaf drops authored children
  assert.equal(label.children.length, 0);
});

check("normalizeUiWidgetDef mints unique ids and dedupes collisions", () => {
  const def = normalizeUiWidgetDef({
    name: "X",
    root: {
      id: "dup",
      widget: "Stack",
      children: [{ id: "dup", widget: "Text" }, { widget: "Text" }],
    },
  });
  const ids: string[] = [];
  const walk = (node: UiNode): void => {
    ids.push(node.id);
    node.children.forEach(walk);
  };
  walk(def.root);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
});

check("defaultUiWidgetDef is a minimal empty Canvas asset", () => {
  const def = defaultUiWidgetDef("HUD");
  assert.equal(def.schema, 1);
  assert.equal(def.type, "ui");
  assert.equal(def.name, "HUD");
  assert.equal(def.root.id, "root");
  assert.equal(def.root.widget, "Canvas");
  assert.equal(UI_WIDGET_KINDS.includes(def.root.widget), true);
});

check("readUiAction parses message + back actions and rejects malformed ones", () => {
  const def = normalizeUiWidgetDef({
    name: "X",
    root: {
      widget: "Canvas",
      children: [
        { id: "ok", widget: "Button", props: { onClick: { type: "message", message: "Go" } } },
        { id: "back", widget: "Button", props: { onClick: { type: "back" } } },
        { id: "bad", widget: "Button", props: { onClick: { type: "nope" } } },
      ],
    },
  });
  assert.deepEqual(readUiAction(def.root.children[0]!), { type: "message", message: "Go" });
  assert.deepEqual(readUiAction(def.root.children[1]!), { type: "back" });
  assert.equal(readUiAction(def.root.children[2]!), null);
});

check("readUiBindingPath extracts a binding path but not a literal", () => {
  const def = normalizeUiWidgetDef({
    name: "X",
    root: {
      widget: "Canvas",
      children: [
        { id: "hp", widget: "ProgressBar", props: { value: { bind: "player.health" }, max: 100 } },
      ],
    },
  });
  const bar = def.root.children[0]!;
  assert.equal(readUiBindingPath(bar, "value"), "player.health");
  assert.equal(readUiBindingPath(bar, "max"), undefined); // literal, not a binding
});

check("buildUiRenderTree maps the menu widget set to tags/classes/actions", () => {
  const def = normalizeUiWidgetDef({
    name: "Menu",
    root: {
      id: "root",
      widget: "Canvas",
      props: { align: "center", justify: "center" },
      children: [
        { id: "title", widget: "Text", props: { text: "Forge" } },
        {
          id: "start",
          widget: "Button",
          props: { text: "Start", onClick: { type: "message", message: "Go" } },
        },
      ],
    },
  });
  const tree = buildUiRenderTree(def);
  assert.equal(tree.tag, "div");
  assert.match(tree.className, /forge-ui-canvas/);
  assert.equal(tree.style["align-items"], "center");
  assert.equal(tree.style["justify-content"], "center");
  const title = tree.children[0]!;
  const start = tree.children[1]!;
  assert.equal(title.tag, "div");
  assert.match(title.className, /forge-ui-text/);
  assert.equal(title.text, "Forge");
  assert.equal(start.tag, "button");
  assert.match(start.className, /ui-interactive/);
  assert.equal(start.text, "Start");
  assert.deepEqual(start.action, { type: "message", message: "Go" });
});

check("resolveInlineStyle allowlists tokens (px, flex aliases, passthrough)", () => {
  const def = normalizeUiWidgetDef({
    name: "X",
    root: {
      widget: "Stack",
      props: { gap: 16, padding: 8, align: "between", background: "#101010", grow: 1 },
    },
  });
  const style = resolveInlineStyle(def.root);
  assert.equal(style["gap"], "16px");
  assert.equal(style["padding"], "8px");
  assert.equal(style["align-items"], "space-between");
  assert.equal(style["background"], "#101010");
  assert.equal(style["flex-grow"], "1");
});

check("ProgressBar renders a clamped inline-width fill child", () => {
  const def = normalizeUiWidgetDef({
    name: "X",
    root: {
      widget: "Canvas",
      children: [
        { id: "a", widget: "ProgressBar", props: { value: 30, max: 100 } },
        { id: "b", widget: "ProgressBar", props: { value: 999, max: 100 } },
      ],
    },
  });
  const tree = buildUiRenderTree(def);
  const a = tree.children[0]!;
  const b = tree.children[1]!;
  assert.equal(a.children.length, 1);
  assert.equal(a.children[0]!.synthetic, true);
  assert.equal(a.children[0]!.style["width"], "30.00%");
  assert.equal(b.children[0]!.style["width"], "100.00%"); // clamped to max
});

check("Stack direction sets the modifier class; default is column", () => {
  const row = buildUiRenderNode(
    normalizeUiWidgetDef({ name: "X", root: { widget: "Stack", props: { direction: "row" } } }).root,
  );
  const col = buildUiRenderNode(
    normalizeUiWidgetDef({ name: "X", root: { widget: "Stack" } }).root,
  );
  assert.match(row.className, /forge-ui-stack--row/);
  assert.match(col.className, /forge-ui-stack--column/);
});

check("createUiNode seeds default props per kind; containers start empty", () => {
  assert.deepEqual(createUiNode("Text", "t1"), { id: "t1", widget: "Text", props: { text: "Text" }, children: [] });
  assert.deepEqual(createUiNode("ProgressBar", "p1").props, { value: 50, max: 100 });
  assert.deepEqual(createUiNode("Stack", "s1").props, { direction: "column", gap: 8 });
  assert.deepEqual(createUiNode("Panel", "c1").props, {});
});

check("findUiNode + findUiNodeParent walk the widget tree", () => {
  const def = normalizeUiWidgetDef({
    name: "X",
    root: {
      id: "root",
      widget: "Canvas",
      children: [
        { id: "stack", widget: "Stack", children: [{ id: "label", widget: "Text" }] },
      ],
    },
  });
  assert.equal(findUiNode(def.root, "label")?.widget, "Text");
  assert.equal(findUiNode(def.root, "missing"), null);
  assert.equal(findUiNodeParent(def.root, "label")?.id, "stack");
  assert.equal(findUiNodeParent(def.root, "stack")?.id, "root");
  assert.equal(findUiNodeParent(def.root, "root"), null);
});

check("validateSaveUiPayload requires a .ui.json path and normalizes the body", () => {
  const payload = validateSaveUiPayload({
    path: "assets/ui/Main.ui.json",
    ui: { name: "Main", root: {} },
  });
  assert.equal(payload.path, "assets/ui/Main.ui.json");
  assert.equal((payload.ui as { type: string }).type, "ui");
  assert.equal((payload.ui as { root: { widget: string } }).root.widget, "Canvas");
  assert.throws(() => validateSaveUiPayload({ path: "assets/ui/Main.json", ui: {} }));
  assert.throws(() => validateSaveUiPayload({ path: "../secret.ui.json", ui: {} }));
});

check("UiViewModelStore notifies only changed fields and dedups unchanged writes", () => {
  const store = new UiViewModelStore();
  let health = 0;
  let gold = 0;
  store.subscribe("player.health", () => { health += 1; });
  store.subscribe("player.gold", () => { gold += 1; });
  store.setField("player.health", 100);
  store.setField("player.gold", 5);
  store.flush();
  assert.equal(health, 1);
  assert.equal(gold, 1);
  assert.equal(store.getField("player.health"), 100);
  store.setField("player.health", 100); // unchanged -> not dirty
  store.flush();
  assert.equal(health, 1);
});

check("UiViewModelStore fires a multi-path listener once per flush (batched)", () => {
  const store = new UiViewModelStore();
  let calls = 0;
  const apply = (): void => { calls += 1; };
  store.subscribe("a", apply);
  store.subscribe("b", apply);
  store.setField("a", 1);
  store.setField("b", 2);
  store.flush();
  assert.equal(calls, 1);
});

check("UiViewModelStore unsubscribe stops notifications", () => {
  const store = new UiViewModelStore();
  let calls = 0;
  const off = store.subscribe("x", () => { calls += 1; });
  store.setField("x", 1);
  store.flush();
  off();
  store.setField("x", 2);
  store.flush();
  assert.equal(calls, 1);
});

check("collectUiBindings + resolveUiBoundValue resolve bound vs static props", () => {
  const def = normalizeUiWidgetDef({
    name: "HUD",
    root: {
      widget: "Canvas",
      children: [
        { id: "bar", widget: "ProgressBar", props: { value: { bind: "player.hp" }, max: 100 } },
        { id: "label", widget: "Text", props: { text: { bind: "player.hpLabel" } } },
        { id: "plain", widget: "Text", props: { text: "Static" } },
      ],
    },
  });
  const bindings = collectUiBindings(def);
  assert.equal(bindings.length, 2); // bar + label (plain has no binding)
  const bar = findUiNode(def.root, "bar")!;
  const store = new UiViewModelStore();
  store.setField("player.hp", 42);
  assert.equal(resolveUiBoundValue(bar, "value", store), 42); // bound -> store field
  assert.equal(resolveUiBoundValue(bar, "max", store), 100); // static literal kept
  assert.equal(resolveUiBoundValue(bar, "value", new UiViewModelStore()), undefined);
});

check("normalizeUiThemeDef keeps scalar tokens and drops the rest", () => {
  const theme = normalizeUiThemeDef({
    name: "T",
    tokens: { "color.text": "#fff", "radius.lg": 12, bad: { x: 1 }, nan: Number.NaN },
  });
  assert.equal(theme.type, "uiTheme");
  assert.equal(theme.tokens["color.text"], "#fff");
  assert.equal(theme.tokens["radius.lg"], 12);
  assert.equal("bad" in theme.tokens, false);
  assert.equal("nan" in theme.tokens, false);
});

check("themeToCssVariables maps tokens to --forge-ui vars (px for numbers)", () => {
  const vars = themeToCssVariables(
    normalizeUiThemeDef({ name: "T", tokens: { "color.surface": "#101010", "space.md": 12 } }),
  );
  assert.equal(vars["--forge-ui-color-surface"], "#101010");
  assert.equal(vars["--forge-ui-space-md"], "12px");
  assert.equal(tokenToCssVar("radius.lg"), "--forge-ui-radius-lg");
});

check("resolveInlineStyle resolves $token refs to CSS variables", () => {
  const def = normalizeUiWidgetDef({
    name: "X",
    root: {
      widget: "Stack",
      props: { background: "$color.surface", padding: "$space.lg", gap: 8 },
    },
  });
  const style = resolveInlineStyle(def.root);
  assert.equal(style["background"], "var(--forge-ui-color-surface)");
  assert.equal(style["padding"], "var(--forge-ui-space-lg)"); // token wins over px
  assert.equal(style["gap"], "8px"); // literal still px
});

check("Include node normalizes to a valid UiNode (not a container)", () => {
  const node = createUiNode("Include", "inc1");
  assert.equal(node.widget, "Include");
  assert.equal(node.props.src, "");
  assert.deepEqual(node.children, []);
});

check("buildUiRenderNode renders Include placeholder when resolveWidget is absent", () => {
  const def = normalizeUiWidgetDef({
    name: "Test",
    root: {
      id: "root",
      widget: "Canvas",
      children: [{ id: "inc", widget: "Include", props: { src: "some-widget" }, children: [] }],
    },
  });
  const tree = buildUiRenderTree(def);
  const incNode = tree.children[0];
  assert.ok(incNode, "Include child should exist");
  assert.equal(incNode.widget, "Include");
  assert.equal(incNode.text, "[some-widget]");
  assert.equal(incNode.children.length, 0);
});

check("buildUiRenderNode inlines referenced widget when resolveWidget returns a def", () => {
  const buttonDef = normalizeUiWidgetDef({
    name: "Button",
    root: { id: "btn-root", widget: "Button", props: { text: "Click" }, children: [] },
  });
  const parentDef = normalizeUiWidgetDef({
    name: "Parent",
    root: {
      id: "root",
      widget: "Canvas",
      children: [{ id: "inc", widget: "Include", props: { src: "my-button" }, children: [] }],
    },
  });
  const tree = buildUiRenderTree(parentDef, { resolveWidget: (src) => src === "my-button" ? buttonDef : null });
  const wrapper = tree.children[0];
  assert.ok(wrapper, "Include wrapper should exist");
  assert.equal(wrapper.widget, "Include");
  assert.equal(wrapper.style["display"], "contents");
  assert.equal(wrapper.children.length, 1);
  assert.equal(wrapper.children[0].widget, "Button");
  assert.equal(wrapper.children[0].text, "Click");
});

check("buildUiRenderNode guards against Include cycles (depth limit)", () => {
  let callCount = 0;
  const cyclicResolver = (): ReturnType<typeof normalizeUiWidgetDef> => {
    callCount += 1;
    return normalizeUiWidgetDef({
      name: "Cyclic",
      root: { id: "self", widget: "Include", props: { src: "self" }, children: [] },
    });
  };
  const def = normalizeUiWidgetDef({
    name: "Root",
    root: { id: "root", widget: "Include", props: { src: "self" }, children: [] },
  });
  // Should not throw or recurse infinitely; stops at MAX_INCLUDE_DEPTH (5)
  const tree = buildUiRenderTree(def, { resolveWidget: cyclicResolver });
  assert.ok(callCount <= 6, `resolver called ${callCount} times (expected ≤ 6)`);
  assert.ok(tree, "tree should be non-null after depth-limited recursion");
});

check("UiViewModelStore.snapshot returns path-sorted [path, value] pairs", () => {
  const store = new UiViewModelStore();
  store.setField("player.speed", 2.5);
  store.setField("inventory.gold", 10);
  store.setField("player.healthLabel", "100/100");
  assert.deepEqual(store.snapshot(), [
    ["inventory.gold", 10],
    ["player.healthLabel", "100/100"],
    ["player.speed", 2.5],
  ]);
});

check("formatUiDebug renders the HUD, screen stack, locale and bound fields", () => {
  const lines = formatUiDebug({
    hud: "Hud",
    screens: ["Menu", "Options"],
    locale: "tr",
    fields: [
      ["player.speed", 2.5],
      ["player.speedLabel", "Speed 2.5 m/s"],
    ],
    audit: [],
    world: { count: 2, visible: 1 },
  });
  assert.deepEqual(lines, [
    "ui",
    "hud: Hud",
    "screens(2): Menu > Options",
    "locale: tr",
    "world: 1/2",
    "fields(2):",
    '  player.speed = 2.5',
    '  player.speedLabel = "Speed 2.5 m/s"',
  ]);
});

check("formatUiDebug shows placeholders when nothing is mounted", () => {
  const lines = formatUiDebug({
    hud: null,
    screens: [],
    locale: null,
    fields: [],
    audit: [],
    world: { count: 0, visible: 0 },
  });
  assert.deepEqual(lines, [
    "ui",
    "hud: none",
    "screens: none",
    "locale: none",
    "world: 0/0",
    "fields: none",
  ]);
});

check("formatUiDebug clips long string values", () => {
  const long = "x".repeat(40);
  const lines = formatUiDebug({
    hud: null,
    screens: [],
    locale: null,
    fields: [["msg", long]],
    audit: [],
    world: { count: 0, visible: 0 },
  });
  assert.equal(lines.at(-1), `  msg = "${"x".repeat(29)}..."`);
});

check("formatUiDebug lists accessibility audit findings", () => {
  const lines = formatUiDebug({
    hud: null,
    screens: ["Menu"],
    locale: null,
    fields: [],
    audit: ['Menu: Button "go" — Button has no text or label'],
    world: { count: 0, visible: 0 },
  });
  assert.deepEqual(lines.slice(-2), [
    "a11y(1):",
    '  Menu: Button "go" — Button has no text or label',
  ]);
});

check("normalizeUiTransition: shorthand string expands to enter+exit", () => {
  assert.deepEqual(normalizeUiTransition("fade"), {
    enter: "fade",
    exit: "fade",
    durationMs: 160,
  });
});

check("normalizeUiTransition: object form keeps valid presets, clamps duration", () => {
  assert.deepEqual(normalizeUiTransition({ enter: "slide-up", exit: "scale", durationMs: 9999 }), {
    enter: "slide-up",
    exit: "scale",
    durationMs: 2000,
  });
});

check("normalizeUiTransition: invalid preset falls back to none on that end", () => {
  assert.deepEqual(normalizeUiTransition({ enter: "spin", exit: "fade", durationMs: 100 }), {
    enter: "none",
    exit: "fade",
    durationMs: 100,
  });
});

check("normalizeUiTransition: both ends none (or junk) → null (no-op)", () => {
  assert.equal(normalizeUiTransition({ enter: "none", exit: "none" }), null);
  assert.equal(normalizeUiTransition("none"), null);
  assert.equal(normalizeUiTransition(undefined), null);
  assert.equal(normalizeUiTransition(42), null);
});

check("transitionClasses: preset maps to base + offset, none/reduced → null", () => {
  assert.deepEqual(transitionClasses("slide-left"), {
    base: UI_TRANSITION_BASE_CLASS,
    offset: `${UI_TRANSITION_BASE_CLASS}-slide-left`,
  });
  assert.equal(transitionClasses("none"), null);
  assert.equal(transitionClasses("fade", true), null); // reduced motion
});

check("normalizeUiWidgetDef carries a valid transition and drops a no-op one", () => {
  const withTx = normalizeUiWidgetDef({
    name: "T",
    transition: { enter: "fade", exit: "fade", durationMs: 200 },
    root: { id: "root", widget: "Canvas", children: [] },
  });
  assert.deepEqual(withTx.transition, { enter: "fade", exit: "fade", durationMs: 200 });
  const noTx = normalizeUiWidgetDef({
    name: "T",
    transition: { enter: "none", exit: "none" },
    root: { id: "root", widget: "Canvas", children: [] },
  });
  assert.equal(noTx.transition, undefined);
});

check("normalizeUiLocaleTable keeps string entries and drops the rest", () => {
  const table = normalizeUiLocaleTable({
    locale: "tr",
    strings: { "menu.title": "Duraklatıldı", bad: 12, nested: { a: 1 }, ok: "Tamam" },
  });
  assert.equal(table.type, "uiLoc");
  assert.equal(table.locale, "tr");
  assert.equal(table.strings["menu.title"], "Duraklatıldı");
  assert.equal(table.strings.ok, "Tamam");
  assert.equal("bad" in table.strings, false);
  assert.equal("nested" in table.strings, false);
  // Garbage / missing locale falls back to the default "en".
  assert.equal(normalizeUiLocaleTable(null).locale, "en");
});

check("applyLocParams substitutes {name} and leaves unknown placeholders intact", () => {
  assert.equal(applyLocParams("build {version}", { version: "0.1" }), "build 0.1");
  assert.equal(applyLocParams("hi {name}", {}), "hi {name}"); // unknown param kept
  assert.equal(applyLocParams("plain text"), "plain text"); // no params
});

check("LocaleRegistry.resolve uses the active locale, params, and key fallback", () => {
  const registry = new LocaleRegistry();
  registry.register(normalizeUiLocaleTable({ locale: "en", strings: { "menu.resume": "Resume" } }));
  registry.register(normalizeUiLocaleTable({ locale: "tr", strings: { "menu.resume": "Devam Et" } }));
  assert.equal(registry.activeLocale, "en"); // first registered is active
  assert.equal(registry.resolve("menu.resume"), "Resume");
  registry.setActiveLocale("tr");
  assert.equal(registry.resolve("menu.resume"), "Devam Et");
  // Missing key falls back to the key itself (or a supplied default).
  assert.equal(registry.resolve("menu.missing"), "menu.missing");
  assert.equal(registry.resolve("menu.missing", undefined, "—"), "—");
  // Unknown locale is ignored (keeps the current one, never blanks).
  registry.setActiveLocale("fr");
  assert.equal(registry.activeLocale, "tr");
});

check("LocaleRegistry notifies subscribers only on a real locale change", () => {
  const registry = new LocaleRegistry();
  registry.register(normalizeUiLocaleTable({ locale: "en", strings: {} }));
  registry.register(normalizeUiLocaleTable({ locale: "tr", strings: {} }));
  let calls = 0;
  const off = registry.subscribe(() => {
    calls += 1;
  });
  registry.setActiveLocale("en"); // already active -> no notify
  registry.setActiveLocale("tr"); // change -> notify
  registry.setActiveLocale("zz"); // unknown -> no notify
  off();
  registry.setActiveLocale("en"); // unsubscribed -> not counted
  assert.equal(calls, 1);
});

check("readUiTextKey reads a localized text prop and sanitizes params", () => {
  const def = normalizeUiWidgetDef({
    name: "M",
    root: {
      widget: "Canvas",
      children: [
        { id: "t", widget: "Text", props: { text: { key: "menu.build", params: { version: 1, junk: { x: 1 } } } } },
        { id: "lit", widget: "Text", props: { text: "Static" } },
        { id: "bound", widget: "Text", props: { text: { bind: "player.label" } } },
      ],
    },
  });
  const textKey = readUiTextKey(findUiNode(def.root, "t")!, "text");
  assert.equal(textKey?.key, "menu.build");
  assert.deepEqual(textKey?.params, { version: "1" }); // number coerced, object dropped
  assert.equal(readUiTextKey(findUiNode(def.root, "lit")!, "text"), undefined);
  assert.equal(readUiTextKey(findUiNode(def.root, "bound")!, "text"), undefined);
});

check("buildUiRenderTree resolves localized text via resolveLoc (key fallback)", () => {
  const def = normalizeUiWidgetDef({
    name: "M",
    root: {
      widget: "Canvas",
      children: [
        { id: "t", widget: "Text", props: { text: { key: "menu.build", params: { version: "0.1" } } } },
        { id: "b", widget: "Button", props: { text: { key: "menu.resume" } } },
      ],
    },
  });
  const registry = new LocaleRegistry();
  registry.register(
    normalizeUiLocaleTable({
      locale: "en",
      strings: { "menu.build": "Build {version}", "menu.resume": "Resume" },
    }),
  );
  const tree = buildUiRenderTree(def, { resolveLoc: (key, params) => registry.resolve(key, params) });
  const text = tree.children[0];
  const button = tree.children[1];
  assert.equal(text.text, "Build 0.1");
  assert.equal(button.text, "Resume");
  // Without a resolver the raw key is shown (editor preview without a table).
  assert.equal(buildUiRenderTree(def).children[0].text, "menu.build");
});

check("collectUiLocBindings finds only Text/Button nodes with localized text", () => {
  const def = normalizeUiWidgetDef({
    name: "M",
    root: {
      widget: "Canvas",
      children: [
        { id: "t", widget: "Text", props: { text: { key: "a" } } },
        { id: "b", widget: "Button", props: { text: { key: "b" } } },
        { id: "lit", widget: "Text", props: { text: "Static" } },
        { id: "bar", widget: "ProgressBar", props: { value: { bind: "x" } } },
      ],
    },
  });
  const locNodes = collectUiLocBindings(def);
  assert.equal(locNodes.length, 2);
  assert.deepEqual(
    locNodes.map((entry) => entry.node.id).sort(),
    ["b", "t"],
  );
});

// --- U7c accessibility -----------------------------------------------------

check("normalizeUiA11y keeps valid fields and drops empty/garbage", () => {
  assert.deepEqual(normalizeUiA11y({ label: "Go", role: "button", focusable: true }), {
    label: "Go",
    role: "button",
    focusable: true,
  });
  assert.deepEqual(normalizeUiA11y({ focusable: false }), { focusable: false });
  // Empty strings + wrong types are dropped; an all-empty object → undefined.
  assert.equal(normalizeUiA11y({ label: "", role: 5 }), undefined);
  assert.equal(normalizeUiA11y(null), undefined);
});

check("normalizeUiWidgetDef round-trips node a11y + initialFocus, dropping no-ops", () => {
  const def = normalizeUiWidgetDef({
    name: "M",
    initialFocus: "go",
    root: {
      id: "root",
      widget: "Canvas",
      children: [
        { id: "img", widget: "Image", a11y: { label: "Logo" } },
        { id: "go", widget: "Button", a11y: { focusable: false }, props: { text: "Go" } },
        { id: "plain", widget: "Text", a11y: { label: "" }, props: { text: "x" } },
      ],
    },
  });
  assert.equal(def.initialFocus, "go");
  assert.deepEqual(findUiNode(def.root, "img")!.a11y, { label: "Logo" });
  assert.deepEqual(findUiNode(def.root, "go")!.a11y, { focusable: false });
  // An a11y that normalizes to nothing leaves the node without the field.
  assert.equal(findUiNode(def.root, "plain")!.a11y, undefined);
  // initialFocus pointing at nothing useful is dropped (empty string).
  assert.equal(normalizeUiWidgetDef({ name: "M", initialFocus: "", root: {} }).initialFocus, undefined);
});

check("resolveUiA11yAttrs maps widget kinds + a11y overrides to ARIA", () => {
  const def = normalizeUiWidgetDef({
    name: "M",
    root: {
      id: "root",
      widget: "Canvas",
      children: [
        { id: "bar", widget: "ProgressBar", props: { value: 30, max: 60 } },
        { id: "img", widget: "Image", a11y: { label: "Logo" } },
        { id: "btn", widget: "Button", a11y: { label: "Start", focusable: false }, props: { text: "x" } },
        { id: "box", widget: "Panel", a11y: { focusable: true, role: "menu" } },
      ],
    },
  });
  assert.deepEqual(resolveUiA11yAttrs(findUiNode(def.root, "bar")!), {
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "60",
    "aria-valuenow": "30",
  });
  assert.deepEqual(resolveUiA11yAttrs(findUiNode(def.root, "img")!), {
    role: "img",
    "aria-label": "Logo",
  });
  // Button: native focus, label override, focusable:false → tabindex -1.
  assert.deepEqual(resolveUiA11yAttrs(findUiNode(def.root, "btn")!), {
    "aria-label": "Start",
    tabindex: "-1",
  });
  // Focusable non-Button gets tabindex 0 + the role override.
  assert.deepEqual(resolveUiA11yAttrs(findUiNode(def.root, "box")!), {
    role: "menu",
    tabindex: "0",
  });
});

check("collectFocusables + isUiNodeFocusable follow the focusable rules", () => {
  const def = normalizeUiWidgetDef({
    name: "M",
    root: {
      id: "root",
      widget: "Canvas",
      children: [
        { id: "a", widget: "Button", props: { text: "A" } },
        { id: "b", widget: "Button", a11y: { focusable: false }, props: { text: "B" } },
        { id: "c", widget: "Panel", a11y: { focusable: true } },
        { id: "d", widget: "Text", props: { text: "D" } },
      ],
    },
  });
  assert.deepEqual(collectFocusables(def.root), ["a", "c"]);
  assert.equal(isUiNodeFocusable(findUiNode(def.root, "a")!), true);
  assert.equal(isUiNodeFocusable(findUiNode(def.root, "b")!), false);
  assert.equal(isUiNodeFocusable(findUiNode(def.root, "d")!), false);
});

check("nextFocusIndex wraps both ways and seeds from an empty selection", () => {
  assert.equal(nextFocusIndex(0, 3, 1), 1);
  assert.equal(nextFocusIndex(2, 3, 1), 0); // wrap forward
  assert.equal(nextFocusIndex(0, 3, -1), 2); // wrap back
  assert.equal(nextFocusIndex(-1, 3, 1), 0); // none focused, forward → first
  assert.equal(nextFocusIndex(-1, 3, -1), 2); // none focused, back → last
  assert.equal(nextFocusIndex(0, 0, 1), -1); // nothing to focus
});

check("buildUiRenderTree attaches ARIA attrs to render nodes", () => {
  const def = normalizeUiWidgetDef({
    name: "M",
    root: {
      id: "root",
      widget: "Canvas",
      children: [{ id: "bar", widget: "ProgressBar", props: { value: 1, max: 4 } }],
    },
  });
  const tree = buildUiRenderTree(def);
  assert.equal(tree.children[0]!.attrs?.role, "progressbar");
  assert.equal(tree.children[0]!.attrs?.["aria-valuenow"], "1");
  // A bare container with no a11y carries no attrs.
  assert.equal(tree.attrs, undefined);
});

check("auditUiA11y flags nameless Button + Image, passes named ones", () => {
  const def = normalizeUiWidgetDef({
    name: "Menu",
    root: {
      id: "root",
      widget: "Canvas",
      children: [
        { id: "blank", widget: "Button", props: {} },
        { id: "named", widget: "Button", props: { text: "Go" } },
        { id: "keyed", widget: "Button", props: { text: { key: "menu.go" } } },
        { id: "logo", widget: "Image", props: {} },
        { id: "alt", widget: "Image", a11y: { label: "Logo" } },
      ],
    },
  });
  const issues = auditUiA11y(def);
  assert.deepEqual(
    issues.map((issue) => issue.nodeId).sort(),
    ["blank", "logo"],
  );
});

// --- U7d world-space widgets -----------------------------------------------

check("normalizeWorldWidget keeps valid fields, defaults the anchor, drops junk", () => {
  assert.deepEqual(
    normalizeWorldWidget({ widget: "label", anchor: { worldPos: [1, 2, 3] }, offset: [0, -8], maxDistance: 30 }),
    { widget: "label", anchor: { worldPos: [1, 2, 3] }, offset: [0, -8], maxDistance: 30 },
  );
  // Missing/garbage anchor → origin; bad offset/maxDistance dropped.
  assert.deepEqual(normalizeWorldWidget({ widget: "label", offset: [1], maxDistance: -5 }), {
    widget: "label",
    anchor: { worldPos: [0, 0, 0] },
  });
  // No widget id → unusable.
  assert.equal(normalizeWorldWidget({ anchor: { worldPos: [0, 0, 0] } }), null);
  assert.equal(normalizeWorldWidget(null), null);
});

check("normalizeWorldWidget reads an entity anchor + world offset", () => {
  assert.deepEqual(
    normalizeWorldWidget({ widget: "tag", anchor: { entityId: "actor:0", offset3d: [0, 1.5, 0] } }),
    { widget: "tag", anchor: { worldPos: [0, 0, 0], entityId: "actor:0", offset3d: [0, 1.5, 0] } },
  );
  // worldPos coexists as the fallback; an empty entityId is dropped.
  assert.deepEqual(
    normalizeWorldWidget({ widget: "tag", anchor: { worldPos: [1, 1, 1], entityId: "" } }),
    { widget: "tag", anchor: { worldPos: [1, 1, 1] } },
  );
});

check("normalizeWorldWidgets drops unusable entries", () => {
  const list = normalizeWorldWidgets([
    { widget: "a", anchor: { worldPos: [0, 1, 0] } },
    { anchor: { worldPos: [0, 0, 0] } },
    "junk",
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.widget, "a");
  assert.deepEqual(normalizeWorldWidgets("nope"), []);
});

check("resolveWorldWidgetVisibility fades + scales by distance", () => {
  // No maxDistance → never culled, perspective scale shrinks with distance.
  const near = resolveWorldWidgetVisibility(4);
  assert.equal(near.visible, true);
  assert.equal(near.opacity, 1);
  assert.equal(near.scale, 1.6); // 8/4 = 2, clamped to maxScale 1.6
  const far = resolveWorldWidgetVisibility(16);
  assert.equal(far.scale, 0.5); // 8/16
  // maxDistance: full opacity until the last 20% (fadeStart=80), then linear to 0.
  assert.equal(resolveWorldWidgetVisibility(50, { maxDistance: 100 }).opacity, 1);
  assert.equal(resolveWorldWidgetVisibility(80, { maxDistance: 100 }).opacity, 1);
  assert.equal(resolveWorldWidgetVisibility(90, { maxDistance: 100 }).opacity, 0.5);
  assert.equal(resolveWorldWidgetVisibility(95, { maxDistance: 100 }).opacity, 0.25);
  const culled = resolveWorldWidgetVisibility(100, { maxDistance: 100 });
  assert.equal(culled.visible, false);
  assert.equal(culled.opacity, 0);
});

check("ndcToScreen maps clip space to viewport pixels + front/back", () => {
  // Center of clip space → center of the viewport.
  assert.deepEqual(ndcToScreen(0, 0, 0.5, 800, 600), { x: 400, y: 300, inFront: true });
  // Top-right NDC (1, 1) → top-right pixel (y axis flips).
  assert.deepEqual(ndcToScreen(1, 1, 0, 800, 600), { x: 800, y: 0, inFront: true });
  // Bottom-left NDC (-1, -1) → bottom-left pixel.
  assert.deepEqual(ndcToScreen(-1, -1, 0, 800, 600), { x: 0, y: 600, inFront: true });
  // NDC z > 1 means behind the camera.
  assert.equal(ndcToScreen(0, 0, 1.2, 800, 600).inFront, false);
});

// --- Game Framework (rules layer) ---------------------------------------

check("normalizeGameRules returns null when there is nothing to drive", () => {
  assert.equal(normalizeGameRules(undefined), null);
  assert.equal(normalizeGameRules({}), null);
  assert.equal(normalizeGameRules({ variables: [], objectives: [] }), null);
  // A bare variable list is enough to activate the rules layer.
  assert.notEqual(normalizeGameRules({ variables: [{ id: "score", initial: 0 }] }), null);
});

check("normalizeGameRules clamps objectives and dedupes ids", () => {
  const config = normalizeGameRules({
    objectives: [
      { id: "coins", label: "Coins", target: 5, initial: 9 },
      { id: "coins", label: "dup", target: 99 },
      { id: "", target: 3 },
      { target: 3 },
    ],
  });
  assert.ok(config?.objectives);
  assert.equal(config.objectives.length, 1);
  const coins = config.objectives[0];
  assert.equal(coins.target, 5);
  assert.equal(coins.initial, 5); // initial clamped to target
  // objectives present ⇒ win-on-objectives defaults true
  assert.equal(config.winWhenObjectivesComplete, true);
});

check("normalizeGameRules drops a non-positive timer, keeps a valid one", () => {
  assert.equal(normalizeGameRules({ timer: { durationSeconds: 0 } }), null);
  const config = normalizeGameRules({ timer: { durationSeconds: 30, direction: "down" } });
  assert.equal(config?.timer?.durationSeconds, 30);
  assert.equal(config?.timer?.direction, "down");
});

check("parseGameEvent maps loose payloads and rejects junk", () => {
  assert.deepEqual(parseGameEvent({ event: "add", variable: "score", amount: 10 }), {
    kind: "add",
    variable: "score",
    amount: 10,
  });
  assert.deepEqual(parseGameEvent({ kind: "objective", id: "coins" }), {
    kind: "objective",
    id: "coins",
  });
  assert.deepEqual(parseGameEvent({ event: "win" }), { kind: "win" });
  assert.equal(parseGameEvent({ event: "add" }), null); // missing variable
  assert.equal(parseGameEvent({ event: "nope" }), null);
  assert.equal(parseGameEvent(42), null);
});

check("GameStateStore add/set only mutates declared variables", () => {
  const store = new GameStateStore(normalizeGameRules({ variables: [{ id: "score", initial: 0 }] })!);
  store.dispatch({ kind: "add", variable: "score", amount: 5 });
  store.dispatch({ kind: "add", variable: "ghost", amount: 99 }); // undeclared: ignored
  assert.equal(store.variable("score"), 5);
  assert.equal(store.variable("ghost"), undefined);
  store.dispatch({ kind: "set", variable: "score", value: 2 });
  assert.equal(store.variable("score"), 2);
});

check("GameStateStore wins when all required objectives complete", () => {
  const store = new GameStateStore(
    normalizeGameRules({
      objectives: [
        { id: "coins", label: "Coins", target: 3 },
        { id: "bonus", label: "Bonus", target: 1, optional: true },
      ],
    })!,
  );
  assert.equal(store.phase, "playing");
  store.dispatch({ kind: "objective", id: "coins" });
  store.dispatch({ kind: "objective", id: "coins", amount: 5 }); // clamps at target 3
  assert.equal(store.snapshot().objectives[0].count, 3);
  // Optional objective still incomplete, but the round is already won.
  assert.equal(store.phase, "won");
});

check("GameStateStore loses when the tracked variable depletes; lose beats win", () => {
  const store = new GameStateStore(
    normalizeGameRules({
      variables: [{ id: "lives", initial: 1 }],
      objectives: [{ id: "coins", label: "Coins", target: 1 }],
      loseWhenVariableDepleted: "lives",
    })!,
  );
  // Complete the objective AND deplete lives on the same evaluation pass.
  store.dispatch({ kind: "objective", id: "coins" });
  assert.equal(store.phase, "won");
  // Fresh store: deplete first ⇒ lost, and terminal phase ignores later events.
  const store2 = new GameStateStore(
    normalizeGameRules({
      variables: [{ id: "lives", initial: 1 }],
      objectives: [{ id: "coins", label: "Coins", target: 1 }],
      loseWhenVariableDepleted: "lives",
    })!,
  );
  store2.dispatch({ kind: "add", variable: "lives", amount: -1 });
  assert.equal(store2.phase, "lost");
  store2.dispatch({ kind: "objective", id: "coins" });
  assert.equal(store2.snapshot().objectives[0].count, 0); // ignored once terminal
});

check("GameStateStore down-timer expires to its outcome; up-timer never expires", () => {
  const down = new GameStateStore(normalizeGameRules({ timer: { durationSeconds: 2 } })!);
  down.tick(1);
  assert.equal(down.phase, "playing");
  assert.equal(down.timerSeconds(), 1);
  down.tick(5);
  assert.equal(down.timerSeconds(), 0);
  assert.equal(down.phase, "lost"); // default onExpire
  const up = new GameStateStore(
    normalizeGameRules({ timer: { durationSeconds: 2, direction: "up" } })!,
  );
  up.tick(10);
  assert.equal(up.phase, "playing");
  assert.equal(up.timerSeconds(), 10);
});

check("GameStateStore restart/reset restores authored initial state", () => {
  const store = new GameStateStore(
    normalizeGameRules({
      variables: [{ id: "score", initial: 0 }],
      objectives: [{ id: "coins", label: "Coins", target: 2 }],
    })!,
  );
  store.dispatch({ kind: "add", variable: "score", amount: 7 });
  store.dispatch({ kind: "objective", id: "coins", amount: 2 });
  assert.equal(store.phase, "won");
  store.dispatch({ kind: "restart" });
  assert.equal(store.phase, "playing");
  assert.equal(store.variable("score"), 0);
  assert.equal(store.snapshot().objectives[0].count, 0);
});

check("GameStateStore.hudFields exposes namespaced bindable paths", () => {
  const store = new GameStateStore(
    normalizeGameRules({
      variables: [{ id: "score", initial: 0, label: "Score" }],
      objectives: [{ id: "coins", label: "Coins", target: 3 }],
      timer: { durationSeconds: 90 },
    })!,
  );
  store.dispatch({ kind: "add", variable: "score", amount: 40 });
  store.dispatch({ kind: "objective", id: "coins" });
  const fields = store.hudFields();
  assert.equal(fields["game.phase"], "playing");
  assert.equal(fields["game.var.score"], 40);
  assert.equal(fields["game.var.score.label"], "Score");
  assert.equal(fields["game.objective.coins.count"], 1);
  assert.equal(fields["game.objective.coins.target"], 3);
  assert.equal(fields["game.objective.coins.complete"], false);
  assert.equal(fields["game.objectivesComplete"], 0);
  assert.equal(fields["game.objectivesTotal"], 1);
  assert.equal(fields["game.timer.seconds"], 90);
  assert.equal(fields["game.timer.label"], "01:30");
});

check("formatTimer renders mm:ss and floors/clamps", () => {
  assert.equal(formatTimer(0), "00:00");
  assert.equal(formatTimer(5), "00:05");
  assert.equal(formatTimer(75.9), "01:15");
  assert.equal(formatTimer(-3), "00:00");
});

// --- Gamepad + touch input mapping --------------------------------------

check("readGamepadCodes maps buttons + left stick + dpad to codes", () => {
  const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: i === 0 || i === 9 }));
  const result = readGamepadCodes({ axes: [-1, -1, 0, 0], buttons });
  assert.ok(result.down.includes("Pad_A")); // button 0
  assert.ok(result.down.includes("Pad_Start")); // button 9
  // Left stick hard up-left ⇒ forward + left move codes.
  assert.ok(result.down.includes("Pad_LStickUp"));
  assert.ok(result.down.includes("Pad_LStickLeft"));
  assert.ok(!result.down.includes("Pad_LStickDown"));
});

check("readGamepadCodes exposes the right stick as analog look axes", () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  const result = readGamepadCodes({ axes: [0, 0, 0.7, -0.4], buttons });
  assert.deepEqual(result.axes, [
    ["Pad_RStickX", 0.7],
    ["Pad_RStickY", -0.4],
  ]);
  assert.equal(result.down.length, 0); // centered left stick, no buttons
});

check("firstConnectedGamepad returns the first non-null pad", () => {
  const pad = { axes: [], buttons: [] };
  assert.equal(firstConnectedGamepad([null, null, pad]), pad);
  assert.equal(firstConnectedGamepad([null, null]), null);
});

check("joystickVector clamps magnitude to the radius and normalizes", () => {
  // Within the ring: linear.
  const inside = joystickVector(20, 0, 40);
  assert.equal(inside.x, 0.5);
  assert.equal(inside.magnitude, 0.5);
  // Past the ring saturates at 1 along the drag direction.
  const past = joystickVector(80, 0, 40);
  assert.equal(past.x, 1);
  assert.equal(past.magnitude, 1);
  assert.deepEqual(joystickVector(0, 0, 40), { x: 0, y: 0, magnitude: 0 });
});

check("joystickMoveCodes thresholds a stick vector into move codes", () => {
  assert.deepEqual(joystickMoveCodes({ x: 0, y: -1, magnitude: 1 }), ["Pad_LStickUp"]);
  assert.deepEqual(joystickMoveCodes({ x: 1, y: 0, magnitude: 1 }), ["Pad_LStickRight"]);
  // Below threshold ⇒ nothing.
  assert.deepEqual(joystickMoveCodes({ x: 0.2, y: 0.2, magnitude: 0.28 }), []);
});

console.log(`[engine-tests] ${checks} checks passed`);

function minimalGlbJson(json: unknown): Uint8Array {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const paddedJsonLength = Math.ceil(jsonBytes.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedJsonLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  for (let index = 20 + jsonBytes.byteLength; index < bytes.byteLength; index += 1) {
    bytes[index] = 0x20;
  }
  return bytes;
}
