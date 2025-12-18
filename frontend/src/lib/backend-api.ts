import { getBackendBaseUrl, toWebSocketBaseUrl } from "@/lib/backend-url";

export type ZipFormat = "mmd" | "md" | "txt";

export type ApiOk<T> = T & { status: "success" };
export type ApiErr = { status: "error"; message?: string };

export type UploadResponse =
  | ApiOk<{ file_path: string; file_type: string; original_filename?: string }>
  | ApiErr;

export type StartTaskResponse =
  | { status: "running"; task_id: string }
  | { status: "error"; message?: string };

export type ProgressResponse =
  | ApiOk<{ task_id: string; state: string; progress: number; message?: string }>
  | ApiErr;

export type ResultResponse =
  | ApiOk<{
      task_id: string;
      state: "finished";
      result_dir: string;
      files: string[];
      runtime?: number;
    }>
  | { status: "running"; task_id: string }
  | ApiErr;

export type HistoryJob = {
  task_id: string;
  filename: string;
  original_filename: string;
  timestamp: string;
  runtime?: number | null;
  status: string;
  result_dir: string;
  progress?: number;
};

export type HistoryResponse = ApiOk<{ jobs: HistoryJob[] }> | ApiErr;

export type FolderNode = {
  name: string;
  type: "folder" | "file";
  path?: string;
  children?: FolderNode[];
};

export type FolderResponse =
  | ApiOk<{ path: string; children: FolderNode[] }>
  | ApiErr;

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON but got ${contentType || "unknown content-type"} (${res.status}): ${text}`);
  }
  return (await res.json()) as unknown;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await parseJsonOrThrow(res);
  return data as T;
}

export function buildConsoleWsUrl(taskId: string): string {
  const wsBase = toWebSocketBaseUrl(getBackendBaseUrl());
  return `${wsBase}/ws/console/${encodeURIComponent(taskId)}`;
}

export function buildProgressWsUrl(taskId: string): string {
  const wsBase = toWebSocketBaseUrl(getBackendBaseUrl());
  return `${wsBase}/ws/progress/${encodeURIComponent(taskId)}`;
}

export function buildDownloadZipUrl(taskId: string, format: ZipFormat): string {
  const base = getBackendBaseUrl();
  return `${base}/api/download/zip/${encodeURIComponent(taskId)}?format=${encodeURIComponent(format)}`;
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const base = getBackendBaseUrl();
  const form = new FormData();
  form.append("file", file);
  return requestJson<UploadResponse>(`${base}/api/upload`, {
    method: "POST",
    body: form,
  });
}

export async function startTask(params: {
  filePath: string;
  prompt: string;
  originalFilename?: string;
}): Promise<StartTaskResponse> {
  const base = getBackendBaseUrl();
  return requestJson<StartTaskResponse>(`${base}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: params.filePath,
      prompt: params.prompt,
      original_filename: params.originalFilename || "",
    }),
  });
}

export async function getTaskProgress(taskId: string): Promise<ProgressResponse> {
  const base = getBackendBaseUrl();
  return requestJson<ProgressResponse>(`${base}/api/progress/${encodeURIComponent(taskId)}`);
}

export async function getTaskResult(taskId: string): Promise<ResultResponse> {
  const base = getBackendBaseUrl();
  return requestJson<ResultResponse>(`${base}/api/result/${encodeURIComponent(taskId)}`);
}

export async function getHistory(): Promise<HistoryResponse> {
  const base = getBackendBaseUrl();
  return requestJson<HistoryResponse>(`${base}/api/history`);
}

export async function cancelTask(taskId: string): Promise<ApiOk<{ message?: string }> | ApiErr> {
  const base = getBackendBaseUrl();
  return requestJson<ApiOk<{ message?: string }> | ApiErr>(`${base}/api/cancel/${encodeURIComponent(taskId)}`, {
    method: "POST",
  });
}

export async function deleteTask(taskId: string): Promise<ApiOk<{ message?: string }> | ApiErr> {
  const base = getBackendBaseUrl();
  return requestJson<ApiOk<{ message?: string }> | ApiErr>(`${base}/api/delete/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

export async function getFolder(path: string): Promise<FolderResponse> {
  const base = getBackendBaseUrl();
  const url = `${base}/api/folder?path=${encodeURIComponent(path)}`;
  return requestJson<FolderResponse>(url);
}

export async function getFileText(path: string): Promise<string> {
  const base = getBackendBaseUrl();
  const url = buildFileContentUrl(path);
  const data = await requestJson<{ content?: string; status?: string; message?: string }>(url);
  if (data.status === "error") {
    throw new Error(data.message || "Failed to load file");
  }
  return data.content ?? "";
}

export async function getFileBlob(path: string): Promise<Blob> {
  const url = buildFileContentUrl(path);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch file blob (${res.status})`);
  }
  return res.blob();
}

export async function headFile(path: string): Promise<boolean> {
  const url = buildFileContentUrl(path);
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export function buildFileContentUrl(path: string): string {
  const base = getBackendBaseUrl();
  return `${base}/api/file/content?path=${encodeURIComponent(path)}`;
}

export function buildResultsAssetUrl(resultDir: string, relativePath: string): string {
  const base = getBackendBaseUrl();
  // resultDir is an absolute path like /app/workspace/results/ocr_task_xxx
  const marker = "/results/";
  const idx = resultDir.indexOf(marker);
  const relRoot = idx >= 0 ? resultDir.slice(idx + marker.length) : resultDir.replace(/^\/+/, "");
  const joined = `${relRoot}/${relativePath}`.replace(/\/+/g, "/");
  return `${base}/results/${joined.replace(/^\/+/, "")}`;
}


