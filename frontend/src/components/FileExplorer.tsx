import { useState, useEffect } from 'react';
import { Folder, FileText, Image, FileType, ChevronRight, ChevronDown, Download, ChevronDownIcon } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { toast } from 'sonner@2.0.3';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import API_CONFIG from '../config/api';

const API_BASE_URL = API_CONFIG.BASE_URL;

// Function to fix markdown image paths
function fixMarkdownImages(mdContent: string, resultDir: string): string {
  // Replace ![alt](images/xxx.jpg) with ![alt](http://127.0.0.1:8002/api/file/view?path=/full/path/images/xxx.jpg)
  return mdContent.replace(
    /!\[(.*?)\]\((.*?)\)/g,
    (match, altText, relativePath) => {
      // Skip if already an absolute URL
      if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
        return match;
      }
      
      // Build absolute path
      const absPath = `${resultDir}/${relativePath}`.replace(/\/+/g, '/');
      const url = `${API_BASE_URL}/results/${absPath.split('/results/')[1]}`;
      return `![${altText}](${url})`;
    }
  );
}

interface FileNode {
  name: string;
  type: 'folder' | 'file';
  fileType?: 'markdown' | 'image' | 'pdf';
  content?: string;
  path?: string; // Backend file path
  resultDir?: string; // Result directory for resolving relative paths
  children?: FileNode[];
}

interface FileExplorerProps {
  onFileSelect: (file: FileNode) => void;
  selectedFile: FileNode | null;
  parseCompleted: boolean;
  resultDir: string;
  taskId?: string;
}

