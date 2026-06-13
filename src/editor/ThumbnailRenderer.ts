import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { MeshoptDecoder } from "meshoptimizer";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class ThumbnailRenderer {
  private readonly loader = new GLTFLoader();
  private readonly renderer: WebGLRenderer;
  private readonly cache = new Map<string, Promise<string>>();

  constructor(size = 192) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
  }

  renderModel(url: string): Promise<string> {
    let cached = this.cache.get(url);
    if (!cached) {
      cached = this.renderModelUncached(url);
      this.cache.set(url, cached);
    }
    return cached;
  }

  dispose(): void {
    this.renderer.dispose();
    this.cache.clear();
  }

  private async renderModelUncached(url: string): Promise<string> {
    const gltf = await this.loader.loadAsync(url);
    const model = gltf.scene.clone(true);
    const scene = new Scene();
    scene.background = new Color(0x191b1f);
    scene.add(new AmbientLight(0xffffff, 1.2));

    const keyLight = new DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(2.5, 4, 3);
    scene.add(keyLight);

    const fillLight = new DirectionalLight(0xb9d4ff, 1.2);
    fillLight.position.set(-3, 2.5, -2);
    scene.add(fillLight);

    const group = new Group();
    group.add(model);
    scene.add(group);

    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z, 0.1);
    model.position.sub(center);
    model.position.y += size.y / 2;
    group.rotation.y = -Math.PI / 5;

    const grid = new GridHelper(Math.max(maxAxis * 2.6, 2), 12, 0x464a51, 0x292c31);
    grid.position.y = -0.01;
    scene.add(grid);

    const camera = new PerspectiveCamera(32, 1, 0.01, 100);
    const distance = maxAxis * 2.4;
    camera.position.set(distance * 0.85, distance * 0.7, distance);
    camera.lookAt(0, size.y * 0.38, 0);
    camera.updateProjectionMatrix();

    this.renderer.setClearColor(0x191b1f, 1);
    this.renderer.render(scene, camera);
    return this.renderer.domElement.toDataURL("image/png");
  }
}
