import { TabSyncMessage, TaskState } from "@/features/tasks/types";

const CHANNEL_NAME = "deepseek-ocr-sync";

function makeTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createTaskMessage() {
  return {
    taskStarted: (task: TaskState): Omit<TabSyncMessage, "timestamp" | "tabId"> => ({
      type: "TASK_STARTED",
      taskId: task.taskId,
      payload: {
        taskId: task.taskId,
        uploadedFilePath: task.uploadedFilePath,
        originalFilename: task.originalFilename,
        prompt: task.prompt,
        status: task.status,
        startTime: task.startTime,
      },
    }),

    taskProgress: (
      taskId: string,
      progress: number,
      elapsedTime: number,
    ): Omit<TabSyncMessage, "timestamp" | "tabId"> => ({
      type: "TASK_PROGRESS",
      taskId,
      payload: { progress, elapsedTime },
    }),

    taskCompleted: (task: TaskState): Omit<TabSyncMessage, "timestamp" | "tabId"> => ({
      type: "TASK_COMPLETED",
      taskId: task.taskId,
      payload: {
        status: task.status,
        runtime: task.runtime,
        resultDir: task.resultDir,
      },
    }),

    taskCancelled: (taskId: string): Omit<TabSyncMessage, "timestamp" | "tabId"> => ({
      type: "TASK_CANCELLED",
      taskId,
    }),

    taskError: (
      taskId: string,
      errorMessage: string,
    ): Omit<TabSyncMessage, "timestamp" | "tabId"> => ({
      type: "TASK_ERROR",
      taskId,
      payload: { status: "error", errorMessage },
    }),

    taskDeleted: (taskId: string): Omit<TabSyncMessage, "timestamp" | "tabId"> => ({
      type: "TASK_DELETED",
      taskId,
    }),

    fileUploaded: (
      filePath: string,
      originalFilename: string,
    ): Omit<TabSyncMessage, "timestamp" | "tabId"> => ({
      type: "FILE_UPLOADED",
      payload: { uploadedFilePath: filePath, originalFilename },
    }),

    activeTaskChanged: (taskId: string | null): Omit<TabSyncMessage, "timestamp" | "tabId"> => ({
      type: "ACTIVE_TASK_CHANGED",
      taskId: taskId || undefined,
    }),
  };
}

export type TabSync = {
  tabId: string;
  broadcast: (msg: Omit<TabSyncMessage, "timestamp" | "tabId">) => void;
  close: () => void;
};

export function createTabSync(onMessage: (msg: TabSyncMessage) => void): TabSync {
  const tabId = makeTabId();

  if (typeof BroadcastChannel === "undefined") {
    return {
      tabId,
      broadcast: () => {},
      close: () => {},
    };
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<TabSyncMessage>) => {
    const msg = event.data;
    if (!msg || msg.tabId === tabId) return;
    onMessage(msg);
  };

  return {
    tabId,
    broadcast: (msg) => {
      const full: TabSyncMessage = { ...msg, tabId, timestamp: Date.now() };
      try {
        channel.postMessage(full);
      } catch {
        // ignore
      }
    },
    close: () => {
      try {
        channel.close();
      } catch {
        // ignore
      }
    },
  };
}





