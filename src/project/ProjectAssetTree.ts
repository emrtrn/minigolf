export interface ProjectDirNode {
  name: string;
  path: string;
  type: "dir" | "file";
  ext?: string;
  size?: number;
  children?: ProjectDirNode[];
}

export interface ProjectDirResponse {
  root: string;
  children: ProjectDirNode[];
}

export async function fetchProjectDir(projectPath: string): Promise<ProjectDirResponse> {
  const normalized = normalizeProjectPath(projectPath);
  const response = await fetch(`/__project-dir/${encodeURIComponent(normalized)}`);
  if (!response.ok) {
    throw new Error(`Project directory failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ProjectDirResponse;
}

export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function flattenProjectFiles(nodes: readonly ProjectDirNode[]): ProjectDirNode[] {
  const files: ProjectDirNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      files.push(node);
    } else if (node.children) {
      files.push(...flattenProjectFiles(node.children));
    }
  }
  return files;
}

export function findProjectDir(
  nodes: readonly ProjectDirNode[],
  path: string,
): ProjectDirNode | null {
  const normalized = normalizeProjectPath(path);
  for (const node of nodes) {
    if (node.path === normalized && node.type === "dir") return node;
    if (node.children) {
      const match = findProjectDir(node.children, normalized);
      if (match) return match;
    }
  }
  return null;
}

export function isModelFile(node: ProjectDirNode): boolean {
  return node.type === "file" && (node.ext === "glb" || node.ext === "gltf");
}

/** Content Browser "new content" kinds the `/__content-new` endpoint can create. */
export type ContentNewKind =
  | "folder"
  | "level"
  | "material"
  | "particle"
  | "script"
  | "sound"
  | "ui";

/** Parent class picked for a `kind: "script"` Actor Script (Unreal-style). */
export type ScriptParentClass =
  | "actor"
  | "pawn"
  | "character"
  | "playerController"
  | "gameMode";

export interface ContentNewRequest {
  kind: ContentNewKind;
  /** Public-root-relative directory the new folder/file is created inside. */
  dir: string;
  /** User-entered base name (sanitized server-side). */
  name: string;
  /** For `kind: "script"`, the picked Actor Script parent class. */
  parentClass?: ScriptParentClass;
}

/**
 * Creates a folder or a typed stub asset under `dir`. Hits the localhost-only
 * `/__content-new` dev endpoint; returns the created public-relative path.
 */
export async function createProjectContent(
  request: ContentNewRequest,
): Promise<{ path: string }> {
  const response = await fetch("/__content-new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Create failed: ${response.status} ${response.statusText}`);
  }
  return { path: data.path ?? "" };
}

/**
 * Uploads a single file into `dir` via the localhost-only `/__import-asset`
 * endpoint. The raw bytes are the POST body; target dir + filename ride the
 * query string. Returns the created public-relative path.
 */
export async function importProjectAsset(
  dir: string,
  file: File,
): Promise<{ path: string; registeredId: string | null }> {
  const query = `dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`;
  const response = await fetch(`/__import-asset?${query}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    registeredId?: string | null;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Import failed: ${response.status} ${response.statusText}`);
  }
  return { path: data.path ?? "", registeredId: data.registeredId ?? null };
}
