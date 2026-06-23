import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector2,
  type Material,
  type Texture,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  ForgeMaterialDef,
  ForgeMaterialLayerBlend,
  ForgeMaterialSide,
} from "../assets/material";
import { configureForgeTexture } from "./textureConfig";

type ShaderPatch = Parameters<MeshStandardMaterial["onBeforeCompile"]>[0];

export interface MaterialStats {
  basic: number;
  lit: number;
  total: number;
}

export interface ForgeMaterialTextureMaps {
  baseColorTexture?: Texture | null;
  normalTexture?: Texture | null;
  roughnessTexture?: Texture | null;
  metalnessTexture?: Texture | null;
  aoTexture?: Texture | null;
  opacityTexture?: Texture | null;
  emissiveTexture?: Texture | null;
  ormTexture?: Texture | null;
  layer1BaseColorTexture?: Texture | null;
  layer1NormalTexture?: Texture | null;
  layer1RoughnessTexture?: Texture | null;
  layer1MetalnessTexture?: Texture | null;
  layer1OpacityTexture?: Texture | null;
  layer1EmissiveTexture?: Texture | null;
  layer1AoTexture?: Texture | null;
  layerBlendMaskTexture?: Texture | null;
}

export interface ForgeMaterialOptions {
  maxAnisotropy?: number;
}

export type ForgeThreeMaterial = MeshStandardMaterial | MeshBasicMaterial;

export function isRenderableMesh(
  object: Object3D,
): object is Mesh & { material: Material | Material[] } {
  return object instanceof Mesh;
}

/**
 * Emissive is authored in intuitive ~1-based units (1 starts to read as bloom) but
 * the scene tone-maps from large linear-HDR values, so a small authored number must
 * map to a large actual emissive to glow/bloom. This factor scales the authored
 * `emissiveIntensity` to the three.js material's emissive strength (authored 1 →
 * 1000). It is the counterpart to the bloom strength scale in `postProcess.ts`.
 */
export const EMISSIVE_INTENSITY_SCALE = 1000;

export function createThreeMaterialFromForgeDef(
  def: ForgeMaterialDef,
  textures: ForgeMaterialTextureMaps = {},
  options: ForgeMaterialOptions = {},
): ForgeThreeMaterial {
  const shared = {
    name: def.name,
    color: new Color(def.baseColor),
    transparent: def.alphaMode === "blend" || def.opacity < 1,
    opacity: def.opacity,
    alphaTest: def.alphaMode === "mask" ? def.alphaTest : 0,
    depthWrite: def.alphaMode !== "blend",
    side: materialSide(def.side),
  };
  const material =
    def.materialType === "basic"
      ? new MeshBasicMaterial(shared)
      : new MeshStandardMaterial({
          ...shared,
          roughness: def.roughness,
          metalness: def.metalness,
          emissive: new Color(def.emissive),
          emissiveIntensity: def.emissiveIntensity * EMISSIVE_INTENSITY_SCALE,
        });

  if (textures.baseColorTexture) {
    material.map = configureForgeTexture(textures.baseColorTexture, {
      srgb: true,
      repeat: def.uvTiling,
      maxAnisotropy: options.maxAnisotropy,
    });
  }
  if (textures.opacityTexture) {
    material.alphaMap = configureForgeTexture(textures.opacityTexture, {
      srgb: false,
      repeat: def.uvTiling,
      maxAnisotropy: options.maxAnisotropy,
    });
    material.transparent = true;
  }
  if (textures.normalTexture && material instanceof MeshStandardMaterial) {
    material.normalMap = configureForgeTexture(textures.normalTexture, {
      srgb: false,
      repeat: def.uvTiling,
      maxAnisotropy: options.maxAnisotropy,
    });
  }
  if (material instanceof MeshStandardMaterial) {
    const ormMap = textures.ormTexture
      ? configureForgeTexture(textures.ormTexture, {
          srgb: false,
          repeat: def.uvTiling,
          maxAnisotropy: options.maxAnisotropy,
        })
      : null;
    if (ormMap) {
      material.roughnessMap = ormMap;
      material.metalnessMap = ormMap;
      material.aoMap = ormMap;
      material.aoMapIntensity = def.aoIntensity;
    } else {
      if (textures.roughnessTexture) {
        material.roughnessMap = configureForgeTexture(textures.roughnessTexture, {
          srgb: false,
          repeat: def.uvTiling,
          maxAnisotropy: options.maxAnisotropy,
        });
      }
      if (textures.metalnessTexture) {
        material.metalnessMap = configureForgeTexture(textures.metalnessTexture, {
          srgb: false,
          repeat: def.uvTiling,
          maxAnisotropy: options.maxAnisotropy,
        });
      }
      if (textures.aoTexture) {
        material.aoMap = configureForgeTexture(textures.aoTexture, {
          srgb: false,
          repeat: def.uvTiling,
          maxAnisotropy: options.maxAnisotropy,
        });
        material.aoMapIntensity = def.aoIntensity;
      }
    }
    if (textures.emissiveTexture) {
      material.emissiveMap = configureForgeTexture(textures.emissiveTexture, {
        srgb: true,
        repeat: def.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      });
    }
    if (def.layerBlend) {
      applyLayerBlendMaterial(material, def.layerBlend, textures, options);
    }
  }

  material.needsUpdate = true;
  return material;
}

