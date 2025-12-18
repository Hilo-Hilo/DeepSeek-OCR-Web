"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Folder,
  Image as ImageIcon,
  FileType,
  ChevronDownIcon,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getFileBlob, getFileText, getFolder, buildDownloadZipUrl, type FolderNode } from "@/lib/backend-api";
import { fixMarkdownImages, stripOcrTags } from "@/features/current-job/markdown-utils";

export type PreviewFileType = "markdown" | "image" | "pdf";

export type PreviewNode = {
  name: string;
  type: "folder" | "file";
  fileType?: PreviewFileType;
  content?: string; // markdown text or blob URL for image/pdf
  path?: string; // backend absolute path for files
  resultDir?: string;
  children?: PreviewNode[];
};

type Props = {
  parseCompleted: boolean;
  resultDir: string;
  taskId?: string;
  selectedFile: PreviewNode | null;
  onFileSelect: (file: PreviewNode) => void;
};

function detectFileType(fileName: string): PreviewFileType | undefined {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  if (ext === "md" || ext === "mmd" || ext === "txt") return "markdown";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return undefined;
}

function getFileIcon(fileType?: PreviewFileType) {
  switch (fileType) {
    case "markdown":
      return <FileText className="h-4 w-4 text-blue-600" />;
    case "image":
      return <ImageIcon className="h-4 w-4 text-emerald-600" />;
    case "pdf":
      return <FileType className="h-4 w-4 text-red-600" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground" />;
  }
}

export function FileExplorer({ parseCompleted, resultDir, taskId, selectedFile, onFileSelect }: Props) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [structure, setStructure] = useState<PreviewNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!parseCompleted || !resultDir) {
      setStructure([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await getFolder(resultDir);
        if (cancelled) return;
        if (res.status === "success" && res.children) {
          const convert = (node: FolderNode): PreviewNode => {
            const name = String(node.name || "");
            const type: "folder" | "file" = node.type === "folder" ? "folder" : "file";
            return {
              name,
              type,
              fileType: type === "file" ? detectFileType(name) : undefined,
              path: node.path,
              resultDir,
              children: node.children ? node.children.map(convert) : undefined,
            };
          };
          const converted = res.children.map(convert);
          setStructure(converted);

          // Auto-expand the first folder if present
          if (converted[0]?.type === "folder") {
            setExpandedFolders(new Set([converted[0].name]));
          }
        } else if (res.status === "error") {
          toast.error("Failed to load folder structure", { description: res.message || "Unknown error" });
        }
      } catch {
        if (!cancelled) toast.error("Failed to load folder structure");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parseCompleted, resultDir]);

  const toggleFolder = (folderKey: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  };

  const handleFileClick = async (node: PreviewNode) => {
    if (!node.path) return;
    try {
      if (node.fileType === "image" || node.fileType === "pdf") {
        const blob = await getFileBlob(node.path);
        const url = URL.createObjectURL(blob);
        onFileSelect({ ...node, content: url });
        return;
      }

      const text = await getFileText(node.path);
      const cleaned = fixMarkdownImages(stripOcrTags(text), node.resultDir || "");
      onFileSelect({ ...node, content: cleaned });
    } catch {
      toast.error("Failed to load file");
    }
  };

  const renderNode = (node: PreviewNode, level = 0, parentKey = ""): React.ReactNode => {
    const nodeKey = parentKey ? `${parentKey}/${node.name}` : node.name;
    const isExpanded = expandedFolders.has(nodeKey);
    const isSelected = selectedFile?.path && selectedFile.path === node.path;

    if (node.type === "folder") {
      return (
        <div key={nodeKey}>
          <button
            onClick={() => toggleFolder(nodeKey)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md hover:bg-muted/60 transition"
            style={{ paddingLeft: `${level * 16 + 12}px` }}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <Folder className="h-4 w-4 text-yellow-600" />
            <span className="text-sm truncate">{node.name}</span>
          </button>
          {isExpanded && node.children && <div>{node.children.map((c) => renderNode(c, level + 1, nodeKey))}</div>}
        </div>
      );
    }

    return (
      <button
        key={nodeKey}
        onClick={() => handleFileClick(node)}
        className={[
          "flex items-center gap-2 w-full px-3 py-2 rounded-md hover:bg-muted/60 transition",
          isSelected ? "bg-emerald-50 border-l-2 border-emerald-500" : "",
        ].join(" ")}
        style={{ paddingLeft: `${level * 16 + 36}px` }}
      >
        {getFileIcon(node.fileType)}
        <span className="text-sm truncate">{node.name}</span>
      </button>
    );
  };

  const canDownload = parseCompleted && !!taskId && structure.length > 0;

  const handleDownload = (format: "mmd" | "md" | "txt") => {
    if (!taskId) {
      toast.error("No task ID available");
      return;
    }

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
      .catch((err) => {
        toast.error("Download failed", { description: err?.message || "Unknown error" });
      });
  };

  return (
    <div className="rounded-xl border bg-background overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-medium">File Explorer</h3>

        {canDownload && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center h-8 px-2 text-sm rounded-md hover:bg-muted transition"
                title="Download all files"
              >
                <Download className="h-4 w-4 mr-1" />
                <ChevronDownIcon className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <button
                onClick={() => handleDownload("mmd")}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-md"
              >
                Download as .mmd
              </button>
              <button
                onClick={() => handleDownload("md")}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-md"
              >
                Download as .md
              </button>
              <button
                onClick={() => handleDownload("txt")}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-md"
              >
                Download as .txt
              </button>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full w-full">
          {isLoading ? (
            <div className="flex items-center justify-center h-full min-h-[200px] text-muted-foreground">
              <div className="text-center">
                <Folder className="h-10 w-10 mx-auto mb-2 opacity-60 animate-pulse" />
                <p className="text-sm">Loading file structure...</p>
              </div>
            </div>
          ) : parseCompleted && structure.length > 0 ? (
            <div className="p-2">{structure.map((n) => renderNode(n))}</div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[200px] text-muted-foreground">
              <div className="text-center">
                <Folder className="h-10 w-10 mx-auto mb-2 opacity-60" />
                {!taskId ? (
                  <p className="text-sm">Select a task to explore results</p>
                ) : parseCompleted ? (
                  <p className="text-sm">No result files found</p>
                ) : (
                  <p className="text-sm">Processing… results will appear here</p>
                )}
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}


