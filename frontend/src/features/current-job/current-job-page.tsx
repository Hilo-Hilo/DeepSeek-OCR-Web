"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ActiveTasksPanel } from "@/features/current-job/active-tasks-panel";
import { ConsoleOutput } from "@/features/current-job/console-output";
import { FileExplorer, type PreviewNode } from "@/features/current-job/file-explorer";
import { FilePreview } from "@/features/current-job/file-preview";
import { FileUploader } from "@/features/current-job/file-uploader";
import { PromptInput } from "@/features/current-job/prompt-input";
import { useBackendHealth, getHealthColor, getHealthMessage } from "@/features/backend-health/use-backend-health";
import { useTasks } from "@/features/tasks/task-store";
import { createTask } from "@/features/tasks/types";
import { cancelTask, deleteTask, startTask, uploadFile } from "@/lib/backend-api";
import { ModeToggle } from "@/components/mode-toggle";

const DEFAULT_PROMPT = "<image>\n<|grounding|>Convert the document to markdown.";

export function CurrentJobPage() {
  const { tasks, activeTask, activeTaskId, addTask, updateTask, removeTask, setActiveTask, lastUpload, setLastUpload } =
    useTasks();

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<PreviewNode | null>(null);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<number | undefined>(undefined);

  const { health, responseTime, error: healthError } = useBackendHealth();

  const isProcessing = activeTask?.status === "running";
  const parseCompleted = activeTask?.status === "completed";
  const resultDir = activeTask?.resultDir || "";
  const taskId = activeTask?.taskId || "";
  const consoleMessages = activeTask?.consoleMessages || [];

  const runningTaskId = activeTask?.status === "running" ? activeTask.taskId : null;
  const runningTaskStartTime = activeTask?.status === "running" ? activeTask.startTime : null;

  // Keep the prompt in sync when the user selects a different task (doesn't overwrite in-place edits).
  useEffect(() => {
    if (!activeTask?.taskId) return;
    if (activeTask.prompt && activeTask.prompt.trim()) {
      setPrompt(activeTask.prompt);
    }
  }, [activeTask?.taskId]);

  useEffect(() => {
    if (!runningTaskId || runningTaskStartTime === null) return;

    const startTime = runningTaskStartTime;
    const tick = () => {
        setElapsedTime(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
    };

    const initial = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [runningTaskId, runningTaskStartTime]);

  const recoveredCandidate = useMemo(() => {
    if (lastUpload?.filePath && lastUpload.originalFilename) {
      return { filePath: lastUpload.filePath, originalFilename: lastUpload.originalFilename, source: "lastUpload" as const };
    }

    // Suggest the active task's input file when no lastUpload is present.
    if (activeTask?.uploadedFilePath) {
      const name =
        activeTask.originalFilename ||
        activeTask.uploadedFilePath.split("/").pop() ||
        "uploaded_file";
      return { filePath: activeTask.uploadedFilePath, originalFilename: name, source: "suggestion" as const };
    }

    // Fallback: most recent task that has an input file path.
    const recent = Object.values(tasks)
      .filter((t) => !!t.uploadedFilePath)
      .sort((a, b) => b.startTime - a.startTime)[0];

    if (recent?.uploadedFilePath) {
      const name =
        recent.originalFilename ||
        recent.uploadedFilePath.split("/").pop() ||
        "uploaded_file";
      return { filePath: recent.uploadedFilePath, originalFilename: name, source: "suggestion" as const };
    }

    return null;
  }, [activeTask?.originalFilename, activeTask?.uploadedFilePath, lastUpload?.filePath, lastUpload?.originalFilename, tasks]);

  const handleFileChange = async (file: File | null) => {
    setUploadedFile(file);
    setSelectedPreviewFile(null);

    if (!file) {
      setIsUploading(false);
      // Clearing selection should also clear the active backend file reference.
      setLastUpload(null);
      return;
    }

    try {
      setIsUploading(true);
      // Prevent starting a task with a stale previous upload while a new upload is in-flight.
      setLastUpload(null);

      const res = await uploadFile(file);
      if (res.status === "success") {
        const original = res.original_filename || file.name;
        setLastUpload({ filePath: res.file_path, originalFilename: original });
        toast.success("File uploaded", { description: original });
      } else {
        toast.error("Upload failed", { description: res.message || "Unknown error" });
      }
    } catch {
      toast.error("Upload failed", { description: "Unable to connect to backend service" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleStart = async () => {
    if (isUploading) {
      toast.error("File is still uploading. Please wait…");
      return;
    }
    if (!lastUpload) {
      toast.error("Please upload a file first");
      return;
    }

    try {
      const res = await startTask({
        filePath: lastUpload.filePath,
        prompt,
        originalFilename: lastUpload.originalFilename,
      });

      if (res.status === "running" && res.task_id) {
        const newTask = createTask({
          taskId: res.task_id,
          uploadedFilePath: lastUpload.filePath,
          originalFilename: lastUpload.originalFilename,
          prompt,
          status: "running",
          isActive: true,
        });
        addTask(newTask);
        toast.info("Processing started", { description: `Task ${res.task_id} is running` });
      } else {
        const msg = "message" in res ? res.message : undefined;
        toast.error("Failed to start processing", { description: msg || "Unknown error" });
      }
    } catch {
      toast.error("Failed to start processing", { description: "Unable to connect to backend service" });
    }
  };

  const cancelById = useCallback(
    async (id: string) => {
      try {
        const res = await cancelTask(id);
        if (res.status === "success") {
          updateTask(id, { status: "cancelled" });
          toast.info("Task cancelled");
        } else {
          toast.error("Failed to cancel task", { description: res.message || "Unknown error" });
        }
      } catch {
        toast.error("Failed to cancel task");
      }
    },
    [updateTask],
  );

  const deleteById = useCallback(
    async (id: string) => {
      try {
        const res = await deleteTask(id);
        if (res.status === "success") {
          removeTask(id);
          toast.success("Task deleted");
        } else {
          // Still remove locally if backend fails (matches old behavior)
          removeTask(id);
          toast.error("Failed to delete task", { description: res.message || "Removed locally" });
        }
      } catch {
        removeTask(id);
        toast.error("Failed to delete task", { description: "Removed locally" });
      }
    },
    [removeTask],
  );

  const handleSelectTask = useCallback(
    (id: string) => {
      setActiveTask(id);
      setSelectedPreviewFile(null);
    },
    [setActiveTask],
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-background/80 backdrop-blur border-b sticky top-0 z-10">
        <div className="container mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="text-lg font-semibold truncate">
              DeepSeek OCR
            </Link>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-muted">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getHealthColor(health) }} />
                    <span className="text-xs text-muted-foreground">
                      {health === "online" ? "Online" : health === "degraded" ? "Slow" : "Offline"}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{getHealthMessage(health, responseTime, healthError)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ModeToggle />
          </div>

          <nav className="flex items-center gap-1 bg-muted rounded-lg p-1 flex-shrink-0">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-background shadow-sm"
              aria-current="page"
            >
              Current Job
            </Link>
            <Link
              href="/history"
              className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background/60 transition"
            >
              History
            </Link>
          </nav>

          <div className="w-[160px] flex justify-end flex-shrink-0">
            <ActiveTasksPanel
              tasks={tasks}
              activeTaskId={activeTaskId}
              onSelectTask={handleSelectTask}
              onCancelTask={cancelById}
              onDeleteTask={deleteById}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-120px)]">
          <div className="flex flex-col min-h-0">
            <FileUploader
              onFileChange={handleFileChange}
              initialFile={uploadedFile}
              recoveredFilePath={recoveredCandidate?.filePath}
              recoveredFileName={recoveredCandidate?.originalFilename}
              autoUseRecovered={recoveredCandidate?.source === "lastUpload"}
              onRecoveredFileAccept={() => {
                if (!recoveredCandidate) return;
                setLastUpload({ filePath: recoveredCandidate.filePath, originalFilename: recoveredCandidate.originalFilename });
                toast.info("Using uploaded file", { description: recoveredCandidate.originalFilename });
              }}
              onRecoveredFileValidated={(ok) => {
                // If the *selected* persisted upload no longer exists on the backend, clear it to avoid start failures.
                if (!ok && lastUpload?.filePath && recoveredCandidate?.source === "lastUpload") {
                  setLastUpload(null);
                }
              }}
            />
          </div>

          <div className="flex flex-col gap-4 min-h-0">
            <div
              className={[
                "flex gap-4 flex-shrink-0 transition-all duration-300 overflow-hidden",
                isPreviewExpanded ? "h-0 opacity-0" : "h-[320px] opacity-100",
              ].join(" ")}
            >
              <div className="flex-1 min-h-0">
                <PromptInput
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  onStart={handleStart}
                  onCancel={activeTask?.taskId ? () => cancelById(activeTask.taskId) : undefined}
                  isProcessing={isProcessing}
                  hasFile={!!lastUpload && !isUploading}
                  progress={isProcessing ? activeTask?.progress : undefined}
                  elapsedTime={isProcessing ? elapsedTime : undefined}
                  totalRuntime={activeTask?.runtime ?? null}
                  taskId={taskId || undefined}
                  isRestored={activeTask?.isRestored}
                />
              </div>

              <div className="w-[340px] min-h-0">
                <FileExplorer
                  onFileSelect={setSelectedPreviewFile}
                  selectedFile={selectedPreviewFile}
                  parseCompleted={parseCompleted}
                  resultDir={resultDir}
                  taskId={taskId || undefined}
                />
              </div>
            </div>

            {isProcessing && (
              <div className="h-[160px] flex-shrink-0">
                <ConsoleOutput messages={consoleMessages} />
              </div>
            )}

            {activeTask?.isRestored && activeTask?.status === "running" && (
              <div className="rounded-lg border bg-blue-50 text-blue-800 px-4 py-2 text-sm">
                Restored from previous session — tracking in-progress task
              </div>
            )}

            <div className="flex-1 min-h-0">
              <FilePreview
                file={selectedPreviewFile}
                isExpanded={isPreviewExpanded}
                onToggleExpand={() => setIsPreviewExpanded((v) => !v)}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}


