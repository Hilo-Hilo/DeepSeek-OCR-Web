import { useState, useEffect, useMemo } from 'react';
import { Clock, Download, FileText, ChevronDownIcon, RefreshCw, SortAsc, Image, File, XCircle, Loader2, Trash2 } from 'lucide-react';
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

type SortOption = 'newest' | 'oldest' | 'status' | 'runtime';

export function HistoryPanel() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [cancellingTasks, setCancellingTasks] = useState<Set<string>>(new Set());

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
    
    // Auto-refresh every 5 seconds if there are running jobs
    const interval = setInterval(() => {
      const hasRunningJobs = jobs.some(job => job.status === 'running');
      if (hasRunningJobs) {
        fetchHistory();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [jobs.length]);

  // Sort jobs based on selected option
  const sortedJobs = useMemo(() => {
    const sorted = [...jobs];
    
    switch (sortBy) {
      case 'newest':
        return sorted.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      case 'oldest':
        return sorted.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      case 'status':
        const statusOrder = { running: 0, finished: 1, error: 2, cancelled: 3 };
        return sorted.sort((a, b) => 
          (statusOrder[a.status as keyof typeof statusOrder] ?? 4) - 
          (statusOrder[b.status as keyof typeof statusOrder] ?? 4)
        );
      case 'runtime':
        return sorted.sort((a, b) => (b.runtime ?? 0) - (a.runtime ?? 0));
      default:
        return sorted;
    }
  }, [jobs, sortBy]);

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
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString();
    } catch {
      return timestamp;
    }
  };

  const getDisplayName = (job: HistoryJob): string => {
    if (job.original_filename && job.original_filename.trim()) {
      return job.original_filename;
    }
    if (job.filename && job.filename.trim()) {
      const match = job.filename.match(/^user_upload_\d+_\d+_[a-f0-9]+\.(.+)$/i);
      if (match) {
        return `Document.${match[1]}`;
      }
      return job.filename;
    }
    return `Task ${job.task_id}`;
  };

  const getFileIcon = (job: HistoryJob) => {
    const filename = job.original_filename || job.filename || '';
    const ext = filename.split('.').pop()?.toLowerCase();
    
    if (ext === 'pdf') {
      return <FileText className="h-5 w-5 text-red-500" />;
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) {
      return <Image className="h-5 w-5 text-blue-500" />;
    }
    return <File className="h-5 w-5 text-gray-500" />;
  };

  const handleDownloadZip = (taskId: string, format: 'mmd' | 'md' | 'txt') => {
    console.log('handleDownloadZip called:', taskId, format);
    // For cross-origin downloads, we need to navigate directly to the URL
    // The server sets Content-Disposition: attachment which triggers download
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

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task? This will remove all result files.')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/delete/${taskId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success('Task deleted');
        fetchHistory();
      } else {
        toast.error('Failed to delete task', { description: data.message });
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to delete task');
    }
  };

  const handleCancelTask = async (taskId: string) => {
    setCancellingTasks(prev => new Set(prev).add(taskId));
    try {
      const response = await fetch(`${API_BASE_URL}/api/cancel/${taskId}`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success('Task cancelled');
        fetchHistory();
      } else {
        toast.error('Failed to cancel task', { description: data.message });
      }
    } catch (error) {
      console.error('Cancel error:', error);
      toast.error('Failed to cancel task');
    } finally {
      setCancellingTasks(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'finished':
        return (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
            Completed
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20">
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            Running
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5"></span>
            Error
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 mr-1.5"></span>
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/20">
            {status}
          </span>
        );
    }
  };

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'newest', label: 'Newest First' },
    { value: 'oldest', label: 'Oldest First' },
    { value: 'status', label: 'By Status' },
    { value: 'runtime', label: 'By Runtime' },
  ];

  const runningCount = jobs.filter(j => j.status === 'running').length;

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/80 shadow-xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-50 to-gray-50 px-5 py-4 border-b border-gray-200/80 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-800">Job History</h3>
          {runningCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
              {runningCount} running
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Sort Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center h-8 px-3 text-xs font-medium border border-gray-200 rounded-md bg-white hover:bg-gray-100 transition-all cursor-pointer"
              >
                <SortAsc className="h-3.5 w-3.5 mr-1.5" />
                {sortOptions.find(o => o.value === sortBy)?.label}
                <ChevronDownIcon className="h-3 w-3 ml-1.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              {sortOptions.map((option) => (
                <DropdownMenuItem 
                  key={option.value}
                  onSelect={() => setSortBy(option.value)} 
                  className={`cursor-pointer ${sortBy === option.value ? 'bg-gray-100' : ''}`}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* Refresh Button */}
          <Button
            onClick={fetchHistory}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 hover:bg-gray-100 transition-all cursor-pointer"
            title="Refresh history"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full w-full">
          {isLoading && jobs.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <div className="text-center text-gray-400">
                <RefreshCw className="h-10 w-10 mx-auto mb-3 opacity-40 animate-spin" />
                <p className="text-sm font-medium">Loading history...</p>
              </div>
            </div>
          ) : sortedJobs.length > 0 ? (
            <div className="p-4 space-y-3">
              {sortedJobs.map((job) => (
                <div
                  key={job.task_id}
                  className={`bg-white rounded-xl border p-4 transition-all hover:shadow-md ${
                    job.status === 'running' 
                      ? 'border-blue-200 bg-blue-50/30 shadow-sm' 
                      : job.status === 'error'
                      ? 'border-red-200 bg-red-50/20'
                      : 'border-gray-200/80 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* File Icon */}
                    <div className={`flex-shrink-0 p-2 rounded-lg ${
                      job.status === 'running' ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      {getFileIcon(job)}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-gray-900 truncate" title={getDisplayName(job)}>
                            {getDisplayName(job)}
                          </h4>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(job.timestamp)}
                            </span>
                            {job.runtime !== null && job.status !== 'running' && (
                              <span className="text-gray-400">
                                {formatTime(job.runtime)}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {job.status === 'running' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCancelTask(job.task_id)}
                              disabled={cancellingTasks.has(job.task_id)}
                              className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 transition-all cursor-pointer"
                              title="Cancel task"
                            >
                              {cancellingTasks.has(job.task_id) ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {job.status === 'finished' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="inline-flex items-center justify-center h-8 px-2.5 text-sm font-medium border border-gray-200 rounded-md bg-white hover:bg-teal-50 hover:text-teal-600 hover:border-teal-300 transition-all cursor-pointer"
                                >
                                  <Download className="h-4 w-4 mr-1" />
                                  <ChevronDownIcon className="h-3 w-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-[160px] z-50">
                                <DropdownMenuItem onSelect={() => handleDownloadZip(job.task_id, 'mmd')}>
                                  Download as .mmd
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleDownloadZip(job.task_id, 'md')}>
                                  Download as .md
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleDownloadZip(job.task_id, 'txt')}>
                                  Download as .txt
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          {/* Delete button - always visible */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteTask(job.task_id)}
                            className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                            title="Delete task"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      
                      {/* Status Badge */}
                      <div className="mt-3">
                        {getStatusBadge(job.status)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <div className="text-center text-gray-400">
                <Clock className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">No job history yet</p>
                <p className="text-xs mt-1.5 text-gray-400">Completed jobs will appear here</p>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
