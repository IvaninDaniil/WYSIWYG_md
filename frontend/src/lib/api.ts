import type { FilePayload, TreeNode } from "./types";

function formBody(values: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => params.set(key, value));
  return params;
}

export async function fetchTree(root?: string): Promise<TreeNode> {
  const params = new URLSearchParams();
  if (root) params.set("root", root);
  const response = await fetch(`/api/tree?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load tree");
  }
  return response.json();
}

export async function fetchFile(path: string): Promise<FilePayload> {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error("Failed to load file");
  }
  return response.json();
}

export async function saveFile(path: string, content: string): Promise<void> {
  const response = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ path, content }).toString(),
  });

  if (!response.ok) {
    throw new Error("Failed to save file");
  }
}

export async function uploadImage(targetDir: string, fileName: string, dataUrl: string): Promise<string> {
  const response = await fetch("/api/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ targetDir, fileName, dataUrl }).toString(),
  });

  if (!response.ok) {
    throw new Error("Failed to upload image");
  }

  const payload = (await response.json()) as { path: string };
  return payload.path;
}

export async function createEntry(
  parent: string,
  name: string,
  entryType: "folder" | "md" | "puml",
): Promise<void> {
  const response = await fetch("/api/create", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ parent, name, entryType }).toString(),
  });

  if (!response.ok) {
    throw new Error("Failed to create entry");
  }
}

export type PluginSession = {
  id: string;
  moduleId: string;
  source: string;
  revision: number;
  status: string;
  updatedAt: number;
};

export async function fetchPlantUmlUrl(text: string): Promise<string> {
  const response = await fetch(`/api/plantuml-url?text=${encodeURIComponent(text)}`);
  if (!response.ok) {
    throw new Error("Failed to build PlantUML preview URL");
  }
  const payload = (await response.json()) as { url: string };
  return payload.url;
}

export async function createPluginSession(
  source: string,
  moduleId = "plantuml_studio",
): Promise<PluginSession> {
  const response = await fetch("/api/plugin-session/create", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ source, moduleId }).toString(),
  });
  if (!response.ok) {
    throw new Error("Failed to create plugin session");
  }
  return response.json();
}

export async function savePluginSession(
  id: string,
  source: string,
  status = "saved",
): Promise<PluginSession> {
  const response = await fetch("/api/plugin-session/save", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ id, source, status }).toString(),
  });
  if (!response.ok) {
    throw new Error("Failed to save plugin session");
  }
  return response.json();
}

export async function getPluginSession(id: string): Promise<PluginSession> {
  const response = await fetch(`/api/plugin-session?id=${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error("Failed to get plugin session");
  }
  return response.json();
}
