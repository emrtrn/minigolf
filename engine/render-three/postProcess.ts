import {
  ACESFilmicToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  Vector2,
  type Camera,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FilmPass } from "three/examples/jsm/postprocessing/FilmPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { RGBShiftShader } from "three/examples/jsm/shaders/RGBShiftShader.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";

import type { ResolvedPostProcess } from "@engine/scene/postProcess";

export {
  POST_PROCESS_DEFAULTS,
  resolvePostProcess,
  type PostProcessToneMapping,
  type PostProcessAntialias,
  type ResolvedPostProcess,
} from "@engine/scene/postProcess";

export const POST_PROCESS_RENDER_EXPOSURE_SCALE = 0.2;

export function postProcessToneMappingExposure(exposure: number): number {
  return Math.max(0, exposure * POST_PROCESS_RENDER_EXPOSURE_SCALE);
}

/** Applies the renderer-property part of the global Post Process singleton. */
export function applyPostProcessToneMapping(
  renderer: WebGLRenderer,
  resolved: ResolvedPostProcess | null,
): void {
  if (!resolved || resolved.hidden) return;
  if (resolved.toneMapping === "aces") {
    renderer.toneMapping = ACESFilmicToneMapping;
  } else if (resolved.toneMapping === "neutral") {
    renderer.toneMapping = NeutralToneMapping;
  } else {
    renderer.toneMapping = NoToneMapping;
  }
  renderer.toneMappingExposure = postProcessToneMappingExposure(resolved.exposure);
}

