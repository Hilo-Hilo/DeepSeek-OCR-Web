"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useReducer } from "react";
import {
  buildConsoleWsUrl,
  getHistory,
  getTaskProgress,
  getTaskResult,
  type HistoryJob,
} from "@/lib/backend-api";
import {
  createTask,
  mapBackendStatus,
  MAX_CONSOLE_MESSAGES,
  PERSISTED_STATE_VERSION,
  STALE_TASK_THRESHOLD_MS,
  parseBackendTimestampMs,
  type PersistedTasksState,
  type TabSyncMessage,
  type TaskState,
  type TaskStatus,
} from "@/features/tasks/types";
import { cleanupStaleTasks, loadPersistedState, savePersistedState } from "@/features/tasks/storage";
import { createTabSync, createTaskMessage, type TabSync } from "@/features/tasks/tab-sync";

type State = {
  tasks: Record<string, TaskState>;
  activeTaskId: string | null;
  lastUpload: PersistedTasksState["lastUpload"];
  isInitialized: boolean;
};

type Action =
  | { type: "INIT"; state: Omit<State, "isInitialized"> }
  | { type: "SET_ACTIVE_TASK"; taskId: string | null }
  | { type: "UPSERT_TASK"; task: TaskState }
  | { type: "MERGE_TASK"; taskId: string; updates: Partial<TaskState> }
  | { type: "REMOVE_TASK"; taskId: string }
  | { type: "APPEND_CONSOLE"; taskId: string; message: string }
  | { type: "SET_LAST_UPLOAD"; upload: PersistedTasksState["lastUpload"] };

const initialState: State = {
  tasks: {},
  activeTaskId: null,
  lastUpload: null,
  isInitialized: false,
};

function setActiveFlags(tasks: Record<string, TaskState>, activeTaskId: string | null): Record<string, TaskState> {
  let changed = false;
  const next: Record<string, TaskState> = { ...tasks };
  for (const [id, task] of Object.entries(next)) {
    const shouldBeActive = id === activeTaskId;
    if (task.isActive !== shouldBeActive) {
      next[id] = { ...task, isActive: shouldBeActive };
      changed = true;
    }
  }
  return changed ? next : tasks;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "INIT": {
      const nextTasks = setActiveFlags(action.state.tasks, action.state.activeTaskId);
      return {
        tasks: nextTasks,
        activeTaskId: action.state.activeTaskId,
        lastUpload: action.state.lastUpload,
        isInitialized: true,
      };
    }

    case "SET_ACTIVE_TASK": {
      const nextTasks = setActiveFlags(state.tasks, action.taskId);
      return { ...state, activeTaskId: action.taskId, tasks: nextTasks };
    }

    case "UPSERT_TASK": {
      const nextTasks = { ...state.tasks, [action.task.taskId]: action.task };
      const nextActive = action.task.isActive ? action.task.taskId : state.activeTaskId;
      return {
        ...state,
        activeTaskId: nextActive,
        tasks: setActiveFlags(nextTasks, nextActive),
      };
    }

    case "MERGE_TASK": {
      const existing = state.tasks[action.taskId];
      if (!existing) {
        const created = createTask({
          taskId: action.taskId,
          uploadedFilePath: (action.updates.uploadedFilePath as string) || "",
          originalFilename: (action.updates.originalFilename as string) || "",
          prompt: (action.updates.prompt as string) || "",
          ...action.updates,
        });
        const nextTasks = { ...state.tasks, [action.taskId]: created };
        return { ...state, tasks: nextTasks };
      }

      const merged: TaskState = {
        ...existing,
        ...action.updates,
        lastUpdated: Date.now(),
      };
      const nextTasks = { ...state.tasks, [action.taskId]: merged };
      return { ...state, tasks: nextTasks };
    }

    case "REMOVE_TASK": {
      if (!state.tasks[action.taskId]) return state;
      const nextTasks = { ...state.tasks };
      delete nextTasks[action.taskId];
      const nextActive = state.activeTaskId === action.taskId ? null : state.activeTaskId;
      return { ...state, activeTaskId: nextActive, tasks: setActiveFlags(nextTasks, nextActive) };
    }

    case "APPEND_CONSOLE": {
      const existing = state.tasks[action.taskId];
      if (!existing) return state;
      const nextMessages = [...(existing.consoleMessages || []), action.message].slice(-MAX_CONSOLE_MESSAGES);
      const merged: TaskState = {
        ...existing,
        consoleMessages: nextMessages,
        lastUpdated: Date.now(),
      };
      return { ...state, tasks: { ...state.tasks, [action.taskId]: merged } };
    }

    case "SET_LAST_UPLOAD":
      return { ...state, lastUpload: action.upload };
  }
}

