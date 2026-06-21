import {
  ACESFilmicToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  Vector2,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";

import type { ResolvedPostProcess } from "@engine/scene/postProcess";

export {
  POST_PROCESS_DEFAULTS,
  resolvePostProcess,
  type PostProcessToneMapping,
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
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
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

export function createPostProcessEffectPasses(
  resolved: ResolvedPostProcess | null,
  size: { width: number; height: number },
): Pass[] {
  if (!resolved || resolved.hidden) return [];
  const passes: Pass[] = [];
  if (resolved.bloom.enabled) {
    passes.push(
      new UnrealBloomPass(
        new Vector2(size.width, size.height),
        resolved.bloom.intensity * BLOOM_INTENSITY_SCALE,
        resolved.bloom.radius,
        resolved.bloom.threshold,
      ),
    );
  }
  if (resolved.saturation !== 1 || resolved.contrast !== 1) {
    const gradingPass = new ShaderPass(COLOR_GRADING_SHADER);
    gradingPass.uniforms.saturation!.value = resolved.saturation;
    gradingPass.uniforms.contrast!.value = resolved.contrast;
    passes.push(gradingPass);
  }
  if (resolved.vignette.enabled) {
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset!.value = resolved.vignette.offset;
    vignettePass.uniforms.darkness!.value = resolved.vignette.intensity;
    passes.push(vignettePass);
  }
  return passes;
}

export function hasPostProcessEffectPasses(resolved: ResolvedPostProcess | null): boolean {
  return Boolean(
    resolved &&
      !resolved.hidden &&
      (resolved.bloom.enabled ||
        resolved.vignette.enabled ||
        resolved.saturation !== 1 ||
        resolved.contrast !== 1),
  );
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
    const outputIndex = this.composer.passes.indexOf(this.outputPass);
    this.composer.insertPass(pass, outputIndex >= 0 ? outputIndex : this.composer.passes.length);
    this.injectedPasses.push(pass);
  }

  setEffectPasses(passes: Pass[]): void {
    for (const pass of this.effectPasses) {
      this.composer.removePass(pass);
      pass.dispose();
    }
    this.effectPasses = passes;
    const firstInjectedIndex = this.injectedPasses
      .map((pass) => this.composer.passes.indexOf(pass))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    const outputIndex = this.composer.passes.indexOf(this.outputPass);
    const insertIndex =
      firstInjectedIndex ?? (outputIndex >= 0 ? outputIndex : this.composer.passes.length);
    passes.forEach((pass, offset) => {
      this.composer.insertPass(pass, insertIndex + offset);
    });
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
    this.outputPass.dispose();
    this.composer.dispose();
  }
}
