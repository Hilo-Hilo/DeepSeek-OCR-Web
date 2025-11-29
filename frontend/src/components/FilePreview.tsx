import { ScrollArea } from './ui/scroll-area';
import { FileText, X, Maximize2, Minimize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';

interface FileNode {
  name: string;
  type: 'folder' | 'file';
  fileType?: 'markdown' | 'image' | 'pdf';
  content?: string;
  path?: string;
  resultDir?: string; // Result directory for resolving relative paths
}

interface FilePreviewProps {
  file: FileNode | null;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function FilePreview({ file, isExpanded, onToggleExpand }: FilePreviewProps) {
  const [isImageExpanded, setIsImageExpanded] = useState(false);

  if (!file || file.type === 'folder') {
    return (
      <div className="bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg overflow-hidden h-full flex flex-col">
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 border-b border-gray-200 flex-shrink-0 flex items-center justify-between relative">
          <h3 className="text-sm text-gray-700">OCR Result Preview</h3>
          {onToggleExpand && (
            <Button
              onClick={onToggleExpand}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-white/50 hover:text-teal-600 transition-all cursor-pointer"
              title={isExpanded ? 'Minimize preview' : 'Maximize preview'}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <FileText className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <p>Select a file to preview</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg overflow-hidden h-full flex flex-col">
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 border-b border-gray-200 flex-shrink-0 flex items-center justify-between relative">
          <h3 className="text-sm text-gray-700">{file.name}</h3>
          {onToggleExpand && (
            <Button
              onClick={onToggleExpand}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-white/50 hover:text-teal-600 transition-all cursor-pointer"
              title={isExpanded ? 'Minimize preview' : 'Maximize preview'}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full w-full">
            <div className="p-6">
              {file.fileType === 'markdown' && file.content && (
                <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-teal-600 prose-strong:text-gray-900 prose-code:text-teal-700 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-img:rounded-lg prose-img:shadow-md">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={{
                      // Custom image renderer to handle relative paths
                      img: ({ node, ...props }) => (
                        <img
                          {...props}
                          className="max-w-full h-auto rounded-lg shadow-md my-4"
                          loading="lazy"
                          alt={props.alt || ''}
                        />
                      ),
                      // Custom code block renderer
                      code: ({ node, inline, className, children, ...props }) => {
                        const match = /language-(\w+)/.exec(className || '');
                        return !inline ? (
                          <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto my-4">
                            <code className={className} {...props}>
                              {children}
                            </code>
                          </pre>
                        ) : (
                          <code className="bg-gray-100 text-teal-700 px-1 py-0.5 rounded text-sm" {...props}>
                            {children}
                          </code>
                        );
                      },
                      // Custom table renderer
                      table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-4">
                          <table className="min-w-full divide-y divide-gray-300 border border-gray-300" {...props} />
                        </div>
                      ),
                      th: ({ node, ...props }) => (
                        <th className="px-3 py-2 bg-gray-100 border border-gray-300 text-left" {...props} />
                      ),
                      td: ({ node, ...props }) => (
                        <td className="px-3 py-2 border border-gray-300" {...props} />
                      ),
                      // Custom link renderer
                      a: ({ node, ...props }) => (
                        <a
                          className="text-teal-600 hover:text-teal-700 underline"
                          target="_blank"
                          rel="noopener noreferrer"
                          {...props}
                        />
                      ),
                    }}
                  >
                    {file.content}
                  </ReactMarkdown>
                </div>
              )}
              {file.fileType === 'image' && file.content && (
                <img
                  src={file.content}
                  alt={file.name}
                  className="max-w-full h-auto rounded-lg shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setIsImageExpanded(true)}
                  title="Click to view full size"
                />
              )}
              {file.fileType === 'pdf' && file.content && (
                <div className="w-full">
                  <iframe
                    src={file.content}
                    className="w-full h-[calc(100vh-300px)] min-h-[600px] rounded-lg border border-gray-300 shadow-md bg-white"
                    title={file.name}
                  />
                  <p className="text-xs text-gray-500 text-center mt-2">
                    Tip: You can scroll, zoom, and navigate within the PDF viewer
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Image Fullscreen Dialog */}
      {file.fileType === 'image' && file.content && (
        <Dialog open={isImageExpanded} onOpenChange={setIsImageExpanded}>
          <DialogContent className="!max-w-none !w-screen !h-screen !p-0 !bg-transparent !border-0 !shadow-none !fixed !inset-0 !top-0 !left-0 !right-0 !bottom-0 !translate-x-0 !translate-y-0 [&>button]:hidden">
            <DialogTitle className="sr-only">Image Preview</DialogTitle>
            <DialogDescription className="sr-only">
              Full screen view of {file.name}
            </DialogDescription>
            <div className="relative w-full h-full flex items-center justify-center p-4 bg-black/90">
              <button
                onClick={() => setIsImageExpanded(false)}
                className="absolute top-6 right-6 z-50 bg-white/20 hover:bg-white/30 text-white rounded-full p-2 transition-all cursor-pointer backdrop-blur-sm"
                title="Close"
              >
                <X className="h-6 w-6" />
              </button>
              <img
                src={file.content}
                alt={file.name}
                className="max-w-[90vw] max-h-[90vh] w-auto h-auto object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
