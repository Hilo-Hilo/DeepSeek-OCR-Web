"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TaskState, TaskStatus } from "@/features/tasks/types";

function statusColor(status: TaskStatus): string {
  switch (status) {
    case "running":
      return "bg-blue-500";
    case "completed":
      return "bg-emerald-500";
    case "error":
      return "bg-red-500";
    case "cancelled":
      return "bg-zinc-500";
    case "pending":
      return "bg-yellow-500";
    case "uploading":
      return "bg-purple-500";
    default:
      return "bg-zinc-400";
  }
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "error":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "pending":
      return "Pending";
    case "uploading":
      return "Uploading";
    default:
      return "Unknown";
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function TaskCard({
  task,
  isActive,
  onSelect,
  onCancel,
  onDelete,
}: {
  task: TaskState;
  isActive: boolean;
  onSelect: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState<"cancel" | "delete" | null>(null);

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy("cancel");
    try {
      await onCancel();
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy("delete");
    try {
      await onDelete();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      onClick={onSelect}
      className={[
        "p-3 rounded-lg border cursor-pointer transition hover:shadow-sm",
        isActive
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
          : "border-border bg-card hover:bg-muted/40",
      ].join(" ")}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={["w-2 h-2 rounded-full", statusColor(task.status), task.status === "running" ? "animate-pulse" : ""].join(" ")} />
          <span className="text-sm font-medium truncate" title={task.originalFilename || task.taskId}>
            {task.originalFilename || `Task ${task.taskId}`}
          </span>
          {task.isRestored && <span className="text-xs text-muted-foreground">(restored)</span>}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span>{statusLabel(task.status)}</span>
        <span>
          {typeof task.runtime === "number"
            ? formatTime(task.runtime)
            : task.status === "running"
              ? formatTime(Math.max(0, Math.floor((Date.now() - task.startTime) / 1000)))
              : "—"}
        </span>
      </div>

      {task.status === "running" && (
        <div className="mb-2">
          <Progress value={task.progress} className="h-1.5" />
          <div className="text-[10px] text-muted-foreground mt-1 text-right">{task.progress}%</div>
        </div>
      )}

      {task.status === "error" && task.errorMessage && (
        <div className="text-xs text-red-600 truncate mb-2" title={task.errorMessage}>
          {task.errorMessage}
        </div>
      )}

      <div className="flex gap-2">
        {task.status === "running" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs text-red-600 hover:text-red-700"
                  onClick={handleCancel}
                  disabled={busy === "cancel"}
                  title="Cancel task"
                >
                  {busy === "cancel" ? "..." : "Cancel"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel task</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {(task.status === "completed" || task.status === "error" || task.status === "cancelled") && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleDelete}
                  disabled={busy === "delete"}
                  title="Delete task"
                >
                  {busy === "delete" ? "..." : "Delete"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete task</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

export function ActiveTasksPanel({
  tasks,
  activeTaskId,
  onSelectTask,
  onCancelTask,
  onDeleteTask,
}: {
  tasks: Record<string, TaskState>;
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => Promise<void> | void;
  onDeleteTask: (taskId: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  const taskList = useMemo(() => {
    const list = Object.values(tasks);
    list.sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return b.startTime - a.startTime;
    });
    return list;
  }, [tasks]);

  const runningCount = taskList.filter((t) => t.status === "running").length;
  const totalCount = taskList.length;

  if (totalCount === 0) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="relative">
          <span className="mr-1">Tasks</span>
          <span
            className={[
              "absolute -top-1 -right-1 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center",
              runningCount > 0 ? "bg-blue-500 animate-pulse" : "bg-zinc-400",
            ].join(" ")}
          >
            {runningCount > 0 ? runningCount : totalCount}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[360px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Active Tasks
            {runningCount > 0 && <span className="text-sm font-normal text-muted-foreground">({runningCount} running)</span>}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-110px)] mt-4 pr-4">
          <div className="space-y-3">
            {taskList.map((t) => (
              <TaskCard
                key={t.taskId}
                task={t}
                isActive={t.taskId === activeTaskId}
                onSelect={() => {
                  onSelectTask(t.taskId);
                  setOpen(false);
                }}
                onCancel={() => onCancelTask(t.taskId)}
                onDelete={() => onDeleteTask(t.taskId)}
              />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}