export function FileExplorer({ onFileSelect, selectedFile, parseCompleted, resultDir, taskId }: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [fileStructure, setFileStructure] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch folder structure when resultDir changes
  useEffect(() => {
    if (parseCompleted && resultDir) {
      fetchFolderStructure();
    } else {
      setFileStructure([]);
    }
  }, [parseCompleted, resultDir]);

  const fetchFolderStructure = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/folder?path=${encodeURIComponent(resultDir)}`);
      const data = await response.json();
      
      if (data.status === 'success' && data.children) {
        // Convert backend structure to our FileNode format
        const convertNode = (node: any): FileNode => {
          const fileName = node.name;
          let fileType: 'markdown' | 'image' | 'pdf' | undefined;
          
          if (node.type === 'file') {
            const ext = fileName.split('.').pop()?.toLowerCase();
            if (ext === 'md' || ext === 'mmd' || ext === 'txt') {
              fileType = 'markdown';
            } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif') {
              fileType = 'image';
            } else if (ext === 'pdf') {
              fileType = 'pdf';
            }
          }

          return {
            name: node.name,
            type: node.type === 'folder' ? 'folder' : 'file',
            fileType,
            path: node.path,
            resultDir: resultDir, // Add resultDir to each node
            children: node.children ? node.children.map(convertNode) : undefined,
          };
        };

        const convertedStructure = data.children.map(convertNode);
        setFileStructure(convertedStructure);
        
        // Auto-expand first folder
        if (convertedStructure.length > 0 && convertedStructure[0].type === 'folder') {
          setExpandedFolders(new Set([convertedStructure[0].name]));
        }
      }
    } catch (error) {
      console.error('Failed to fetch folder structure:', error);
      toast.error('Failed to load folder structure');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderName)) {
        newSet.delete(folderName);
      } else {
        newSet.add(folderName);
      }
      return newSet;
    });
  };

  const getFileIcon = (fileType?: string) => {
    switch (fileType) {
      case 'markdown':
        return <FileText className="h-4 w-4 text-blue-500" />;
      case 'image':
        return <Image className="h-4 w-4 text-green-500" />;
      case 'pdf':
        return <FileType className="h-4 w-4 text-red-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const handleFileClick = async (node: FileNode) => {
    if (!node.path) return;

    try {
      // Fetch file content from backend
      const response = await fetch(`${API_BASE_URL}/api/file/content?path=${encodeURIComponent(node.path)}`);
      
      if (node.fileType === 'image') {
        // For images, create blob URL
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        onFileSelect({
          ...node,
          content: url,
        });
      } else if (node.fileType === 'pdf') {
        // For PDFs, create blob URL
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        onFileSelect({
          ...node,
          content: url,
        });
      } else if (node.fileType === 'markdown') {
        // For markdown files, clean OCR tags
        const data = await response.json();
        let cleanContent = data.content;
        
        // Remove OCR grounding tags like <|ref|>, <|det|>, etc.
        cleanContent = cleanContent
          .replace(/<\|ref\|>.*?<\/ref\|>/g, '') // Remove reference tags
          .replace(/<\|det\|>.*?<\/det\|>/g, '') // Remove detection coordinates
          .replace(/<\|ref\|>/g, '') // Remove orphan opening tags
          .replace(/<\/ref\|>/g, '') // Remove orphan closing tags
          .replace(/<\|det\|>/g, '') // Remove orphan det opening tags
          .replace(/<\/det\|>/g, '') // Remove orphan det closing tags
          .replace(/\n{3,}/g, '\n\n') // Clean up multiple newlines
          .trim();
        
        // Fix markdown image paths
        cleanContent = fixMarkdownImages(cleanContent, node.resultDir || '');
        
        onFileSelect({
          ...node,
          content: cleanContent,
        });
      } else {
        // For other text files
        const data = await response.json();
        onFileSelect({
          ...node,
          content: data.content,
        });
      }
    } catch (error) {
      console.error('Failed to fetch file content:', error);
      toast.error('Failed to load file');
    }
  };

  const renderNode = (node: FileNode, level: number = 0, parentPath: string = '') => {
    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
    const isExpanded = expandedFolders.has(nodePath);
    const isSelected = selectedFile?.name === node.name && selectedFile?.path === node.path;

    if (node.type === 'folder') {
      return (
        <div key={nodePath}>
          <button
            onClick={() => toggleFolder(nodePath)}
            className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-100/50 rounded-lg transition-all hover:shadow-sm cursor-pointer"
            style={{ paddingLeft: `${level * 16 + 12}px` }}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-500" />
            )}
            <Folder className="h-4 w-4 text-yellow-500" />
            <span className="text-sm">{node.name}</span>
          </button>
          {isExpanded && node.children && (
            <div>{node.children.map((child) => renderNode(child, level + 1, nodePath))}</div>
          )}
        </div>
      );
    }

    return (
      <button
        key={nodePath}
        onClick={() => handleFileClick(node)}
        className={`flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-100/50 rounded-lg transition-all hover:shadow-sm cursor-pointer ${
          isSelected ? 'bg-teal-50 border-l-2 border-teal-500' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 36}px` }}
      >
        {getFileIcon(node.fileType)}
        <span className="text-sm">{node.name}</span>
      </button>
    );
  };

  const handleDownloadZip = (format: 'mmd' | 'md' | 'txt') => {
    if (!taskId) {
      toast.error('No task ID available');
      return;
    }

    console.log('handleDownloadZip called:', taskId, format);
    const downloadUrl = `${API_BASE_URL}/api/download/zip/${taskId}?format=${format}`;
    console.log('Download URL:', downloadUrl);
    
    // Use fetch + blob approach for cross-origin downloads
    toast.info('Starting download...', {
      description: `Preparing ${format} file`,
    });
    
    fetch(downloadUrl)
      .then(response => {
        console.log('Fetch response:', response.status, response.headers.get('content-type'));
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        console.log('Blob received:', blob.size, blob.type);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ocr_results_${taskId}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast.success('Download complete', {
          description: `Saved as ocr_results_${taskId}.zip`,
        });
      })
      .catch(error => {
        console.error('Download error:', error);
        toast.error('Download failed', {
          description: error.message,
        });
      });
  };

  return (
    <div className="bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg overflow-hidden h-full flex flex-col">
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm text-gray-700">File Explorer</h3>
        {parseCompleted && fileStructure.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center h-7 px-2 text-sm rounded-md hover:bg-teal-50 hover:text-teal-600 transition-all cursor-pointer"
                title="Download all files"
              >
                <Download className="h-4 w-4 mr-1" />
                <ChevronDownIcon className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <button
                onClick={() => handleDownloadZip('mmd')}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 rounded cursor-pointer"
              >
                Download as .mmd (MultiMarkdown)
              </button>
              <button
                onClick={() => handleDownloadZip('md')}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 rounded cursor-pointer"
              >
                Download as .md (Markdown)
              </button>
              <button
                onClick={() => handleDownloadZip('txt')}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 rounded cursor-pointer"
              >
                Download as .txt (Plain Text)
              </button>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full w-full">
          {isLoading ? (
            <div className="flex items-center justify-center h-full min-h-[200px]">
              <div className="text-center text-gray-400">
                <Folder className="h-12 w-12 mx-auto mb-3 opacity-30 animate-pulse" />
                <p className="text-sm">Loading file structure...</p>
              </div>
            </div>
          ) : parseCompleted && fileStructure.length > 0 ? (
            <div className="p-2">{fileStructure.map((node) => renderNode(node))}</div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[200px]">
              <div className="text-center text-gray-400">
                <Folder className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Waiting for file processing...</p>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
