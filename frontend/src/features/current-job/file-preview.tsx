"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Maximize2, Minimize2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { PreviewNode } from "@/features/current-job/file-explorer";

type Props = {
  file: PreviewNode | null;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
};

export function FilePreview({ file, isExpanded, onToggleExpand }: Props) {
  const [isImageExpanded, setIsImageExpanded] = useState(false);

  // Revoke blob URLs when file changes/unmounts (prevents memory leaks).
  useEffect(() => {
    const url = file?.content;
    const isBlobUrl = typeof url === "string" && url.startsWith("blob:");
    const shouldRevoke = isBlobUrl && (file?.fileType === "image" || file?.fileType === "pdf");
    return () => {
      if (shouldRevoke && url) URL.revokeObjectURL(url);
    };
  }, [file?.content, file?.fileType]);

  const header = (
    <div className="px-4 py-3 border-b flex items-center justify-between flex-shrink-0">
      <h3 className="text-sm font-medium text-foreground truncate">{file?.name || "OCR Result Preview"}</h3>
      {onToggleExpand && (
        <Button
          onClick={onToggleExpand}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          title={isExpanded ? "Minimize preview" : "Maximize preview"}
        >
          {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );

  if (!file || file.type === "folder") {
    return (
      <div className="rounded-xl border bg-background overflow-hidden h-full flex flex-col">
        {header}
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <FileText className="h-12 w-12 mx-auto mb-2 opacity-60" />
            <p className="text-sm">Select a file to preview</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border bg-background overflow-hidden h-full flex flex-col">
        {header}

        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full w-full">
            <div className="p-6">
              {file.fileType === "markdown" && file.content && (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={{
                      img: ({ ...props }) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          {...props}
                          className="max-w-full h-auto rounded-lg border my-4"
                          alt={props.alt || ""}
                        />
                      ),
                      pre: ({ children, ...props }) => (
                        <pre
                          className="bg-zinc-950 text-zinc-100 rounded-lg p-4 overflow-x-auto my-4"
                          {...props}
                        >
                          {children}
                        </pre>
                      ),
                      code: ({ className, children, ...props }) => {
                        const isBlock =
                          typeof className === "string" && className.includes("language-");
                        return isBlock ? (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        ) : (
                          <code className="bg-muted px-1 py-0.5 rounded text-sm" {...props}>
                            {children}
                          </code>
                        );
                      },
                      table: ({ ...props }) => (
                        <div className="overflow-x-auto my-4">
                          <table className="min-w-full border" {...props} />
                        </div>
                      ),
                      th: ({ ...props }) => <th className="px-3 py-2 bg-muted border text-left" {...props} />,
                      td: ({ ...props }) => <td className="px-3 py-2 border" {...props} />,
                      a: ({ ...props }) => (
                        <a className="text-emerald-700 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />
                      ),
                    }}
                  >
                    {file.content}
                  </ReactMarkdown>
                </div>
              )}

              {file.fileType === "image" && file.content && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.content}
                  alt={file.name}
                  className="max-w-full h-auto rounded-lg border cursor-pointer hover:opacity-95 transition"
                  onClick={() => setIsImageExpanded(true)}
                  title="Click to view full size"
                />
              )}

              {file.fileType === "pdf" && file.content && (
                <div className="w-full">
                  <iframe
                    src={file.content}
                    className="w-full h-[calc(100vh-320px)] min-h-[560px] rounded-lg border bg-white"
                    title={file.name}
                  />
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Tip: you can scroll, zoom, and navigate within the PDF viewer
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {file.fileType === "image" && file.content && (
        <Dialog open={isImageExpanded} onOpenChange={setIsImageExpanded}>
          <DialogContent className="max-w-none w-screen h-screen p-0 bg-black/90 border-0">
            <DialogTitle className="sr-only">Image Preview</DialogTitle>
            <DialogDescription className="sr-only">Full screen view of {file.name}</DialogDescription>
            <button
              onClick={() => setIsImageExpanded(false)}
              className="absolute top-6 right-6 z-50 bg-white/15 hover:bg-white/25 text-white rounded-full p-2 transition backdrop-blur"
              title="Close"
            >
              <X className="h-6 w-6" />
            </button>
            <div className="w-full h-full flex items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={file.content} alt={file.name} className="max-w-[90vw] max-h-[90vh] object-contain" />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}