function applyLayerBlendMaterial(
  material: MeshStandardMaterial,
  blend: ForgeMaterialLayerBlend,
  textures: ForgeMaterialTextureMaps,
  options: ForgeMaterialOptions,
): void {
  const layer1 = blend.layer1;
  const layer1Map = textures.layer1BaseColorTexture
    ? configureForgeTexture(textures.layer1BaseColorTexture, {
        srgb: true,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1NormalMap = textures.normalTexture && textures.layer1NormalTexture
    ? configureForgeTexture(textures.layer1NormalTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1RoughnessMap = textures.layer1RoughnessTexture
    ? configureForgeTexture(textures.layer1RoughnessTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1MetalnessMap = textures.layer1MetalnessTexture
    ? configureForgeTexture(textures.layer1MetalnessTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1OpacityMap = textures.layer1OpacityTexture
    ? configureForgeTexture(textures.layer1OpacityTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1EmissiveMap = textures.layer1EmissiveTexture
    ? configureForgeTexture(textures.layer1EmissiveTexture, {
        srgb: true,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1AoMap = textures.layer1AoTexture
    ? configureForgeTexture(textures.layer1AoTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layerBlendMaskMap = textures.layerBlendMaskTexture
    ? configureForgeTexture(textures.layerBlendMaskTexture, {
        srgb: false,
        // The blend mask selects between layers across the whole surface, so it maps
        // 1:1 to the base UV — it must NOT inherit layer 1's detail tiling (which would
        // repeat the artist mask) and is sampled at raw `vUv` in the shader.
        repeat: { x: 1, y: 1 },
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;

  material.defines = {
    ...(material.defines ?? {}),
    USE_UV: "",
    FORGE_LAYER_BLEND: "",
    ...(layer1Map ? { USE_FORGE_LAYER_MAP: "" } : {}),
    ...(layer1NormalMap ? { USE_FORGE_LAYER_NORMALMAP: "" } : {}),
    ...(layer1RoughnessMap ? { USE_FORGE_LAYER_ROUGHNESSMAP: "" } : {}),
    ...(layer1MetalnessMap ? { USE_FORGE_LAYER_METALNESSMAP: "" } : {}),
    ...(layer1OpacityMap ? { USE_FORGE_LAYER_OPACITYMAP: "" } : {}),
    ...(layer1EmissiveMap ? { USE_FORGE_LAYER_EMISSIVEMAP: "" } : {}),
    ...(layer1AoMap ? { USE_FORGE_LAYER_AOMAP: "" } : {}),
    ...(layerBlendMaskMap ? { USE_FORGE_LAYER_MASKMAP: "" } : {}),
  };
  if (layer1.opacity < 1 || layer1OpacityMap) {
    material.transparent = true;
  }
  material.onBeforeCompile = (shader) => {
    patchLayerBlendShader(shader, blend, {
      layer1Map,
      layer1NormalMap,
      layer1RoughnessMap,
      layer1MetalnessMap,
      layer1OpacityMap,
      layer1EmissiveMap,
      layer1AoMap,
      layerBlendMaskMap,
    });
  };
  material.customProgramCacheKey = () =>
    [
      "forge-layer-blend-v1",
      blend.driver,
      layer1Map ? "bc" : "color",
      layer1NormalMap ? "n" : "no-n",
      layer1RoughnessMap ? "r" : "rough",
      layer1MetalnessMap ? "m" : "metal",
      layer1OpacityMap ? "o" : "opacity",
      layer1EmissiveMap ? "e" : "emissive",
      layer1AoMap ? "ao" : "no-ao",
      layerBlendMaskMap ? "mask" : "no-mask",
    ].join(":");
}

function patchLayerBlendShader(
  shader: ShaderPatch,
  blend: ForgeMaterialLayerBlend,
  maps: {
    layer1Map: Texture | null;
    layer1NormalMap: Texture | null;
    layer1RoughnessMap: Texture | null;
    layer1MetalnessMap: Texture | null;
    layer1OpacityMap: Texture | null;
    layer1EmissiveMap: Texture | null;
    layer1AoMap: Texture | null;
    layerBlendMaskMap: Texture | null;
  },
): void {
  shader.uniforms.forgeLayerColor = { value: new Color(blend.layer1.baseColor) };
  shader.uniforms.forgeLayerRoughness = { value: blend.layer1.roughness };
  shader.uniforms.forgeLayerMetalness = { value: blend.layer1.metalness };
  shader.uniforms.forgeLayerOpacity = { value: blend.layer1.opacity };
  shader.uniforms.forgeLayerAoIntensity = { value: blend.layer1.aoIntensity };
  shader.uniforms.forgeLayerEmissive = {
    value: new Color(blend.layer1.emissive).multiplyScalar(
      blend.layer1.emissiveIntensity * EMISSIVE_INTENSITY_SCALE,
    ),
  };
  shader.uniforms.forgeLayerTiling = {
    value: new Vector2(blend.layer1.uvTiling.x, blend.layer1.uvTiling.y),
  };
  shader.uniforms.forgeLayerAmount = { value: blend.amount };
  shader.uniforms.forgeLayerMin = { value: blend.min };
  shader.uniforms.forgeLayerMax = { value: blend.max };
  shader.uniforms.forgeLayerContrast = { value: blend.contrast };
  shader.uniforms.forgeLayerDriver = { value: layerBlendDriverIndex(blend.driver) };
  if (maps.layer1Map) shader.uniforms.forgeLayerMap = { value: maps.layer1Map };
  if (maps.layer1NormalMap) {
    shader.uniforms.forgeLayerNormalMap = { value: maps.layer1NormalMap };
  }
  if (maps.layer1RoughnessMap) {
    shader.uniforms.forgeLayerRoughnessMap = { value: maps.layer1RoughnessMap };
  }
  if (maps.layer1MetalnessMap) {
    shader.uniforms.forgeLayerMetalnessMap = { value: maps.layer1MetalnessMap };
  }
  if (maps.layer1OpacityMap) {
    shader.uniforms.forgeLayerOpacityMap = { value: maps.layer1OpacityMap };
  }
  if (maps.layer1EmissiveMap) {
    shader.uniforms.forgeLayerEmissiveMap = { value: maps.layer1EmissiveMap };
  }
  if (maps.layer1AoMap) {
    shader.uniforms.forgeLayerAoMap = { value: maps.layer1AoMap };
  }
  if (maps.layerBlendMaskMap) {
    shader.uniforms.forgeLayerMaskMap = { value: maps.layerBlendMaskMap };
  }

  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
varying vec3 vForgeLayerWorldPosition;
varying vec3 vForgeLayerWorldNormal;`,
    )
    .replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vec4 forgeLayerWorldPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  forgeLayerWorldPosition = instanceMatrix * forgeLayerWorldPosition;
#endif
forgeLayerWorldPosition = modelMatrix * forgeLayerWorldPosition;
vForgeLayerWorldPosition = forgeLayerWorldPosition.xyz;
vec3 forgeLayerWorldNormal = objectNormal;
#ifdef USE_INSTANCING
  forgeLayerWorldNormal = mat3( instanceMatrix ) * forgeLayerWorldNormal;
#endif
vForgeLayerWorldNormal = normalize( mat3( modelMatrix ) * forgeLayerWorldNormal );`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
uniform vec3 forgeLayerColor;
uniform float forgeLayerRoughness;
uniform float forgeLayerMetalness;
uniform float forgeLayerOpacity;
uniform float forgeLayerAoIntensity;
uniform vec3 forgeLayerEmissive;
uniform vec2 forgeLayerTiling;
uniform float forgeLayerAmount;
uniform float forgeLayerMin;
uniform float forgeLayerMax;
uniform float forgeLayerContrast;
uniform int forgeLayerDriver;
varying vec3 vForgeLayerWorldPosition;
varying vec3 vForgeLayerWorldNormal;
#ifdef USE_FORGE_LAYER_MAP
  uniform sampler2D forgeLayerMap;
#endif
#ifdef USE_FORGE_LAYER_NORMALMAP
  uniform sampler2D forgeLayerNormalMap;
#endif
#ifdef USE_FORGE_LAYER_ROUGHNESSMAP
  uniform sampler2D forgeLayerRoughnessMap;
#endif
#ifdef USE_FORGE_LAYER_METALNESSMAP
  uniform sampler2D forgeLayerMetalnessMap;
#endif
#ifdef USE_FORGE_LAYER_OPACITYMAP
  uniform sampler2D forgeLayerOpacityMap;
#endif
#ifdef USE_FORGE_LAYER_EMISSIVEMAP
  uniform sampler2D forgeLayerEmissiveMap;
#endif
#ifdef USE_FORGE_LAYER_AOMAP
  uniform sampler2D forgeLayerAoMap;
#endif
#ifdef USE_FORGE_LAYER_MASKMAP
  uniform sampler2D forgeLayerMaskMap;
#endif
// The mask sample is passed in (not read here): this function is injected into
// <common>, which precedes <uv_pars_fragment>, so \`vUv\` is NOT yet declared at this
// point. Sampling the mask here compiled to "vUv undeclared" and blanked the material.
float forgeLayerBlendFactor( float forgeLayerMaskSample ) {
  float value = forgeLayerAmount;
  if (forgeLayerDriver == 1) {
    value = smoothstep(forgeLayerMin, forgeLayerMax, clamp(dot(normalize(vForgeLayerWorldNormal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0));
  } else if (forgeLayerDriver == 2) {
    value = smoothstep(forgeLayerMin, forgeLayerMax, vForgeLayerWorldPosition.y);
  } else if (forgeLayerDriver == 3) {
    value = forgeLayerMaskSample;
  }
  return clamp(pow(clamp(value, 0.0, 1.0), forgeLayerContrast), 0.0, 1.0);
}`,
    )
    .replace(
      "#include <map_fragment>",
      `#include <map_fragment>
// vUv is in scope here (after <uv_pars_fragment>), so sample the mask now and feed it
// to the blend factor declared in <common>.
float forgeLayerMaskSample = 0.0;
#ifdef USE_FORGE_LAYER_MASKMAP
  forgeLayerMaskSample = texture2D( forgeLayerMaskMap, vUv ).r;
#endif
float forgeLayerBlend = forgeLayerBlendFactor( forgeLayerMaskSample );
vec3 forgeLayerDiffuse = forgeLayerColor;
#ifdef USE_FORGE_LAYER_MAP
  vec4 forgeLayerSample = texture2D( forgeLayerMap, vUv * forgeLayerTiling );
  forgeLayerDiffuse *= forgeLayerSample.rgb;
#endif
diffuseColor.rgb = mix( diffuseColor.rgb, forgeLayerDiffuse, forgeLayerBlend );`,
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
float forgeLayerRoughnessFactor = forgeLayerRoughness;
#ifdef USE_FORGE_LAYER_ROUGHNESSMAP
  forgeLayerRoughnessFactor *= texture2D( forgeLayerRoughnessMap, vUv * forgeLayerTiling ).g;
#endif
roughnessFactor = mix( roughnessFactor, forgeLayerRoughnessFactor, forgeLayerBlend );`,
    )
    .replace(
      "#include <metalnessmap_fragment>",
      `#include <metalnessmap_fragment>
float forgeLayerMetalnessFactor = forgeLayerMetalness;
#ifdef USE_FORGE_LAYER_METALNESSMAP
  forgeLayerMetalnessFactor *= texture2D( forgeLayerMetalnessMap, vUv * forgeLayerTiling ).b;
#endif
metalnessFactor = mix( metalnessFactor, forgeLayerMetalnessFactor, forgeLayerBlend );`,
    )
    .replace(
      "#include <alphamap_fragment>",
      `#include <alphamap_fragment>
float forgeLayerOpacityFactor = forgeLayerOpacity;
#ifdef USE_FORGE_LAYER_OPACITYMAP
  forgeLayerOpacityFactor *= texture2D( forgeLayerOpacityMap, vUv * forgeLayerTiling ).g;
#endif
diffuseColor.a = mix( diffuseColor.a, forgeLayerOpacityFactor, forgeLayerBlend );`,
    )
    .replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
vec3 forgeLayerEmissiveRadiance = forgeLayerEmissive;
#ifdef USE_FORGE_LAYER_EMISSIVEMAP
  forgeLayerEmissiveRadiance *= texture2D( forgeLayerEmissiveMap, vUv * forgeLayerTiling ).rgb;
#endif
totalEmissiveRadiance = mix( totalEmissiveRadiance, forgeLayerEmissiveRadiance, forgeLayerBlend );`,
    )
    .replace(
      "#include <aomap_fragment>",
      `float forgeBaseAmbientOcclusion = 1.0;
#ifdef USE_AOMAP
  forgeBaseAmbientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
#endif
float forgeLayerAmbientOcclusion = 1.0;
#ifdef USE_FORGE_LAYER_AOMAP
  forgeLayerAmbientOcclusion = ( texture2D( forgeLayerAoMap, vUv * forgeLayerTiling ).r - 1.0 ) * forgeLayerAoIntensity + 1.0;
#endif
float ambientOcclusion = mix( forgeBaseAmbientOcclusion, forgeLayerAmbientOcclusion, forgeLayerBlend );
reflectedLight.indirectDiffuse *= ambientOcclusion;
#if defined( USE_CLEARCOAT )
  clearcoatSpecularIndirect *= ambientOcclusion;
#endif
#if defined( USE_SHEEN )
  sheenSpecularIndirect *= ambientOcclusion;
#endif
#if defined( USE_ENVMAP ) && defined( STANDARD )
  float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
  reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
#endif`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
#if defined( USE_NORMALMAP_TANGENTSPACE ) && defined( USE_FORGE_LAYER_NORMALMAP )
  vec3 forgeLayerN = texture2D( forgeLayerNormalMap, vUv * forgeLayerTiling ).xyz * 2.0 - 1.0;
  forgeLayerN.xy *= normalScale;
  normal = normalize( mix( normal, normalize( tbn * forgeLayerN ), forgeLayerBlend ) );
#endif`,
    );
}

function layerBlendDriverIndex(driver: ForgeMaterialLayerBlend["driver"]): number {
  if (driver === "slope") return 1;
  if (driver === "worldHeight") return 2;
  if (driver === "maskTexture") return 3;
  return 0;
}

export function collectMaterialStats(models: Map<string, GLTF>): MaterialStats {
  const seen = new Set<Material>();
  for (const gltf of models.values()) {
    gltf.scene.traverse((object) => {
      if (!isRenderableMesh(object)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) seen.add(material);
    });
  }

  let basic = 0;
  let lit = 0;
  for (const material of seen) {
    if (material.type === "MeshBasicMaterial") basic += 1;
    else lit += 1;
  }

  return { basic, lit, total: seen.size };
}

export function convertUnlitModelMaterialsToLit(models: Map<string, GLTF>): number {
  const converted = new Map<Material, Material>();

  const resolveMaterial = (material: Material): Material => {
    if (!(material instanceof MeshBasicMaterial)) return material;
    const cached = converted.get(material);
    if (cached) return cached;

    const lit = new MeshStandardMaterial({
      name: material.name,
      color: material.color.clone(),
      map: material.map,
      alphaMap: material.alphaMap,
      transparent: material.transparent,
      opacity: material.opacity,
      alphaTest: material.alphaTest,
      side: material.side,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite,
      wireframe: material.wireframe,
    });
    lit.vertexColors = material.vertexColors;
    lit.toneMapped = material.toneMapped;
    lit.needsUpdate = true;
    converted.set(material, lit);
    return lit;
  };

  for (const gltf of models.values()) {
    gltf.scene.traverse((object) => {
      if (!isRenderableMesh(object)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map(resolveMaterial)
        : resolveMaterial(object.material);
    });
  }

  return converted.size;
}

function materialSide(side: ForgeMaterialSide): typeof FrontSide | typeof BackSide | typeof DoubleSide {
  if (side === "back") return BackSide;
  if (side === "double") return DoubleSide;
  return FrontSide;
}
