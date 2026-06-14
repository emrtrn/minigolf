import type { LayoutLightActor } from "./layout";

export function defaultLightIntensity(type: LayoutLightActor["type"]): number {
  if (type === "directional") return 2;
  if (type === "spot") return 3;
  return 2.5;
}

export function formatLightType(type: LayoutLightActor["type"]): string {
  if (type === "directional") return "Directional Light";
  if (type === "spot") return "Spot Light";
  return "Point Light";
}

export function uniqueActorName(
  baseName: string,
  lights: LayoutLightActor[],
): string {
  const existing = new Set(lights.map((light) => light.name ?? light.id));
  if (!existing.has(baseName)) return baseName;
  let index = 2;
  while (existing.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}
