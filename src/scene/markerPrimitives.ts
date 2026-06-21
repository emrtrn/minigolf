/**
 * Procedural geometry for the Player Start marker actor.
 *
 * Like the built-in shapes, the marker persists as an ordinary model instance
 * (synthetic `marker:playerStart` asset) so it flows through the same selection
 * and save pipeline. Visually it mimics an Unreal-style editor helper: an orange
 * capsule drawn as thin line geometry, with the existing blue forward arrow
 * showing the spawn facing. The runtime never renders this asset.
 */
import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Capsule wire colour (engine capsule-collision orange). */
const CAPSULE_COLOR = "#f5a623";
/** Direction arrow colour (gizmo blue). */
const ARROW_COLOR = "#2b7fff";
/** Capsule body radius (world units; scene scale ~= 1 unit per 2 m). */
const CAPSULE_RADIUS = 0.18;
/** Half-length of the capsule's straight (cylindrical) section. */
const CAPSULE_HALF = 0.25;
/** Lift so the capsule's base rests on the placement point (the pawn's feet). */
export const PLAYER_START_CAPSULE_CENTER_Y = CAPSULE_HALF + CAPSULE_RADIUS;

function emissiveMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.85,
    roughness: 1,
    metalness: 0,
  });
}

/**
 * Stadium (capsule profile) outline in a vertical plane: two hemispherical caps
 * joined by straight sides, centred on the capsule. `plane` picks which axis the
 * width runs along (`x` or `z`); height is always Y.
 */
function stadiumLoopPoints(plane: "x" | "z"): Vector3[] {
  const r = CAPSULE_RADIUS;
  const h = CAPSULE_HALF;
  const arc = 16;
  const side = 4;
  const point = (across: number, y: number): Vector3 =>
    plane === "x"
      ? new Vector3(across, y + PLAYER_START_CAPSULE_CENTER_Y, 0)
      : new Vector3(0, y + PLAYER_START_CAPSULE_CENTER_Y, across);

  const points: Vector3[] = [];
  // Top cap: from +across over the top to -across.
  for (let i = 0; i <= arc; i += 1) {
    const t = (i / arc) * Math.PI;
    points.push(point(r * Math.cos(t), h + r * Math.sin(t)));
  }
  // Left straight side, going down (skip endpoints shared with the caps).
  for (let i = 1; i < side; i += 1) {
    points.push(point(-r, h - (i / side) * (2 * h)));
  }
  // Bottom cap: from -across under the bottom to +across.
  for (let i = 0; i <= arc; i += 1) {
    const t = Math.PI + (i / arc) * Math.PI;
    points.push(point(r * Math.cos(t), -h + r * Math.sin(t)));
  }
  // Right straight side, going back up.
  for (let i = 1; i < side; i += 1) {
    points.push(point(r, -h + (i / side) * (2 * h)));
  }
  return points;
}

function pushLoopSegments(positions: number[], points: Vector3[]): void {
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

function pushHorizontalRingSegments(positions: number[], y: number): void {
  const segments = 48;
  const centerY = PLAYER_START_CAPSULE_CENTER_Y + y;
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    positions.push(
      Math.cos(a0) * CAPSULE_RADIUS,
      centerY,
      Math.sin(a0) * CAPSULE_RADIUS,
      Math.cos(a1) * CAPSULE_RADIUS,
      centerY,
      Math.sin(a1) * CAPSULE_RADIUS,
    );
  }
}

/** Capsule helper drawn as real line segments, not shadow-casting tube meshes. */
function capsuleWire(material: LineBasicMaterial): LineSegments {
  const positions: number[] = [];
  pushLoopSegments(positions, stadiumLoopPoints("x"));
  pushLoopSegments(positions, stadiumLoopPoints("z"));
  pushHorizontalRingSegments(positions, CAPSULE_HALF);
  pushHorizontalRingSegments(positions, -CAPSULE_HALF);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, material);
  lines.name = "player-start-capsule-wire";
  return lines;
}

/** Thin gizmo-style arrow (shaft + cone) pointing along +Z (the pawn's forward). */
function forwardArrow(material: MeshStandardMaterial): Mesh[] {
  const shaftGeometry = new CylinderGeometry(0.012, 0.012, 0.3, 8);
  shaftGeometry.rotateX(Math.PI / 2);
  const shaft = new Mesh(shaftGeometry, material);
  shaft.position.set(0, PLAYER_START_CAPSULE_CENTER_Y, 0.15);
  shaft.name = "player-start-arrow-shaft";
  shaft.castShadow = false;
  shaft.receiveShadow = false;

  const headGeometry = new ConeGeometry(0.045, 0.12, 12);
  headGeometry.rotateX(Math.PI / 2);
  const head = new Mesh(headGeometry, material);
  head.position.set(0, PLAYER_START_CAPSULE_CENTER_Y, 0.36);
  head.name = "player-start-arrow-head";
  head.castShadow = false;
  head.receiveShadow = false;

  return [shaft, head];
}

/**
 * Build the Player Start marker as a minimal GLTF-shaped object: the orange
 * line-capsule plus a thin blue forward arrow, so the editor can clone it per
 * placed Player Start while keeping the saved asset id unchanged.
 */
export function createPlayerStartMarkerGltf(): GLTF {
  const capsuleMaterial = new LineBasicMaterial({
    color: CAPSULE_COLOR,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const arrowMaterial = emissiveMaterial(ARROW_COLOR);

  const scene = new Group();
  scene.name = "player-start-marker-root";
  scene.add(capsuleWire(capsuleMaterial), ...forwardArrow(arrowMaterial));

  return {
    scene,
    scenes: [scene],
    animations: [],
    cameras: [],
    asset: { version: "2.0", generator: "forge-player-start-marker" },
    userData: {},
  } as unknown as GLTF;
}
