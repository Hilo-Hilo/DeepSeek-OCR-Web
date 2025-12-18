import {
  MAX_CONSOLE_MESSAGES,
  PersistedTasksState,
  PERSISTED_STATE_VERSION,
  STORAGE_KEYS,
  STALE_TASK_THRESHOLD_MS,
  TaskState,
} from "@/features/tasks/types";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadPersistedState(): PersistedTasksState | null {
  if (!isBrowser()) return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.TASKS);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as PersistedTasksState;
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.version !== PERSISTED_STATE_VERSION) {
      // Version mismatch — clear to avoid undefined behavior.
      window.localStorage.removeItem(STORAGE_KEYS.TASKS);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedState(state: PersistedTasksState): void {
  if (!isBrowser()) return;
  try {
    // Limit console messages before saving (keeps localStorage small).
    const limitedTasks: Record<string, TaskState> = {};
    for (const [id, task] of Object.entries(state.tasks)) {
      limitedTasks[id] = {
        ...task,
        consoleMessages: (task.consoleMessages || []).slice(-MAX_CONSOLE_MESSAGES),
      };
    }

    const toSave: PersistedTasksState = {
      ...state,
      tasks: limitedTasks,
    };

    window.localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(toSave));
  } catch {
    // ignore
  }
}

/**
 * Remove stale tasks from localStorage (best-effort).
 *
 * Returns number of removed tasks.
 */
export function cleanupStaleTasks(): number {
  if (!isBrowser()) return 0;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.TASKS);
    if (!stored) return 0;

    const data = JSON.parse(stored) as PersistedTasksState;
    if (!data?.tasks) return 0;

    const now = Date.now();
    let removedCount = 0;
    const cleaned: Record<string, TaskState> = {};

    for (const [taskId, task] of Object.entries(data.tasks)) {
      const age = now - (task.lastUpdated || now);
      // Keep recent tasks; allow completed tasks to stick around for a week.
      const keep =
        age < STALE_TASK_THRESHOLD_MS ||
        (task.status === "completed" && age < STALE_TASK_THRESHOLD_MS * 7);

      if (keep) cleaned[taskId] = task;
      else removedCount++;
    }

    const next: PersistedTasksState = {
      ...data,
      tasks: cleaned,
      activeTaskId: data.activeTaskId && cleaned[data.activeTaskId] ? data.activeTaskId : null,
    };

    window.localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(next));
    return removedCount;
  } catch {
    return 0;
  }
}