const COLOR_GRADING_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    temperature: { value: 0 },
    tint: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float temperature;
    uniform float tint;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // White balance: temperature warms (+) / cools (-); tint shifts magenta (+) / green (-).
      color.r += temperature * 0.1;
      color.b -= temperature * 0.1;
      color.g -= tint * 0.1;
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(vec3(luma), color.rgb, saturation);
      gl_FragColor = color;
    }
  `,
};

/**
 * Bloom strength is authored in intuitive ~1-based units (1 = the standard sun
 * bloom look, matching threshold/radius) but the analytic Sky sun disc has
 * enormous linear-HDR radiance, so a tiny actual UnrealBloomPass strength already
 * reads strongly. This factor maps authored intensity to that strength (1 → 0.001).
 */
const BLOOM_INTENSITY_SCALE = 0.001;

/**
 * Authored chromatic-aberration amount (~1-based) maps to the RGBShift shader's
 * UV shift distance, which is tiny (its default 0.005 is already visible). This
 * factor keeps the authored slider intuitive (0.5 → the 0.005 default look).
 */
const CHROMATIC_ABERRATION_AMOUNT_SCALE = 0.01;

/**
 * DoF is authored against the 100u far-plane scale. `focusDistance` is passed
 * straight through as world units; `aperture`/`maxBlur` are authored ~1-based and
 * scaled to the BokehShader's much smaller blur units (factor·aperture clamped to
 * maxblur, where the depth `factor` can reach ~90 in this scene).
 */
const DOF_APERTURE_SCALE = 0.0002;
const DOF_MAXBLUR_SCALE = 0.01;

/**
 * GTAO `radius` is in world units. Although the far plane is 100u, actual content
 * here is sub-unit (the demo character spawns at 0.3 scale, ~0.5u tall), so the
 * AO sample radius must be small or it spans whole objects and self-occludes them
 * to black. This factor maps the intuitive ~1-based slider to that small world
 * radius (1 → 0.1u, contact-shadow scale). `intensity` passes straight through to
 * `blendIntensity` (1 = full AO).
 */
const AO_RADIUS_SCALE = 0.1;

/**
 * GTAOPass computes AO from a normal+depth G-buffer it renders by overriding the
 * whole scene's material. Its built-in visibility cull only skips Points / Lines,
 * so editor billboard {@link Sprite} icons (camera-facing quads that punch a depth
 * wall → black halos around actor icons) pollute that buffer. This subclass also
 * hides sprites and anything flagged `userData.noAmbientOcclusion` during the AO
 * pass so those 2D overlays never receive occlusion. Real geometry — including
 * characters — stays in, so it gets proper AO (see {@link AO_RADIUS_SCALE} for the
 * scale tuning that keeps small objects from self-occluding to black). Visibility
 * is restored by the base pass within the same frame (after the beauty
 * RenderPass), so nothing else is affected.
 */
class ForgeGtaoPass extends GTAOPass {
  /** Overrides GTAOPass's internal (untyped) normal-pass visibility cull. */
  _overrideVisibility(): void {
    const cache = (this as unknown as { _visibilityCache: Object3D[] })._visibilityCache;
    this.scene.traverse((object) => {
      if (!object.visible) return;
      const probe = object as Object3D & {
        isPoints?: boolean;
        isLine?: boolean;
        isLine2?: boolean;
        isSprite?: boolean;
      };
      if (
        probe.isPoints ||
        probe.isLine ||
        probe.isLine2 ||
        probe.isSprite ||
        object.userData.noAmbientOcclusion === true
      ) {
        object.visible = false;
        cache.push(object);
      }
    });
  }
}

/** Returns true when the grading ShaderPass would change the image at all. */
function hasColorGrading(resolved: ResolvedPostProcess): boolean {
  return (
    resolved.saturation !== 1 ||
    resolved.contrast !== 1 ||
    resolved.temperature !== 0 ||
    resolved.tint !== 0
  );
}

export function createPostProcessEffectPasses(
  resolved: ResolvedPostProcess | null,
  context: { scene: Scene; camera: PerspectiveCamera; width: number; height: number },
): Pass[] {
  if (!resolved || resolved.hidden) return [];
  const { width, height } = context;
  const passes: Pass[] = [];
  // Order (Section E): AO right after beauty → DoF → Bloom → grading → chromatic
  // aberration → vignette → grain, with OutlinePass/OutputPass appended later by
  // the pipeline.
  if (resolved.ao.enabled) {
    const gtaoPass = new ForgeGtaoPass(context.scene, context.camera, width, height);
    gtaoPass.updateGtaoMaterial({ radius: resolved.ao.radius * AO_RADIUS_SCALE });
    gtaoPass.blendIntensity = resolved.ao.intensity;
    // GTAOPass sizes its render targets + camera projection uniforms in setSize.
    gtaoPass.setSize(width, height);
    passes.push(gtaoPass);
  }
  if (resolved.dof.enabled) {
    const bokehPass = new BokehPass(context.scene, context.camera, {
      focus: resolved.dof.focusDistance,
      aperture: resolved.dof.aperture * DOF_APERTURE_SCALE,
      maxblur: resolved.dof.maxBlur * DOF_MAXBLUR_SCALE,
    });
    // BokehPass starts with a 1x1 depth target; size it before it enters the chain.
    bokehPass.setSize(width, height);
    passes.push(bokehPass);
  }
  if (resolved.bloom.enabled) {
    passes.push(
      new UnrealBloomPass(
        new Vector2(width, height),
        resolved.bloom.intensity * BLOOM_INTENSITY_SCALE,
        resolved.bloom.radius,
        resolved.bloom.threshold,
      ),
    );
  }
  if (hasColorGrading(resolved)) {
    const gradingPass = new ShaderPass(COLOR_GRADING_SHADER);
    gradingPass.uniforms.saturation!.value = resolved.saturation;
    gradingPass.uniforms.contrast!.value = resolved.contrast;
    gradingPass.uniforms.temperature!.value = resolved.temperature;
    gradingPass.uniforms.tint!.value = resolved.tint;
    passes.push(gradingPass);
  }
  if (resolved.chromaticAberration.enabled) {
    const caPass = new ShaderPass(RGBShiftShader);
    caPass.uniforms.amount!.value =
      resolved.chromaticAberration.amount * CHROMATIC_ABERRATION_AMOUNT_SCALE;
    passes.push(caPass);
  }
  if (resolved.vignette.enabled) {
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset!.value = resolved.vignette.offset;
    vignettePass.uniforms.darkness!.value = resolved.vignette.intensity;
    passes.push(vignettePass);
  }
  if (resolved.grain.enabled) {
    // FilmShader is pure grain (no scanlines) in three r150+, so no toggle needed.
    passes.push(new FilmPass(resolved.grain.intensity, false));
  }
  return passes;
}

export function hasPostProcessEffectPasses(resolved: ResolvedPostProcess | null): boolean {
  return Boolean(
    resolved &&
      !resolved.hidden &&
      (resolved.bloom.enabled ||
        resolved.vignette.enabled ||
        resolved.dof.enabled ||
        resolved.ao.enabled ||
        resolved.chromaticAberration.enabled ||
        resolved.grain.enabled ||
        resolved.antialias !== "none" ||
        hasColorGrading(resolved)),
  );
}

export function createPostProcessAntialiasPass(
  resolved: ResolvedPostProcess | null,
  size: { width: number; height: number },
): Pass | null {
  if (!resolved || resolved.hidden || resolved.antialias === "none") return null;
  if (resolved.antialias === "smaa") {
    const pass = new SMAAPass();
    pass.setSize(size.width, size.height);
    return pass;
  }
  return null;
}

/**
 * Shared composer backbone for editor/runtime post-process work. F2.0 only owns
 * RenderPass/OutputPass and lets callers inject editor-only passes before output.
 */
export class PostProcessPipeline {
  private readonly composer: EffectComposer;
  private readonly outputPass: OutputPass;
  private readonly injectedPasses: Pass[] = [];
  private effectPasses: Pass[] = [];
  private antialiasPass: Pass | null = null;

  constructor(options: {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: Camera;
    width: number;
    height: number;
  }) {
    this.composer = new EffectComposer(options.renderer);
    this.composer.addPass(new RenderPass(options.scene, options.camera));
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.composer.setSize(options.width, options.height);
  }

  addPassBeforeOutput(pass: Pass): void {
    this.composer.insertPass(pass, this.finalStageStartIndex());
    this.injectedPasses.push(pass);
  }

  setEffectPasses(passes: Pass[]): void {
    for (const pass of this.effectPasses) {
      this.composer.removePass(pass);
      pass.dispose();
    }
    this.effectPasses = passes;
    const insertIndex = this.finalStageStartIndex();
    passes.forEach((pass, offset) => {
      this.composer.insertPass(pass, insertIndex + offset);
    });
  }

  setAntialiasPass(pass: Pass | null): void {
    if (this.antialiasPass) {
      this.composer.removePass(this.antialiasPass);
      this.antialiasPass.dispose();
    }
    this.antialiasPass = pass;
    if (pass) {
      const outputIndex = this.composer.passes.indexOf(this.outputPass);
      this.composer.insertPass(pass, outputIndex >= 0 ? outputIndex : this.composer.passes.length);
    }
  }

  render(deltaSeconds: number): void {
    this.composer.render(deltaSeconds);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  dispose(): void {
    for (const pass of this.effectPasses) pass.dispose();
    for (const pass of this.injectedPasses) pass.dispose();
    this.antialiasPass?.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
  }

  private finalStageStartIndex(): number {
    const indices = [
      ...this.injectedPasses.map((pass) => this.composer.passes.indexOf(pass)),
      this.antialiasPass ? this.composer.passes.indexOf(this.antialiasPass) : -1,
      this.composer.passes.indexOf(this.outputPass),
    ].filter((index) => index >= 0);
    return indices.length > 0
      ? Math.min(...indices)
      : this.composer.passes.length;
  }
}
