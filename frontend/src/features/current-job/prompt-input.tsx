"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Loader2, Sparkles, Square, Check, X } from "lucide-react";

type Props = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onStart: () => void;
  onCancel?: () => void;
  isProcessing: boolean;
  hasFile: boolean;
  progress?: number;
  elapsedTime?: number;
  totalRuntime?: number | null;
  taskId?: string;
  isRestored?: boolean;
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function PromptInput({
  prompt,
  onPromptChange,
  onStart,
  onCancel,
  isProcessing,
  hasFile,
  progress,
  elapsedTime,
  totalRuntime,
  taskId,
  isRestored,
}: Props) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancel = async () => {
    if (!onCancel) return;
    setIsCancelling(true);
    try {
      onCancel();
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="rounded-xl border bg-background p-4 mb-3 flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
          <span className="text-sm text-muted-foreground">Prompt</span>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsInfoOpen(true)}
            className="h-7 w-7 p-0"
            title="Prompt format guide"
          >
            <Info className="h-4 w-4" />
          </Button>

          {taskId && <span className="text-xs text-muted-foreground">Task: {taskId}</span>}
          {isRestored && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Restored</span>
          )}

          {totalRuntime !== null && totalRuntime !== undefined && (
            <span className="ml-auto text-xs font-medium text-emerald-700">
              Completed in {formatTime(totalRuntime)}
            </span>
          )}
        </div>

        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full w-full">
            <Textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              className="min-h-[140px] resize-none"
              placeholder="Enter your prompt..."
              disabled={isProcessing}
            />
          </ScrollArea>
        </div>
      </div>

      <div className="h-11 flex-shrink-0 flex gap-2">
        <Button
          onClick={onStart}
          disabled={!hasFile || isProcessing}
          className="flex-1 h-full"
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Processing
              {typeof progress === "number" ? ` ${Math.max(0, Math.min(100, Math.round(progress)))}%` : ""}
              {elapsedTime !== undefined ? ` (${formatTime(Math.max(0, elapsedTime))})` : "..."}
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-5 w-5" />
              Start Processing
            </>
          )}
        </Button>

        {isProcessing && onCancel && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleCancel}
                  disabled={isCancelling}
                  variant="outline"
                  className="h-full w-14"
                  title="Cancel task"
                >
                  {isCancelling ? <Loader2 className="h-5 w-5 animate-spin" /> : <Square className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel task</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {isProcessing && typeof progress === "number" && (
        <div className="mt-2">
          <Progress value={Math.max(0, Math.min(100, progress))} className="h-2" />
        </div>
      )}

      <Dialog open={isInfoOpen} onOpenChange={setIsInfoOpen}>
        <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[95vh] flex flex-col p-6">
          <DialogHeader className="flex-shrink-0 mb-4">
            <DialogTitle className="text-xl">Prompt Format Guide</DialogTitle>
            <DialogDescription className="text-base">
              Comprehensive guide to controlling DeepSeek OCR output.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden">
            <ScrollArea className="h-full w-full">
              <div className="space-y-12 pr-6 pb-6 max-w-5xl mx-auto">
                
                {/* 1. Basics & Structure */}
                <div className="space-y-8">
                  <div className="pb-4 border-b">
                    <h2 className="text-2xl font-bold tracking-tight">1. Basics & Structure</h2>
                    <p className="text-muted-foreground mt-1">Foundational concepts for every prompt.</p>
                  </div>

                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs">1</span>
                      The &lt;image&gt; Tag
                    </h3>
                    <div className="p-4 bg-muted/30 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-3">
                        DeepSeek OCR requires the <code>&lt;image&gt;</code> tag to know where the input image is logically placed. It must appear at the <strong>very beginning</strong> of your prompt.
                      </p>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start gap-2 text-sm">
                          <span className="text-emerald-600 font-bold shrink-0 flex items-center gap-1">
                            <Check className="h-4 w-4" /> Correct:
                          </span>
                          <code className="bg-zinc-950 text-zinc-100 px-2 py-0.5 rounded">&lt;image&gt; Transcribe this text.</code>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <span className="text-red-600 font-bold shrink-0 flex items-center gap-1">
                            <X className="h-4 w-4" /> Incorrect:
                          </span>
                          <code className="bg-zinc-950 text-zinc-100 px-2 py-0.5 rounded">Please read this &lt;image&gt;</code>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs">2</span>
                      Output Formats
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg border">
                        <h4 className="font-medium mb-2">Markdown (Default)</h4>
                        <p className="text-xs text-muted-foreground mb-3">
                          The model excels at producing GitHub Flavored Markdown. It will automatically detect headings, lists, bold/italic text, and code blocks.
                        </p>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">{`<image>
Convert the document into detailed markdown, preserving headings and lists.`}</pre>
                      </div>
                      <div className="p-4 rounded-lg border">
                        <h4 className="font-medium mb-2">Plain Text</h4>
                        <p className="text-xs text-muted-foreground mb-3">
                          If you need raw text without formatting, explicitly ask for "plain text". This strips bolding, tables, and headers.
                        </p>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">{`<image>
Transcribe the text content only as plain text. Do not use markdown syntax.`}</pre>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs">3</span>
                      Language & Handwriting
                    </h3>
                    <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-2">
                      <li><strong>Multi-language:</strong> The model automatically detects languages (English, Chinese, French, etc.). You don't usually need to specify the language unless it's ambiguous.</li>
                      <li><strong>Handwriting:</strong> DeepSeek OCR is robust against handwriting. To improve accuracy on messy notes, append "Include handwritten annotations" to your prompt.</li>
                      <li><strong>Math/Latex:</strong> For academic papers, the model naturally outputs LaTeX equations (e.g., <code>$E=mc^2$</code>).</li>
                    </ul>
                  </section>
                </div>

                {/* 2. Advanced (JSON, Tables) */}
                <div className="space-y-8 pt-8 border-t">
                  <div className="pb-4 border-b">
                    <h2 className="text-2xl font-bold tracking-tight">2. Advanced (JSON, Tables)</h2>
                    <p className="text-muted-foreground mt-1">Techniques for structured data extraction.</p>
                  </div>

                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs">1</span>
                      Grounding & Bounding Boxes
                    </h3>
                    <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <code className="text-sm bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">&lt;|grounding|&gt;</code>
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase">Power Feature</span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Adding this tag tells the model to perform <strong>layout analysis</strong>. It will understand spatial relationships, which is critical for multi-column documents, complex tables, and forms.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <strong>When to use:</strong> Always recommended for anything more complex than a simple paragraph of text.
                      </p>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs">2</span>
                      JSON Extraction
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      You can force the model to output structured data by providing a schema or list of keys.
                    </p>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="border rounded-lg p-4">
                        <h4 className="font-medium text-sm mb-2">Prompt Template</h4>
                        <pre className="text-xs bg-zinc-950 text-zinc-100 p-3 rounded overflow-x-auto">{`<image>
<|grounding|>
Extract the following fields into a JSON object:
- invoice_number (string)
- date (YYYY-MM-DD)
- total_amount (number)
- items (array of objects with description, quantity, price)`}</pre>
                      </div>
                      <div className="border rounded-lg p-4 bg-muted/20">
                        <h4 className="font-medium text-sm mb-2">Expected Output</h4>
                        <pre className="text-xs text-muted-foreground overflow-x-auto">{`{
  "invoice_number": "INV-001",
  "date": "2023-12-25",
  "total_amount": 150.00,
  "items": [...]
}`}</pre>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs">3</span>
                      Complex Tables
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Tables in PDFs can be tricky. Grounding helps, but specific instructions ensure row/column alignment.
                    </p>
                    <div className="border rounded-lg p-4">
                      <pre className="text-xs bg-zinc-950 text-zinc-100 p-3 rounded overflow-x-auto">{`<image>
<|grounding|>
Identify all tables in the document.
Convert them to Markdown tables.
Ensure that empty cells are preserved as empty strings.`}</pre>
                    </div>
                  </section>
                </div>

                {/* 3. Examples & Recipes */}
                <div className="space-y-8 pt-8 border-t">
                  <div className="pb-4 border-b">
                    <h2 className="text-2xl font-bold tracking-tight">3. Examples & Recipes</h2>
                    <p className="text-muted-foreground mt-1">Copy-pasteable templates for common use cases.</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <h4 className="font-medium text-base">Receipts & Invoices</h4>
                      <div className="border rounded-lg p-3 bg-card shadow-sm">
                        <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{`<image>
<|grounding|>
Extract key-value pairs from this receipt.
Focus on: Store Name, Date, Time, Total, and Tax.
Output as a simple markdown list.`}</pre>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-medium text-base">Academic / Technical Papers</h4>
                      <div className="border rounded-lg p-3 bg-card shadow-sm">
                        <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{`<image>
<|grounding|>
Convert this research paper page to markdown.
Preserve all LaTeX equations inline (e.g. $x^2$) and block (e.g. $$...$$).
Keep citations as text.`}</pre>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-medium text-base">Forms & Applications</h4>
                      <div className="border rounded-lg p-3 bg-card shadow-sm">
                        <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{`<image>
<|grounding|>
This is a filled-out application form.
Extract the user's handwritten responses for "Name", "Address", and "Signature Date".
Ignore the instructions text.`}</pre>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-medium text-base">Old/Damaged Documents</h4>
                      <div className="border rounded-lg p-3 bg-card shadow-sm">
                        <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{`<image>
<|grounding|>
Transcribe this historical document.
Some text may be faded. Do your best to infer words from context.
Mark illegible words with [?]`}</pre>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 p-4 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <h4 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">Troubleshooting</h4>
                    <ul className="list-disc pl-5 text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                      <li><strong>Missing text?</strong> Try adding "Do not summarize. Transcribe verbatim."</li>
                      <li><strong>Wrong layout?</strong> Ensure <code>&lt;|grounding|&gt;</code> is present.</li>
                      <li><strong>Hallucinations?</strong> DeepSeek is generally faithful, but for very blurry images, it might guess. Check the confidence or preview.</li>
                    </ul>
                  </div>
                </div>

              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
