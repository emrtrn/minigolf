import {
  Color,
  CubeCamera,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  PMREMGenerator,
  ShaderChunk,
  SphereGeometry,
  Vector3,
  WebGLCubeRenderTarget,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";

import type { Vec3 } from "@engine/scene/layout";
import type { ResolvedSphereReflectionCapture } from "@engine/scene/reflectionCapture";

export {
  resolveSphereReflectionCapture,
  selectNearestReflectionCapture,
  SPHERE_REFLECTION_CAPTURE_DEFAULTS,
  uniqueSphereReflectionCaptureId,
  uniqueSphereReflectionCaptureName,
  type ReflectionCaptureProbe,
  type ResolvedSphereReflectionCapture,
} from "@engine/scene/reflectionCapture";

/**
 * Sphere Reflection Capture render binding. Faz 1 renders only the editor-side
 * **influence helper**: a wireframe sphere marking the probe's radius, drawn at
 * the actor's position. There is no cubemap bake yet (that is a later phase) — the
 * helper is purely an authoring aid that is selectable and movable in the
 * viewport. The radius is applied as a uniform three.js scale on a unit-sphere
 * mesh, so a radius edit is a cheap `scale` change with no geometry rebuild; the
 * actor's layout transform never stores a scale.
 */

/** Editor wireframe-sphere helper backing a Sphere Reflection Capture actor. */
export type SphereReflectionCaptureObject = Mesh<SphereGeometry, MeshBasicMaterial>;

/** Resolved settings + world transform the binding needs to build/sync a probe helper. */
export interface SphereReflectionCaptureRenderItem extends ResolvedSphereReflectionCapture {
  position: Vec3;
  /** XYZ-order Euler rotation in degrees (cosmetic for a sphere; kept for the gizmo). */
  rotation: Vec3;
}

/** Tint of the influence-sphere wireframe helper. */
const CAPTURE_HELPER_COLOR = "#46c8ff";

/** Builds the wireframe influence-sphere helper; transform via {@link applySphereReflectionCaptureTransform}. */
export function createSphereReflectionCaptureObject(
  item: SphereReflectionCaptureRenderItem,
): SphereReflectionCaptureObject {
  // Unit sphere scaled by the radius so radius edits never rebuild geometry.
  const geometry = new SphereGeometry(1, 24, 16);
  const material = new MeshBasicMaterial({
    color: new Color(CAPTURE_HELPER_COLOR),
    wireframe: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = item.name;
  applySphereReflectionCaptureTransform(mesh, item);
  return mesh;
}

/** Pushes the transform + visibility + radius (as scale) onto an existing helper. */
export function applySphereReflectionCaptureTransform(
  mesh: SphereReflectionCaptureObject,
  item: SphereReflectionCaptureRenderItem,
): void {
  mesh.position.set(item.position[0], item.position[1], item.position[2]);
  mesh.rotation.set(
    (item.rotation[0] * Math.PI) / 180,
    (item.rotation[1] * Math.PI) / 180,
    (item.rotation[2] * Math.PI) / 180,
    "XYZ",
  );
  mesh.scale.setScalar(Math.max(item.radius, 0.001));
  mesh.visible = !item.hidden;
}

/** Frees the helper's geometry + material. */
export function disposeSphereReflectionCaptureObject(mesh: SphereReflectionCaptureObject): void {
  mesh.geometry.dispose();
  mesh.material.dispose();
}

/**
 * A baked probe: the prefiltered (PMREM) environment captured from the probe's
 * position, plus the resolved scalars copied at bake time so the nearest-probe
 * envMap pass (Faz 3) has a self-contained descriptor. The owner must dispose the
 * `target` (via {@link disposeSphereReflectionCaptureBake}) before replacing it.
 */
export interface SphereReflectionCaptureBake {
  /** Prefiltered PMREM environment render target (`.texture` drives envMaps). */
  target: WebGLRenderTarget;
  /** World position the cubemap was captured from. */
  position: Vec3;
  /** Influence radius copied from the actor at bake time. */
  radius: number;
  /** Reflection strength multiplier copied at bake time. */
  intensity: number;
  /** Overlap tie-breaker copied at bake time. */
  priority: number;
  /** Cubemap face resolution this was baked at (lets the owner detect rebake-on-resolution). */
  resolution: number;
  /** Whether covered surfaces get local sphere parallax correction (Faz 4). */
  parallax: boolean;
}

/**
 * Bakes a Sphere Reflection Capture: renders the scene into a cubemap from the
 * probe's position with a {@link CubeCamera}, then prefilters it into a PMREM
 * environment target (à la Unreal's static Sphere Reflection Capture). The capture
 * is a snapshot — callers bake on load / add / Recapture, never per frame. The
 * caller is responsible for hiding editor-only aids (helpers, gizmo) before baking
 * so they do not pollute the reflection. Tone mapping is forced off during the
 * bake so the environment is stored in neutral/linear space. The raw cube target
 * is freed here; only the returned PMREM target survives and the caller owns it.
 */
export function bakeSphereReflectionCapture(
  renderer: WebGLRenderer,
  scene: Scene,
  item: SphereReflectionCaptureRenderItem,
): SphereReflectionCaptureBake {
  const cubeTarget = new WebGLCubeRenderTarget(item.resolution, { type: HalfFloatType });
  const cubeCamera = new CubeCamera(item.near, item.far, cubeTarget);
  cubeCamera.position.set(item.position[0], item.position[1], item.position[2]);
  // The cube camera is not parented; update its world matrix so the six face
  // cameras render from the probe position.
  cubeCamera.updateMatrixWorld(true);

  const previousToneMapping = renderer.toneMapping;
  renderer.toneMapping = NoToneMapping;
  cubeCamera.update(renderer, scene);
  renderer.toneMapping = previousToneMapping;

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromCubemap(cubeTarget.texture);
  pmrem.dispose();
  cubeTarget.dispose();

  return {
    target,
    position: [item.position[0], item.position[1], item.position[2]],
    radius: item.radius,
    intensity: item.intensity,
    priority: item.priority,
    resolution: item.resolution,
    parallax: item.parallax,
  };
}

/** Frees a baked probe's PMREM render target. */
export function disposeSphereReflectionCaptureBake(bake: SphereReflectionCaptureBake): void {
  bake.target.dispose();
}

/** A `MeshStandardMaterial` (or subclass) — the only materials that take a probe envMap. */
function isProbeEnvMaterial(material: Material): material is MeshStandardMaterial {
  return material instanceof MeshStandardMaterial;
}

/** The shader param object three.js hands `onBeforeCompile` (uniforms + GLSL sources). */
type ShaderPatch = Parameters<MeshStandardMaterial["onBeforeCompile"]>[0];

/**
 * `customProgramCacheKey` value for parallax-corrected materials. All parallax
 * clones share one compiled program (same GLSL); the per-probe position/radius
 * ride in as uniforms, so they stay distinct per material. This key only has to
 * differ from the stock standard/physical key so the patched program is not
 * confused with an unpatched one in three.js' program cache.
 */
const PARALLAX_CACHE_KEY = "forge-reflection-capture-parallax";

// onBeforeCompile receives the shader sources with `#include <...>` directives
// still UNEXPANDED, so we anchor on the raw includes — not on text that only
// exists after three.js resolves them. The vertex include yields `worldPosition`;
// the fragment include is the IBL chunk we patch (its `reflectVec` line is what we
// re-aim, so we expand that chunk inline rather than leaving the directive).

/** Vertex-shader include after which `worldPosition` is in scope (USE_ENVMAP is set). */
const PARALLAX_WORLDPOS_INCLUDE = "#include <worldpos_vertex>";
/** Fragment-shader include for the IBL chunk that owns the reflection lookup. */
const PARALLAX_FRAGMENT_INCLUDE = "#include <envmap_physical_pars_fragment>";
/** Line inside the IBL chunk where `reflectVec` becomes the world-space reflection dir. */
const PARALLAX_REFLECT_LINE = "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );";

/** Forwards the fragment world position to the parallax correction. */
const PARALLAX_VERTEX_ASSIGN = `${PARALLAX_WORLDPOS_INCLUDE}\n\tvCaptureWorldPos = worldPosition.xyz;`;

/**
 * Sphere-bounded parallax correction injected after `reflectVec` becomes the
 * world-space reflection direction: intersect the reflection ray with the probe's
 * influence sphere and re-aim the cubemap lookup at that hit. Without this the
 * cubemap is sampled as if infinitely far (flat-looking on planar surfaces); with
 * it the reflection tracks the fragment's position inside the probe sphere.
 */
const PARALLAX_FRAGMENT_CORRECTION = `
			{
				vec3 captureToFrag = vCaptureWorldPos - captureProbePosition;
				float captureB = dot( reflectVec, captureToFrag );
				float captureC = dot( captureToFrag, captureToFrag ) - captureProbeRadius * captureProbeRadius;
				float captureDisc = captureB * captureB - captureC;
				if ( captureDisc > 0.0 ) {
					float captureDist = - captureB + sqrt( captureDisc );
					if ( captureDist > 0.0 ) {
						reflectVec = normalize( vCaptureWorldPos + reflectVec * captureDist - captureProbePosition );
					}
				}
			}`;

/**
 * Installs local sphere parallax correction on a probe-envMap material via
 * `onBeforeCompile`: inlines the IBL fragment chunk with a re-aimed reflection
 * lookup (toward the probe sphere, using the fragment world position) and forwards
 * that world position from the vertex stage. The probe `position`/`radius` ride in
 * as uniforms (so all parallax clones share one program), and `customProgramCacheKey`
 * keeps that program separate from the unpatched standard program. If the three.js
 * shader anchors ever move the patch is skipped and the material degrades to a plain
 * (non-parallax) envMap.
 */
function installParallaxCorrection(material: MeshStandardMaterial, position: Vec3, radius: number): void {
  const probePosition = new Vector3(position[0], position[1], position[2]);
  const probeRadius = Math.max(radius, 0.001);
  material.onBeforeCompile = (shader: ShaderPatch) => {
    const iblChunk = ShaderChunk.envmap_physical_pars_fragment;
    if (
      !shader.vertexShader.includes(PARALLAX_WORLDPOS_INCLUDE) ||
      !shader.fragmentShader.includes(PARALLAX_FRAGMENT_INCLUDE) ||
      !iblChunk.includes(PARALLAX_REFLECT_LINE)
    ) {
      return;
    }
    shader.uniforms.captureProbePosition = { value: probePosition };
    shader.uniforms.captureProbeRadius = { value: probeRadius };
    shader.vertexShader = `varying vec3 vCaptureWorldPos;\n${shader.vertexShader.replace(
      PARALLAX_WORLDPOS_INCLUDE,
      PARALLAX_VERTEX_ASSIGN,
    )}`;
    // Expand the IBL chunk inline with the correction spliced in after reflectVec,
    // replacing the directive so three.js does not re-expand the stock chunk over it.
    const patchedChunk = iblChunk.replace(
      PARALLAX_REFLECT_LINE,
      `${PARALLAX_REFLECT_LINE}${PARALLAX_FRAGMENT_CORRECTION}`,
    );
    shader.fragmentShader = `uniform vec3 captureProbePosition;\nuniform float captureProbeRadius;\nvarying vec3 vCaptureWorldPos;\n${shader.fragmentShader.replace(
      PARALLAX_FRAGMENT_INCLUDE,
      patchedChunk,
    )}`;
  };
  material.customProgramCacheKey = () => PARALLAX_CACHE_KEY;
  material.needsUpdate = true;
}

/**
 * Returns a material carrying the probe's local envMap: clones the standard `base`
 * material and assigns the PMREM texture + `envMapIntensity` (tracking the clone in
 * `clonedMaterials` for later disposal). When the probe has `parallax` on, the clone
 * also gets the sphere parallax shader patch. Non-standard materials (e.g.
 * `MeshBasicMaterial`) are returned unchanged. Shared by the editor + runtime
 * clone-fallback paths so a probe-covered surface samples the local capture.
 */
export function assignProbeEnvMapMaterial(
  base: Material,
  bake: SphereReflectionCaptureBake,
  clonedMaterials: Material[],
): Material {
  if (!isProbeEnvMaterial(base)) return base;
  const cloned = base.clone();
  cloned.envMap = bake.target.texture;
  cloned.envMapIntensity = bake.intensity;
  if (bake.parallax) installParallaxCorrection(cloned, bake.position, bake.radius);
  cloned.needsUpdate = true;
  clonedMaterials.push(cloned);
  return cloned;
}

/**
 * Assigns (or clears) a probe envMap on an individual object's standard-material
 * surfaces in place. The object's original materials are remembered on first touch
 * (`userData.captureBaseMaterial`); with a `bake` they are cloned + given the probe
 * envMap, without one they are restored so the global `scene.environment` applies.
 * Prior per-object clones are disposed before re-cloning. Shared by editor +
 * runtime so characters/actors reflect identically in both.
 */
export function applyProbeEnvMapToObject(
  object: Object3D,
  bake: SphereReflectionCaptureBake | null,
): void {
  const previous = object.userData.captureMaterials as Material[] | undefined;
  if (previous) for (const material of previous) material.dispose();
  const cloned: Material[] = [];
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.captureBaseMaterial === undefined) {
      mesh.userData.captureBaseMaterial = mesh.material;
    }
    const base = mesh.userData.captureBaseMaterial as Material | Material[];
    if (!bake) {
      mesh.material = base;
      return;
    }
    mesh.material = Array.isArray(base)
      ? base.map((material) => assignProbeEnvMapMaterial(material, bake, cloned))
      : assignProbeEnvMapMaterial(base, bake, cloned);
  });
  object.userData.captureMaterials = cloned;
}
