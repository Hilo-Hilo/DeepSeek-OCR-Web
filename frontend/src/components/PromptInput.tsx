import { useState } from 'react';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Sparkles, Loader2, Info, X } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface PromptInputProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onParse: () => void;
  isProcessing: boolean;
  hasFile: boolean;
  isCompact?: boolean;
  elapsedTime?: number;
  totalRuntime?: number | null;
}

export function PromptInput({
  prompt,
  onPromptChange,
  onParse,
  isProcessing,
  hasFile,
  isCompact = false,
  elapsedTime,
  totalRuntime,
}: PromptInputProps) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg p-4 mb-3 flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
          <label className="block text-sm text-gray-600">Prompt Input</label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsInfoOpen(true)}
            className="h-6 w-6 p-0 text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors cursor-pointer"
          >
            <Info className="h-4 w-4" />
          </Button>
          {totalRuntime !== null && totalRuntime !== undefined && (
            <span className="ml-auto text-xs text-teal-600 font-medium">
              Completed in {formatTime(totalRuntime)}
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full w-full">
            <Textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              className={`w-full bg-white/80 border-gray-200 focus:border-teal-400 focus:ring-teal-400 resize-none ${
                isCompact ? 'min-h-[40px]' : 'min-h-[100px]'
              }`}
              placeholder="Enter your prompt..."
            />
          </ScrollArea>
        </div>
      </div>

      {!isCompact && (
        <div className="h-11 flex-shrink-0">
          <Button
            onClick={onParse}
            disabled={!hasFile || isProcessing}
            className="w-full h-full bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white shadow-lg disabled:opacity-50 disabled:from-gray-300 disabled:to-gray-400 transition-all hover:shadow-xl hover:scale-[1.02] cursor-pointer disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Processing{elapsedTime !== undefined ? ` (${formatTime(elapsedTime)})` : '...'}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                Start Processing
              </>
            )}
          </Button>
        </div>
      )}

      {/* Prompt Info Dialog */}
      <Dialog open={isInfoOpen} onOpenChange={setIsInfoOpen}>
        <DialogContent className="!w-[95vw] !max-w-4xl !h-[90vh] !max-h-[90vh] !flex !flex-col !p-0 overflow-hidden sm:!max-w-4xl">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-200 flex-shrink-0">
            <DialogTitle className="text-xl font-semibold text-teal-700">
              Prompt Format Guide
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              Learn how to customize the OCR behavior with different prompts
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          <div className="space-y-6 py-4">
            {/* Required Tags Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Required Tags</h3>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <code className="text-teal-600 font-mono text-sm">&lt;image&gt;</code>
                  <p className="text-sm text-gray-600 mt-1">
                    <strong>Required.</strong> This placeholder tells the model where to insert the image data. 
                    Always include this at the beginning of your prompt.
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <code className="text-teal-600 font-mono text-sm">&lt;|grounding|&gt;</code>
                  <p className="text-sm text-gray-600 mt-1">
                    <strong>Optional but recommended.</strong> Enables bounding box detection, which helps the model 
                    identify and locate text regions in the document. This improves accuracy for complex layouts.
                  </p>
                </div>
              </div>
            </div>

            {/* Example Prompts Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Example Prompts</h3>
              <div className="space-y-3">
                <div className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs rounded-full">Default</span>
                    <span className="text-sm font-medium text-gray-700">Convert to Markdown</span>
                  </div>
                  <code className="block bg-gray-900 text-gray-100 p-2 rounded text-xs font-mono">
                    &lt;image&gt;{'\n'}&lt;|grounding|&gt;Convert the document to markdown.
                  </code>
                  <p className="text-xs text-gray-500 mt-2">
                    Extracts all text and formats it as Markdown with proper headings, lists, tables, and formatting.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">Plain Text</span>
                    <span className="text-sm font-medium text-gray-700">Simple OCR</span>
                  </div>
                  <code className="block bg-gray-900 text-gray-100 p-2 rounded text-xs font-mono">
                    &lt;image&gt;{'\n'}OCR this document.
                  </code>
                  <p className="text-xs text-gray-500 mt-2">
                    Simple text extraction without special formatting. Good for plain documents.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">Tables</span>
                    <span className="text-sm font-medium text-gray-700">Table Extraction</span>
                  </div>
                  <code className="block bg-gray-900 text-gray-100 p-2 rounded text-xs font-mono">
                    &lt;image&gt;{'\n'}&lt;|grounding|&gt;Extract all tables from this document and format them as markdown tables.
                  </code>
                  <p className="text-xs text-gray-500 mt-2">
                    Focuses on extracting tabular data and converting it to markdown table format.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">Math</span>
                    <span className="text-sm font-medium text-gray-700">Mathematical Content</span>
                  </div>
                  <code className="block bg-gray-900 text-gray-100 p-2 rounded text-xs font-mono">
                    &lt;image&gt;{'\n'}&lt;|grounding|&gt;Convert this document to markdown. Use LaTeX notation for all mathematical equations and formulas.
                  </code>
                  <p className="text-xs text-gray-500 mt-2">
                    Best for academic papers, textbooks, or documents with equations. Outputs math in LaTeX format.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Code</span>
                    <span className="text-sm font-medium text-gray-700">Code Extraction</span>
                  </div>
                  <code className="block bg-gray-900 text-gray-100 p-2 rounded text-xs font-mono">
                    &lt;image&gt;{'\n'}&lt;|grounding|&gt;Extract all code snippets from this document. Preserve the original formatting and identify the programming language.
                  </code>
                  <p className="text-xs text-gray-500 mt-2">
                    Extracts code blocks with proper syntax highlighting hints.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">Structured</span>
                    <span className="text-sm font-medium text-gray-700">Structured Data</span>
                  </div>
                  <code className="block bg-gray-900 text-gray-100 p-2 rounded text-xs font-mono">
                    &lt;image&gt;{'\n'}&lt;|grounding|&gt;Extract all information from this form/invoice and output it as structured JSON.
                  </code>
                  <p className="text-xs text-gray-500 mt-2">
                    Extracts data from forms, invoices, or receipts into structured format.
                  </p>
                </div>
              </div>
            </div>

            {/* Tips Section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Tips for Better Results</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-teal-500 mt-0.5">•</span>
                  <span>Always start with <code className="bg-gray-100 px-1 rounded">&lt;image&gt;</code> - the model needs this to know where the image goes.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-teal-500 mt-0.5">•</span>
                  <span>Use <code className="bg-gray-100 px-1 rounded">&lt;|grounding|&gt;</code> for documents with complex layouts, multiple columns, or mixed content.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-teal-500 mt-0.5">•</span>
                  <span>Be specific about the output format you want (markdown, JSON, plain text, etc.).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-teal-500 mt-0.5">•</span>
                  <span>For multi-page PDFs, the same prompt is applied to each page.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-teal-500 mt-0.5">•</span>
                  <span>Higher resolution images generally produce better results.</span>
                </li>
              </ul>
            </div>
          </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
