"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDownIcon,
  Clock,
  Download,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  SortAsc,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useBackendHealth, getHealthColor, getHealthMessage } from "@/features/backend-health/use-backend-health";
import { ActiveTasksPanel } from "@/features/current-job/active-tasks-panel";
import { useTasks } from "@/features/tasks/task-store";
import { buildDownloadZipUrl, cancelTask, deleteTask, getHistory, type HistoryJob, type ZipFormat } from "@/lib/backend-api";
import { parseBackendTimestampMs } from "@/features/tasks/types";
import { Progress } from "@/components/ui/progress";
import { ModeToggle } from "@/components/mode-toggle";

type SortOption = "newest" | "oldest" | "status" | "runtime";

function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "N/A";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatDate(timestamp: string): string {
  try {
    const ms = parseBackendTimestampMs(timestamp) ?? new Date(timestamp).getTime();
    const date = new Date(ms);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return timestamp;
  }
}

function displayName(job: HistoryJob): string {
  if (job.original_filename?.trim()) return job.original_filename;
  if (job.filename?.trim()) return job.filename;
  return `Task ${job.task_id}`;
}

function jobIcon(job: HistoryJob) {
  const name = job.original_filename || job.filename || "";
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileText className="h-5 w-5 text-red-600" />;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext || "")) return <ImageIcon className="h-5 w-5 text-blue-600" />;
  return <FileIcon className="h-5 w-5 text-muted-foreground" />;
}

function statusBadge(status: string) {
  switch ((status || "").toLowerCase()) {
    case "finished":
      return (
        <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
          Completed
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20">
          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          Running
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5" />
          Error
        </span>
      );
    case "cancelled":
      return (
        <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-zinc-50 text-zinc-600 ring-1 ring-inset ring-zinc-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 mr-1.5" />
          Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-zinc-50 text-zinc-600 ring-1 ring-inset ring-zinc-500/20">
          {status}
        </span>
      );
  }
}