type TaskContextValue = {
  tasks: Record<string, TaskState>;
  taskList: TaskState[];
  activeTaskId: string | null;
  activeTask: TaskState | null;
  lastUpload: PersistedTasksState["lastUpload"];

  addTask: (task: Omit<TaskState, "lastUpdated">) => void;
  updateTask: (taskId: string, updates: Partial<TaskState>) => void;
  removeTask: (taskId: string) => void;
  setActiveTask: (taskId: string | null) => void;
  setLastUpload: (upload: { filePath: string; originalFilename: string } | null) => void;
  clearAll: () => void;
  restore: () => Promise<void>;
};

const TaskContext = createContext<TaskContextValue | null>(null);

function chooseActiveTaskId(tasks: Record<string, TaskState>, preferred: string | null): string | null {
  if (preferred && tasks[preferred]) return preferred;
  // Default to "no active task" so restored/ghost running tasks don't hijack the UI.
  return null;
}

function sortTasksForUi(tasks: Record<string, TaskState>): TaskState[] {
  return Object.values(tasks).sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    return b.startTime - a.startTime;
  });
}

function shouldStopPolling(status: TaskStatus): boolean {
  return status !== "running";
}

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const tasksRef = useRef(state.tasks);
  useEffect(() => {
    tasksRef.current = state.tasks;
  }, [state.tasks]);

  // Persist (debounced) once initialized.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state.isInitialized) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      savePersistedState({
        tasks: state.tasks,
        activeTaskId: state.activeTaskId,
        lastUpload: state.lastUpload,
        version: PERSISTED_STATE_VERSION,
      });
    }, 300);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [state.tasks, state.activeTaskId, state.lastUpload, state.isInitialized]);

  // Cross-tab sync.
  const tabSyncRef = useRef<TabSync | null>(null);
  const messageFactoryRef = useRef(createTaskMessage());

  const applyRemoteMessage = useCallback((msg: TabSyncMessage) => {
    switch (msg.type) {
      case "TASK_STARTED": {
        const p = msg.payload as Partial<TaskState> | undefined;
        if (!p || !("taskId" in p) || typeof p.taskId !== "string") return;
        dispatch({ type: "MERGE_TASK", taskId: p.taskId, updates: p });
        break;
      }
      case "TASK_COMPLETED":
      case "TASK_PROGRESS":
      case "TASK_ERROR": {
        if (!msg.taskId || !msg.payload) return;
        dispatch({ type: "MERGE_TASK", taskId: msg.taskId, updates: msg.payload as Partial<TaskState> });
        break;
      }
      case "TASK_CANCELLED": {
        if (!msg.taskId) return;
        dispatch({ type: "MERGE_TASK", taskId: msg.taskId, updates: { status: "cancelled" } });
        break;
      }
      case "TASK_DELETED": {
        if (!msg.taskId) return;
        dispatch({ type: "REMOVE_TASK", taskId: msg.taskId });
        break;
      }
      case "FILE_UPLOADED": {
        const p = msg.payload as { uploadedFilePath: string; originalFilename: string } | undefined;
        if (!p?.uploadedFilePath) return;
        dispatch({
          type: "SET_LAST_UPLOAD",
          upload: { filePath: p.uploadedFilePath, originalFilename: p.originalFilename || "", timestamp: Date.now() },
        });
        break;
      }
      case "ACTIVE_TASK_CHANGED": {
        dispatch({ type: "SET_ACTIVE_TASK", taskId: msg.taskId || null });
        break;
      }
    }
  }, []);

  useEffect(() => {
    tabSyncRef.current = createTabSync(applyRemoteMessage);
    return () => {
      tabSyncRef.current?.close();
      tabSyncRef.current = null;
    };
  }, [applyRemoteMessage]);

  const broadcast = useCallback((message: Omit<TabSyncMessage, "timestamp" | "tabId">) => {
    tabSyncRef.current?.broadcast(message);
  }, []);

  // Restore/merge state (localStorage + backend history).
  const restore = useCallback(async () => {
    const persisted = loadPersistedState();

    let backendJobs: HistoryJob[] = [];
    try {
      const history = await getHistory();
      if (history.status === "success" && history.jobs) backendJobs = history.jobs;
    } catch {
      // ignore
    }

    const backendMap = new Map<string, HistoryJob>();
    for (const job of backendJobs) backendMap.set(job.task_id, job);

    const merged: Record<string, TaskState> = {};

    // 1) Add backend tasks
    for (const job of backendJobs) {
      const status = mapBackendStatus(job.status);
      const persistedTask = persisted?.tasks?.[job.task_id];

      // Running tasks: try to read current progress and/or catch finished state.
      let progress = 0;
      let finalStatus: TaskStatus = status;
      let runtime: number | undefined = job.runtime ?? undefined;
      let resultDir: string | undefined = job.result_dir || undefined;

      if (status === "running") {
        try {
          const p = await getTaskProgress(job.task_id);
          if (p.status === "success") {
            progress = p.progress || 0;
            if (p.state === "finished") {
              // Ensure we have result_dir/runtime
              const r = await getTaskResult(job.task_id);
              if (r.status === "success") {
                finalStatus = "completed";
                progress = 100;
                runtime = r.runtime ?? runtime;
                resultDir = r.result_dir ?? resultDir;
              } else if (r.status === "error") {
                finalStatus = "error";
              }
            } else if (p.state === "error") {
              finalStatus = "error";
            } else if (p.state === "cancelled") {
              finalStatus = "cancelled";
            }
          } else if (p.status === "error") {
            // Don't keep ghost "running" tasks if backend can't poll them.
            finalStatus = "error";
          }
        } catch {
          // If we can't poll a backend-running task, mark it as error to avoid "ghost running" UX.
          finalStatus = "error";
        }
      }

      const startTime = parseBackendTimestampMs(job.timestamp) ?? Date.now();

      const uploadedFilePath =
        persistedTask?.uploadedFilePath || (job.filename ? `/app/workspace/uploads/${job.filename}` : "");

      const task = createTask({
        taskId: job.task_id,
        uploadedFilePath,
        originalFilename: job.original_filename || job.filename || persistedTask?.originalFilename || "",
        prompt: persistedTask?.prompt || "",
        status: finalStatus,
        progress: finalStatus === "running" ? progress : finalStatus === "completed" ? 100 : 0,
        startTime,
        elapsedTime: finalStatus === "running" ? Math.max(0, Math.floor((Date.now() - startTime) / 1000)) : 0,
        runtime,
        resultDir,
        consoleMessages: persistedTask?.consoleMessages || [],
        isRestored: true,
        lastUpdated: Date.now(),
      });

      merged[job.task_id] = task;
    }

    // 2) Add persisted tasks not present in backend (recent only)
    if (persisted?.tasks) {
      for (const [taskId, task] of Object.entries(persisted.tasks)) {
        if (backendMap.has(taskId)) continue;

        const age = Date.now() - (task.lastUpdated || Date.now());
        if (task.status === "running" && age < STALE_TASK_THRESHOLD_MS) {
          merged[taskId] = {
            ...task,
            status: "error",
            errorMessage: "Task was lost during server restart",
            isRestored: true,
            lastUpdated: Date.now(),
          };
          continue;
        }

        if (task.status === "completed" && age < STALE_TASK_THRESHOLD_MS) {
          merged[taskId] = { ...task, isRestored: true, lastUpdated: Date.now() };
          continue;
        }

        // Older/stale tasks are dropped.
      }
    }

    // 3) Restore last upload (drop if stale)
    let restoredUpload = persisted?.lastUpload || null;
    if (restoredUpload) {
      const age = Date.now() - restoredUpload.timestamp;
      if (age > STALE_TASK_THRESHOLD_MS) restoredUpload = null;
    }

    // 4) Choose active task
    const activeTaskId = chooseActiveTaskId(merged, persisted?.activeTaskId || null);

    dispatch({
      type: "INIT",
      state: {
        tasks: merged,
        activeTaskId,
        lastUpload: restoredUpload,
      },
    });

    // Save merged state immediately (so other tabs can see up-to-date base).
    savePersistedState({
      tasks: setActiveFlags(merged, activeTaskId),
      activeTaskId,
      lastUpload: restoredUpload,
      version: PERSISTED_STATE_VERSION,
    });
  }, []);

  useEffect(() => {
    cleanupStaleTasks();
    restore();
  }, [restore]);

  // Polling + console WS for running tasks
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const wsEntries = useRef<
    Map<
      string,
      { ws: WebSocket; attempts: number; reconnectTimer: ReturnType<typeof setTimeout> | null }
    >
  >(new Map());
  const ensureConsoleWsRef = useRef<(taskId: string) => void>(() => {});

  const stopPolling = useCallback((taskId: string) => {
    const t = pollTimers.current.get(taskId);
    if (t) clearInterval(t);
    pollTimers.current.delete(taskId);
  }, []);

  const stopConsoleWs = useCallback((taskId: string) => {
    const entry = wsEntries.current.get(taskId);
    if (!entry) return;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    try {
      entry.ws.close();
    } catch {
      // ignore
    }
    wsEntries.current.delete(taskId);
    dispatch({ type: "MERGE_TASK", taskId, updates: { connectionStatus: "disconnected" } });
  }, []);

  const ensureConsoleWs = useCallback((taskId: string) => {
    const existing = wsEntries.current.get(taskId);
    if (existing && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const url = buildConsoleWsUrl(taskId);
    const prevAttempts = existing?.attempts ?? 0;
    if (prevAttempts >= 5) return;

    dispatch({ type: "MERGE_TASK", taskId, updates: { connectionStatus: "connecting" } });

    const ws = new WebSocket(url);
    const entry = { ws, attempts: prevAttempts, reconnectTimer: null as ReturnType<typeof setTimeout> | null };
    wsEntries.current.set(taskId, entry);

    ws.onopen = () => {
      dispatch({ type: "MERGE_TASK", taskId, updates: { connectionStatus: "connected" } });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === "log" && typeof data.content === "string") {
          dispatch({ type: "APPEND_CONSOLE", taskId, message: data.content });
        }
      } catch {
        if (typeof event.data === "string") {
          dispatch({ type: "APPEND_CONSOLE", taskId, message: event.data });
        }
      }
    };

    const scheduleReconnect = () => {
      const stillRunning = tasksRef.current[taskId]?.status === "running";
      if (!stillRunning) return;

      const nextAttempts = (wsEntries.current.get(taskId)?.attempts ?? 0) + 1;
      if (nextAttempts > 5) {
        dispatch({ type: "MERGE_TASK", taskId, updates: { connectionStatus: "disconnected" } });
        return;
      }

      const delayMs = Math.min(30_000, 1000 * Math.pow(2, nextAttempts - 1)) + Math.random() * 500;
      dispatch({ type: "MERGE_TASK", taskId, updates: { connectionStatus: "reconnecting" } });

      const current = wsEntries.current.get(taskId);
      if (!current) return;
      current.attempts = nextAttempts;
      current.reconnectTimer = setTimeout(() => {
        wsEntries.current.delete(taskId);
        ensureConsoleWsRef.current(taskId);
      }, delayMs);
    };

    ws.onerror = () => {
      // Errors typically lead to onclose; we keep state here minimal.
    };

    ws.onclose = () => {
      dispatch({ type: "MERGE_TASK", taskId, updates: { connectionStatus: "disconnected" } });
      scheduleReconnect();
    };
  }, []);

  useEffect(() => {
    ensureConsoleWsRef.current = ensureConsoleWs;
  }, [ensureConsoleWs]);

  const ensurePolling = useCallback((taskId: string) => {
    if (pollTimers.current.has(taskId)) return;

    const timer = setInterval(async () => {
      const current = tasksRef.current[taskId];
      if (!current || shouldStopPolling(current.status)) {
        stopPolling(taskId);
        return;
      }

      try {
        const p = await getTaskProgress(taskId);
        if (p.status !== "success") return;

        if (p.state === "finished") {
          stopPolling(taskId);
          const r = await getTaskResult(taskId);
          if (r.status === "success") {
            dispatch({
              type: "MERGE_TASK",
              taskId,
              updates: {
                status: "completed",
                progress: 100,
                runtime: r.runtime,
                resultDir: r.result_dir,
              },
            });
            broadcast(messageFactoryRef.current.taskCompleted({ ...current, status: "completed", resultDir: r.result_dir }));
          } else if (r.status === "error") {
            dispatch({ type: "MERGE_TASK", taskId, updates: { status: "error", errorMessage: r.message } });
            broadcast(messageFactoryRef.current.taskError(taskId, r.message || "Task failed"));
          }
          return;
        }

        if (p.state === "error") {
          stopPolling(taskId);
          dispatch({ type: "MERGE_TASK", taskId, updates: { status: "error", errorMessage: p.message } });
          broadcast(messageFactoryRef.current.taskError(taskId, p.message || "Task failed"));
          return;
        }

        if (p.state === "cancelled") {
          stopPolling(taskId);
          dispatch({ type: "MERGE_TASK", taskId, updates: { status: "cancelled" } });
          broadcast(messageFactoryRef.current.taskCancelled(taskId));
          return;
        }

        dispatch({ type: "MERGE_TASK", taskId, updates: { progress: p.progress || 0 } });
      } catch {
        // ignore poll errors
      }
    }, 2000);

    pollTimers.current.set(taskId, timer);
  }, [broadcast, stopPolling]);

  useEffect(() => {
    // Start/stop pollers and sockets based on current state.
    const runningTaskIds = new Set(
      Object.values(state.tasks)
        .filter((t) => t.status === "running")
        .map((t) => t.taskId),
    );

    // Stop resources for tasks that are no longer running or were removed.
    for (const taskId of pollTimers.current.keys()) {
      if (!runningTaskIds.has(taskId)) stopPolling(taskId);
    }
    for (const taskId of wsEntries.current.keys()) {
      if (!runningTaskIds.has(taskId)) stopConsoleWs(taskId);
    }

    // Ensure resources for running tasks.
    for (const taskId of runningTaskIds) {
      ensurePolling(taskId);
      ensureConsoleWs(taskId);
    }
  }, [state.tasks, ensurePolling, ensureConsoleWs, stopPolling, stopConsoleWs]);

  useEffect(() => {
    const pollTimersMap = pollTimers.current;
    const wsEntriesMap = wsEntries.current;

    return () => {
      pollTimersMap.forEach((t) => clearInterval(t));
      pollTimersMap.clear();

      wsEntriesMap.forEach((entry) => {
        if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
        try {
          entry.ws.close();
        } catch {
          // ignore
        }
      });
      wsEntriesMap.clear();
    };
  }, []);

  // Public actions (local + broadcast)
  const setActiveTask = useCallback(
    (taskId: string | null) => {
      dispatch({ type: "SET_ACTIVE_TASK", taskId });
      broadcast(messageFactoryRef.current.activeTaskChanged(taskId));
    },
    [broadcast],
  );

  const addTask = useCallback(
    (task: Omit<TaskState, "lastUpdated">) => {
      const t: TaskState = { ...task, lastUpdated: Date.now() };
      dispatch({ type: "UPSERT_TASK", task: t });
      broadcast(messageFactoryRef.current.taskStarted(t));
      if (t.isActive) broadcast(messageFactoryRef.current.activeTaskChanged(t.taskId));
    },
    [broadcast],
  );

  const updateTask = useCallback((taskId: string, updates: Partial<TaskState>) => {
    dispatch({ type: "MERGE_TASK", taskId, updates });
  }, []);

  const removeTask = useCallback(
    (taskId: string) => {
      dispatch({ type: "REMOVE_TASK", taskId });
      broadcast(messageFactoryRef.current.taskDeleted(taskId));
    },
    [broadcast],
  );

  const setLastUpload = useCallback(
    (upload: { filePath: string; originalFilename: string } | null) => {
      const next = upload ? { ...upload, timestamp: Date.now() } : null;
      dispatch({ type: "SET_LAST_UPLOAD", upload: next });
      if (next) broadcast(messageFactoryRef.current.fileUploaded(next.filePath, next.originalFilename));
    },
    [broadcast],
  );

  const clearAll = useCallback(() => {
    savePersistedState({
      tasks: {},
      activeTaskId: null,
      lastUpload: null,
      version: PERSISTED_STATE_VERSION,
    });
    dispatch({ type: "INIT", state: { tasks: {}, activeTaskId: null, lastUpload: null } });
  }, []);

  const value: TaskContextValue = useMemo(() => {
    const taskList = sortTasksForUi(state.tasks);
    const activeTask = state.activeTaskId ? state.tasks[state.activeTaskId] || null : null;
    return {
      tasks: state.tasks,
      taskList,
      activeTaskId: state.activeTaskId,
      activeTask,
      lastUpload: state.lastUpload,
      addTask,
      updateTask,
      removeTask,
      setActiveTask,
      setLastUpload,
      clearAll,
      restore,
    };
  }, [state.tasks, state.activeTaskId, state.lastUpload, addTask, updateTask, removeTask, setActiveTask, setLastUpload, clearAll, restore]);

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTasks must be used inside <TaskProvider />");
  return ctx;
}


