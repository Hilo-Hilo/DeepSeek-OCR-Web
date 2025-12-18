"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, RefreshCw, Trash2, Upload } from "lucide-react";
import { buildFileContentUrl, headFile } from "@/lib/backend-api";

type Props = {
  onFileChange: (file: File | null) => void;
  initialFile?: File | null;
  recoveredFilePath?: string;
  recoveredFileName?: string;
  /**
   * If true, a valid recovered file will be auto-selected & previewed.
   * If false, we only show the banner and require the user to click "Use this file".
   */
  autoUseRecovered?: boolean;
  onRecoveredFileAccept?: () => void;
  onRecoveredFileValidated?: (valid: boolean) => void;
};

type PreviewKind = "pdf" | "image" | null;

function guessPreviewKind(nameOrPath: string): PreviewKind {
  const lower = nameOrPath.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpg|jpeg|gif|webp)$/.test(lower)) return "image";
  return null;
}

export function FileUploader({
  onFileChange,
  initialFile,
  recoveredFilePath,
  recoveredFileName,
  autoUseRecovered = false,
  onRecoveredFileAccept,
  onRecoveredFileValidated,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [previewKind, setPreviewKind] = useState<PreviewKind>(null);
  const [usingRecovered, setUsingRecovered] = useState(false);

  const [showRecoveryOption, setShowRecoveryOption] = useState(false);
  const [isValidatingRecovery, setIsValidatingRecovery] = useState(false);
  const [recoveryValid, setRecoveryValid] = useState<boolean | null>(null);

  // Sync with parent-provided initial file (task switching)
  useEffect(() => {
    if (initialFile && initialFile !== selectedFile) {
      setSelectedFile(initialFile);
      setUsingRecovered(false);
      const url = URL.createObjectURL(initialFile);
      setPreviewUrl(url);
      setPreviewKind(initialFile.type === "application/pdf" ? "pdf" : "image");
    } else if (!initialFile && selectedFile) {
      setSelectedFile(null);
      setPreviewKind(null);
      setPreviewUrl("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const recoveredPreviewUrl = useMemo(() => {
    if (!recoveredFilePath) return "";
    return buildFileContentUrl(recoveredFilePath);
  }, [recoveredFilePath]);

  // Cleanup preview URL (object URLs only)
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Validate recovered upload on mount
  useEffect(() => {
    if (!recoveredFilePath || !recoveredFileName) return;
    if (selectedFile) return;

    let cancelled = false;
    (async () => {
      setIsValidatingRecovery(true);
      setShowRecoveryOption(true);
      try {
        const ok = await headFile(recoveredFilePath);
        if (cancelled) return;
        setRecoveryValid(ok);
        onRecoveredFileValidated?.(ok);
        if (ok && autoUseRecovered) {
          setUsingRecovered(true);
          setPreviewUrl(recoveredPreviewUrl);
          setPreviewKind(guessPreviewKind(recoveredFileName) || guessPreviewKind(recoveredFilePath || ""));
        }
      } catch {
        if (cancelled) return;
        setRecoveryValid(false);
        onRecoveredFileValidated?.(false);
      } finally {
        if (!cancelled) setIsValidatingRecovery(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    autoUseRecovered,
    onRecoveredFileValidated,
    recoveredFileName,
    recoveredFilePath,
    recoveredPreviewUrl,
    selectedFile,
  ]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;

    if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setShowRecoveryOption(false);
    setRecoveryValid(null);
    setUsingRecovered(false);
    setPreviewKind(file.type === "application/pdf" ? "pdf" : "image");

    setSelectedFile(file);
    onFileChange(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleDelete = () => {
    if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setUsingRecovered(false);
    setPreviewKind(null);
    setPreviewUrl("");
    setShowRecoveryOption(false);
    setRecoveryValid(null);
    onFileChange(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0] || null;
    if (!file) return;
    
    // Accept only supported types
    const validTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (!validTypes.includes(file.type)) return;

    if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setShowRecoveryOption(false);
    setRecoveryValid(null);
    setUsingRecovered(false);
    setPreviewKind(file.type === "application/pdf" ? "pdf" : "image");

    setSelectedFile(file);
    onFileChange(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Recovery banner */}
      {showRecoveryOption && (
        <div
          className={[
            "rounded-lg border p-3 transition-all duration-300 ease-in-out overflow-hidden",
            isValidatingRecovery
              ? "bg-muted border-border"
              : recoveryValid
              ? "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800/50"
              : "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800/50",
          ].join(" ")}
        >
          {isValidatingRecovery ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Checking previous upload...</span>
            </div>
          ) : recoveryValid ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 min-w-0">
                <Check className="h-4 w-4 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {usingRecovered ? "Using previous upload" : "Previous file available"}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 truncate">{recoveredFileName}</p>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    document.getElementById("file-input")?.click();
                  }}
                  className="h-7 text-xs bg-background/50"
                >
                  Upload new
                </Button>
                {!usingRecovered && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setUsingRecovered(true);
                      setPreviewUrl(recoveredPreviewUrl);
                      setPreviewKind(guessPreviewKind(recoveredFileName || "") || guessPreviewKind(recoveredFilePath || ""));
                      onRecoveredFileAccept?.();
                    }}
                    className="h-7 text-xs bg-blue-600 hover:bg-blue-700 dark:text-white"
                  >
                    Use this file
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="text-yellow-700 dark:text-yellow-400">
                <p className="text-sm font-medium">Previous file not found</p>
                <p className="text-xs text-yellow-600 dark:text-yellow-500">Please upload a new file</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowRecoveryOption(false);
                  setRecoveryValid(null);
                }}
                className="h-7 text-xs bg-background/50"
              >
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}

      <div 
        className="flex gap-2 flex-shrink-0"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <Button
          variant="outline"
          className="flex-1 h-12 border-dashed relative overflow-hidden group hover:border-primary hover:bg-muted/50 transition-colors"
          onClick={() => document.getElementById("file-input")?.click()}
        >
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <Upload className="mr-2 h-5 w-5" />
          Upload File (PDF / PNG / JPG) or Drag & Drop
        </Button>
        <input
          id="file-input"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12"
          onClick={handleDelete}
          disabled={!selectedFile && !usingRecovered}
          title="Clear selection"
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 rounded-xl border bg-background overflow-hidden">
        <ScrollArea className="h-full w-full">
          <div className="p-4">
            {previewUrl ? (
              <div className="flex items-center justify-center">
                {previewKind === "pdf" ? (
                  <div className="w-full">
                    <iframe
                      src={previewUrl}
                      className="w-full h-[calc(100vh-320px)] min-h-[560px] rounded-lg border bg-white"
                      title="PDF Preview"
                    />
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      Tip: you can scroll, zoom, and navigate within the PDF viewer
                    </p>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Preview" className="max-w-full h-auto rounded-lg border" />
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-[320px]">
                <div className="text-center text-muted-foreground">
                  <Upload className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Upload a file to preview</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}



