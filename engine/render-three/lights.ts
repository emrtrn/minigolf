import {
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Object3D,
  PointLight,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { ColorRepresentation } from "three";

import type { LayoutLightActor } from "@engine/scene/layout";
import { degreesToRadians } from "@engine/scene/transform";

const lightIconTextures = new Map<LayoutLightActor["type"], CanvasTexture>();
const lightIconMaterials = new Map<LayoutLightActor["type"], SpriteMaterial>();

export function configureShadowCastingLight(
  light: DirectionalLight | PointLight | SpotLight,
): void {
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  if (light instanceof DirectionalLight) {
    const shadowCam = light.shadow.camera;
    shadowCam.near = 0.5;
    shadowCam.far = 60;
    shadowCam.left = -12;
    shadowCam.right = 12;
    shadowCam.top = 12;
    shadowCam.bottom = -12;
  }
}

/** Unreal-style billboard icon (bulb for point/spot, sun for directional). */
export function createLightIcon(type: LayoutLightActor["type"]): Sprite {
  const sprite = new Sprite(lightIconMaterial(type));
  sprite.scale.set(0.55, 0.55, 0.55);
  sprite.name = "light-icon";
  return sprite;
}

function lightIconMaterial(type: LayoutLightActor["type"]): SpriteMaterial {
  let material = lightIconMaterials.get(type);
  if (material) return material;
  material = new SpriteMaterial({
    map: lightIconTexture(type),
    transparent: true,
    // Always visible (like Unreal's editor icons), even behind geometry.
    depthTest: false,
    depthWrite: false,
  });
  lightIconMaterials.set(type, material);
  return material;
}

function lightIconTexture(type: LayoutLightActor["type"]): CanvasTexture {
  let texture = lightIconTextures.get(type);
  if (texture) return texture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) drawLightGlyph(ctx, type);
  texture = new CanvasTexture(canvas);
  lightIconTextures.set(type, texture);
  return texture;
}

function drawLightGlyph(ctx: CanvasRenderingContext2D, type: LayoutLightActor["type"]): void {
  ctx.clearRect(0, 0, 64, 64);
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(25,20,8,0.92)";
  ctx.fillStyle = "#ffd76a";

  if (type === "directional") {
    const cx = 32;
    const cy = 32;
    const r = 11;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
      ctx.lineTo(cx + Math.cos(a) * (r + 13), cy + Math.sin(a) * (r + 13));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  // Bulb for point + spot.
  const cx = 32;
  const cy = 25;
  const r = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#9a8a5a";
  ctx.beginPath();
  ctx.rect(cx - 7, cy + r - 3, 14, 13);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy + r + 2);
  ctx.lineTo(cx + 7, cy + r + 2);
  ctx.moveTo(cx - 7, cy + r + 6);
  ctx.lineTo(cx + 7, cy + r + 6);
  ctx.stroke();
}

/**
 * Unreal-style wireframe light gizmo: a small solid icon (the click target) plus
 * a wireframe that represents the light's actual reach.
 */
export function buildLightGizmo(
  actor: LayoutLightActor,
  color: ColorRepresentation,
): Object3D {
  const group = new Group();
  group.name = "light-gizmo";
  group.add(createLightIcon(actor.type));

  const lineMaterial = new LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  let wire: LineSegments;
  if (actor.type === "spot") {
    const angle = degreesToRadians(actor.angle ?? 30);
    const height = actor.distance && actor.distance > 0 ? actor.distance : 10;
    const radius = Math.tan(angle) * height;
    wire = buildSpotConeWire(radius, height, lineMaterial);
  } else if (actor.type === "point") {
    const radius = actor.distance && actor.distance > 0 ? actor.distance : 1;
    wire = buildPointSphereWire(radius, lineMaterial);
  } else {
    wire = buildDirectionWire(lineMaterial);
  }
  wire.name = "light-wire";
  // Visual only: never a pick target (otherwise the whole cone/sphere selects).
  wire.raycast = () => {};
  // Shown only while the light is selected.
  wire.visible = false;
  group.add(wire);
  return group;
}

/** Cone wireframe: apex at origin (the light), opening down local -Z to z=-height. */
function buildSpotConeWire(
  radius: number,
  height: number,
  material: LineBasicMaterial,
): LineSegments {
  const segments = 24;
  const rim: Vector3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    rim.push(new Vector3(Math.cos(a) * radius, Math.sin(a) * radius, -height));
  }
  const points: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = rim[i]!;
    const b = rim[(i + 1) % segments]!;
    points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  for (let i = 0; i < 4; i += 1) {
    const p = rim[Math.floor((i / 4) * segments)]!;
    points.push(0, 0, 0, p.x, p.y, p.z);
  }
  return new LineSegments(bufferFromPoints(points), material);
}

/** Three orthogonal great circles forming a wireframe sphere of the given radius. */
function buildPointSphereWire(radius: number, material: LineBasicMaterial): LineSegments {
  const segments = 32;
  const points: number[] = [];
  const onCircle = (axis: 0 | 1 | 2, t: number): Vector3 => {
    const c = Math.cos(t) * radius;
    const s = Math.sin(t) * radius;
    if (axis === 0) return new Vector3(0, c, s);
    if (axis === 1) return new Vector3(c, 0, s);
    return new Vector3(c, s, 0);
  };
  for (const axis of [0, 1, 2] as const) {
    for (let i = 0; i < segments; i += 1) {
      const u = onCircle(axis, (i / segments) * Math.PI * 2);
      const v = onCircle(axis, ((i + 1) / segments) * Math.PI * 2);
      points.push(u.x, u.y, u.z, v.x, v.y, v.z);
    }
  }
  return new LineSegments(bufferFromPoints(points), material);
}

/** A short line down local -Z indicating a directional light's aim. */
function buildDirectionWire(material: LineBasicMaterial): LineSegments {
  return new LineSegments(bufferFromPoints([0, 0, 0, 0, 0, -1.2]), material);
}

function bufferFromPoints(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return geometry;
}

export function disposeLightGizmo(gizmo: Object3D): void {
  gizmo.traverse((child) => {
    if (child instanceof Mesh || child instanceof LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  });
}
