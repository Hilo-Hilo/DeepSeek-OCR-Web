/**
 * Task types for DeepSeek OCR frontend.
 *
 * Keep these shapes compatible with the previous frontend so existing
 * localStorage state can still be restored (same key + version).
 */

export type TaskStatus =
  | "uploading"
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "reconnecting";

export type BackendHealth = "online" | "offline" | "degraded";

export interface TaskState {
  taskId: string;
  uploadedFilePath: string;
  originalFilename: string;
  prompt: string;

  status: TaskStatus;
  progress: number;
  startTime: number;
  elapsedTime: number;

  runtime?: number;
  resultDir?: string;

  consoleMessages: string[];

  isActive: boolean;
  lastUpdated: number;
  isRestored?: boolean;
  connectionStatus?: ConnectionStatus;
  errorMessage?: string;
}

export interface PersistedTasksState {
  tasks: Record<string, TaskState>;
  activeTaskId: string | null;
  lastUpload: {
    filePath: string;
    originalFilename: string;
    timestamp: number;
  } | null;
  version: number;
}

export type TabSyncMessageType =
  | "TASK_STARTED"
  | "TASK_PROGRESS"
  | "TASK_COMPLETED"
  | "TASK_CANCELLED"
  | "TASK_ERROR"
  | "TASK_DELETED"
  | "FILE_UPLOADED"
  | "ACTIVE_TASK_CHANGED";

export interface TabSyncMessage {
  type: TabSyncMessageType;
  taskId?: string;
  payload?: Partial<TaskState> | { uploadedFilePath: string; originalFilename: string };
  timestamp: number;
  tabId: string;
}

export const STORAGE_KEYS = {
  TASKS: "deepseek-ocr-tasks",
} as const;

export const PERSISTED_STATE_VERSION = 1;

export const MAX_CONSOLE_MESSAGES = 100;
export const STALE_TASK_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

export function parseBackendTimestampMs(ts: string | undefined | null): number | null {
  if (!ts) return null;
  let s = String(ts).trim();
  if (!s) return null;

  // Trim fractional seconds to 3 digits (Date.parse handling is inconsistent across browsers).
  // Example: 2025-12-17T22:05:18.947845 -> 2025-12-17T22:05:18.947
  s = s.replace(/\.(\d{3})\d+/, ".$1");

  // If backend timestamp has no timezone suffix, treat it as UTC (backend runs in UTC in Docker).
  const hasTzSuffix = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  if (!hasTzSuffix) s = `${s}Z`;

  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function createTask(
  partial: Partial<TaskState> &
    Pick<TaskState, "taskId" | "uploadedFilePath" | "originalFilename" | "prompt">,
): TaskState {
  return {
    status: "pending",
    progress: 0,
    startTime: Date.now(),
    elapsedTime: 0,
    consoleMessages: [],
    isActive: false,
    lastUpdated: Date.now(),
    ...partial,
  };
}

export function mapBackendStatus(status: string): TaskStatus {
  switch ((status || "").toLowerCase()) {
    case "running":
      return "running";
    case "finished":
      return "completed";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}



