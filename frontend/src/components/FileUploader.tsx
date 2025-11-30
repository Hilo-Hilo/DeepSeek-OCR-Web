import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Upload, Trash2 } from 'lucide-react';

interface FileUploaderProps {
  onFileChange: (file: File | null) => void;
  initialFile?: File | null;
}

export function FileUploader({ onFileChange, initialFile }: FileUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [previewUrl, setPreviewUrl] = useState<string>('');

  // Sync with parent's initialFile prop (for tab switching)
  useEffect(() => {
    if (initialFile && initialFile !== selectedFile) {
      setSelectedFile(initialFile);
      const url = URL.createObjectURL(initialFile);
      setPreviewUrl(url);
    } else if (!initialFile && selectedFile) {
      // Parent cleared the file
      setSelectedFile(null);
      setPreviewUrl('');
    }
  }, [initialFile]);

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Clean up old preview URL
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      
      setSelectedFile(file);
      onFileChange(file);
      
      // Create preview URL
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleDelete = () => {
    // Clean up preview URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    
    setSelectedFile(null);
    setPreviewUrl('');
    onFileChange(null);
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex gap-2 flex-shrink-0">
        <Button
          variant="outline"
          className="flex-1 h-12 bg-white/50 backdrop-blur-sm border-2 border-dashed border-gray-300 hover:border-teal-400 hover:bg-teal-50/50 transition-all hover:shadow-md cursor-pointer"
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <Upload className="mr-2 h-5 w-5" />
          Upload File (PDF / PNG / JPG)
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
          className="h-12 w-12 bg-white/50 backdrop-blur-sm hover:bg-red-50 hover:border-red-300 transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          onClick={handleDelete}
          disabled={!selectedFile}
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg overflow-hidden">
        <ScrollArea className="h-full w-full">
          <div className="p-6">
            {previewUrl ? (
              <div className="flex items-center justify-center">
                {selectedFile?.type === 'application/pdf' ? (
                  <div className="w-full">
                    <iframe
                      src={previewUrl}
                      className="w-full h-[calc(100vh-300px)] min-h-[600px] rounded-lg border border-gray-300 shadow-md bg-white"
                      title="PDF Preview"
                    />
                    <p className="text-xs text-gray-500 text-center mt-2">
                      Tip: You can scroll, zoom, and navigate within the PDF viewer
                    </p>
                  </div>
                ) : (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-w-full h-auto rounded-lg shadow-md"
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center text-gray-400">
                  <Upload className="h-16 w-16 mx-auto mb-4 opacity-30" />
                  <p>Upload a file to preview</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