export function HistoryPage() {
  const { tasks, activeTaskId, setActiveTask, removeTask, updateTask } = useTasks();
  const { health, responseTime, error: healthError } = useBackendHealth();

  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [cancellingTasks, setCancellingTasks] = useState<Set<string>>(new Set());

  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getHistory();
      if (res.status === "success") setJobs(res.jobs || []);
      else toast.error("Failed to load history", { description: res.message || "Unknown error" });
    } catch {
      toast.error("Failed to load history");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const interval = setInterval(() => {
      const hasRunning = jobsRef.current.some((j) => (j.status || "").toLowerCase() === "running");
      if (hasRunning) fetchHistory();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  const sortedJobs = useMemo(() => {
    const sorted = [...jobs];
    switch (sortBy) {
      case "newest":
        return sorted.sort(
          (a, b) => (parseBackendTimestampMs(b.timestamp) ?? 0) - (parseBackendTimestampMs(a.timestamp) ?? 0),
        );
      case "oldest":
        return sorted.sort(
          (a, b) => (parseBackendTimestampMs(a.timestamp) ?? 0) - (parseBackendTimestampMs(b.timestamp) ?? 0),
        );
      case "status": {
        const order: Record<string, number> = { running: 0, finished: 1, error: 2, cancelled: 3 };
        return sorted.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
      }
      case "runtime":
        return sorted.sort((a, b) => (b.runtime ?? 0) - (a.runtime ?? 0));
      default:
        return sorted;
    }
  }, [jobs, sortBy]);

  const runningCount = jobs.filter((j) => (j.status || "").toLowerCase() === "running").length;

  const handleDownloadZip = (taskId: string, format: ZipFormat) => {
    const url = buildDownloadZipUrl(taskId, format);
    toast.info("Starting download...", { description: `Preparing ${format} zip` });

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `ocr_results_${taskId}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
        toast.success("Download complete", { description: a.download });
      })
      .catch((err) => toast.error("Download failed", { description: err?.message || "Unknown error" }));
  };

  const handleCancel = async (taskId: string) => {
    setCancellingTasks((prev) => new Set(prev).add(taskId));
    try {
      const res = await cancelTask(taskId);
      if (res.status === "success") {
        toast.success("Task cancelled");
        updateTask(taskId, { status: "cancelled" });
        fetchHistory();
      } else {
        toast.error("Failed to cancel task", { description: res.message || "Unknown error" });
      }
    } catch {
      toast.error("Failed to cancel task");
    } finally {
      setCancellingTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm("Delete this task? This will remove all result files.")) return;
    try {
      const res = await deleteTask(taskId);
      if (res.status === "success") toast.success("Task deleted");
      else toast.error("Failed to delete task", { description: res.message || "Unknown error" });
    } catch {
      toast.error("Failed to delete task");
    } finally {
      // Also remove locally if present (active tasks panel uses local state)
      removeTask(taskId);
      fetchHistory();
    }
  };

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: "newest", label: "Newest First" },
    { value: "oldest", label: "Oldest First" },
    { value: "status", label: "By Status" },
    { value: "runtime", label: "By Runtime" },
  ];

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
              className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background/60 transition"
            >
              Current Job
            </Link>
            <Link href="/history" className="px-3 py-1.5 rounded-md text-sm font-medium bg-background shadow-sm" aria-current="page">
              History
            </Link>
          </nav>

          <div className="w-[160px] flex justify-end flex-shrink-0">
            <ActiveTasksPanel
              tasks={tasks}
              activeTaskId={activeTaskId}
              onSelectTask={(id) => setActiveTask(id)}
              onCancelTask={async (id) => {
                await cancelTask(id);
                updateTask(id, { status: "cancelled" });
              }}
              onDeleteTask={async (id) => {
                try {
                  await deleteTask(id);
                } finally {
                  removeTask(id);
                }
              }}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-6">
        <div className="rounded-2xl border bg-background overflow-hidden h-[calc(100vh-120px)] flex flex-col">
          <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold">Job History</h2>
              {runningCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                  {runningCount} running
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center h-8 px-3 text-xs font-medium border rounded-md bg-background hover:bg-muted transition">
                    <SortAsc className="h-3.5 w-3.5 mr-1.5" />
                    {sortOptions.find((o) => o.value === sortBy)?.label}
                    <ChevronDownIcon className="h-3 w-3 ml-1.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {sortOptions.map((o) => (
                    <DropdownMenuItem key={o.value} onSelect={() => setSortBy(o.value)} className="cursor-pointer">
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={fetchHistory} disabled={isLoading} title="Refresh">
                <RefreshCw className={["h-4 w-4", isLoading ? "animate-spin" : ""].join(" ")} />
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <ScrollArea className="h-full w-full">
              {isLoading && jobs.length === 0 ? (
                <div className="flex items-center justify-center h-full min-h-[300px] text-muted-foreground">
                  <div className="text-center">
                    <RefreshCw className="h-10 w-10 mx-auto mb-3 opacity-60 animate-spin" />
                    <p className="text-sm font-medium">Loading history...</p>
                  </div>
                </div>
              ) : sortedJobs.length > 0 ? (
                <div className="p-4 space-y-3">
                  {sortedJobs.map((job) => (
                    <div
                      key={job.task_id}
                      className={[
                        "rounded-xl border p-4 transition hover:shadow-sm",
                        job.status === "running"
                          ? "border-blue-200 bg-blue-50/30"
                          : job.status === "error"
                            ? "border-red-200 bg-red-50/20"
                            : "hover:bg-muted/20",
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-3">
                        <div className={["flex-shrink-0 p-2 rounded-lg", job.status === "running" ? "bg-blue-100" : "bg-muted"].join(" ")}>
                          {jobIcon(job)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold truncate" title={displayName(job)}>
                                {displayName(job)}
                              </h3>
                              <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDate(job.timestamp)}
                                </span>
                                {job.runtime !== null && job.status !== "running" && <span>{formatTime(job.runtime)}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {job.status === "running" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancel(job.task_id)}
                                  disabled={cancellingTasks.has(job.task_id)}
                                  className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                                  title="Cancel task"
                                >
                                  {cancellingTasks.has(job.task_id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                                </Button>
                              )}

                              {job.status === "finished" && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button className="inline-flex items-center justify-center h-8 px-2.5 text-sm font-medium border rounded-md bg-background hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition">
                                      <Download className="h-4 w-4 mr-1" />
                                      <ChevronDownIcon className="h-3 w-3" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="min-w-[160px]">
                                    <DropdownMenuItem onSelect={() => handleDownloadZip(job.task_id, "mmd")} className="cursor-pointer">
                                      Download as .mmd
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleDownloadZip(job.task_id, "md")} className="cursor-pointer">
                                      Download as .md
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleDownloadZip(job.task_id, "txt")} className="cursor-pointer">
                                      Download as .txt
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDelete(job.task_id)}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                title="Delete task"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="mt-3">{statusBadge(job.status)}</div>

                          {(job.status || "").toLowerCase() === "running" && typeof job.progress === "number" && (
                            <div className="mt-3">
                              <Progress value={job.progress} className="h-1.5" />
                              <div className="text-[10px] text-muted-foreground mt-1 text-right">{job.progress}%</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full min-h-[300px] text-muted-foreground">
                  <div className="text-center">
                    <Clock className="h-10 w-10 mx-auto mb-3 opacity-60" />
                    <p className="text-sm font-medium">No job history yet</p>
                    <p className="text-xs mt-1.5">Completed jobs will appear here</p>
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </main>
    </div>
  );
}


