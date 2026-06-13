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
