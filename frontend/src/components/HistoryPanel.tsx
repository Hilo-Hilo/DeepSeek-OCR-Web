import { useState, useEffect } from 'react';
import { Clock, Download, FileText, ChevronDownIcon, RefreshCw } from 'lucide-react';
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

interface HistoryJob {
  task_id: string;
  filename: string;
  original_filename: string;
  timestamp: string;
  runtime: number | null;
  status: string;
  result_dir: string;
}

export function HistoryPanel() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/history`);
      const data = await response.json();
      
      if (data.status === 'success' && data.jobs) {
        setJobs(data.jobs);
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
      toast.error('Failed to load history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const formatTime = (seconds: number | null): string => {
    if (seconds === null || seconds === undefined) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatDate = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const getDisplayName = (job: HistoryJob): string => {
    // Prefer original_filename, then filename, then task_id
    if (job.original_filename && job.original_filename.trim()) {
      return job.original_filename;
    }
    if (job.filename && job.filename.trim()) {
      // Try to extract original name from the upload filename
      // Format is usually: user_upload_YYYYMMDD_HHMMSS_hash.ext
      const match = job.filename.match(/^user_upload_\d+_\d+_[a-f0-9]+\.(.+)$/i);
      if (match) {
        return `Document.${match[1]}`;
      }
      return job.filename;
    }
    return `Task ${job.task_id}`;
  };

  const handleDownloadZip = async (taskId: string, format: 'mmd' | 'md' | 'txt') => {
    try {
      toast.info('Preparing download...', { duration: 2000 });
      const response = await fetch(`${API_BASE_URL}/api/download/zip/${taskId}?format=${format}`);
      
      if (!response.ok) {
        throw new Error('Download failed');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ocr_results_${taskId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Download complete', {
        description: `Downloaded as .${format} format`,
      });
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Download failed');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'finished':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">Completed</span>;
      case 'running':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">Running</span>;
      case 'error':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">Error</span>;
      default:
        return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">{status}</span>;
    }
  };

  return (
    <div className="bg-white/50 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg overflow-hidden h-full flex flex-col">
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm text-gray-700 font-medium">Job History</h3>
        <Button
          onClick={fetchHistory}
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 hover:bg-teal-50 hover:text-teal-600 transition-all cursor-pointer"
          title="Refresh history"
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full w-full">
          {isLoading && jobs.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <div className="text-center text-gray-400">
                <RefreshCw className="h-12 w-12 mx-auto mb-3 opacity-30 animate-spin" />
                <p className="text-sm">Loading history...</p>
              </div>
            </div>
          ) : jobs.length > 0 ? (
            <div className="p-3 space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.task_id}
                  className="bg-white/70 rounded-lg border border-gray-200 p-3 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-4 w-4 text-gray-500 flex-shrink-0" />
                        <span className="text-sm font-medium text-gray-800 truncate" title={getDisplayName(job)}>
                          {getDisplayName(job)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(job.timestamp)}
                        </span>
                        {job.runtime !== null && (
                          <span>Runtime: {formatTime(job.runtime)}</span>
                        )}
                      </div>
                      <div className="mt-2">
                        {getStatusBadge(job.status)}
                      </div>
                    </div>
                    {job.status === 'finished' && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 hover:bg-teal-50 hover:text-teal-600 hover:border-teal-300 transition-all cursor-pointer"
                          >
                            <Download className="h-4 w-4 mr-1" />
                            <ChevronDownIcon className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleDownloadZip(job.task_id, 'mmd')} className="cursor-pointer">
                            Download as .mmd
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDownloadZip(job.task_id, 'md')} className="cursor-pointer">
                            Download as .md
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDownloadZip(job.task_id, 'txt')} className="cursor-pointer">
                            Download as .txt
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <div className="text-center text-gray-400">
                <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No job history yet</p>
                <p className="text-xs mt-1">Completed jobs will appear here</p>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
