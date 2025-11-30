import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, XCircle, AlertCircle, ChevronDown, X } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import API_CONFIG from '../config/api';

const API_BASE_URL = API_CONFIG.BASE_URL;

interface Job {
  task_id: string;
  filename: string;
  original_filename: string;
  timestamp: string;
  runtime: number | null;
  status: string;
  elapsed?: number;
}

interface JobQueuePanelProps {
  onJobComplete?: (taskId: string) => void;
}

export function JobQueuePanel({ onJobComplete }: JobQueuePanelProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const fetchJobs = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/history`);
      const data = await response.json();
      
      if (data.status === 'success' && data.jobs) {
        // Get recent jobs (last 5) with running jobs first
        const recentJobs = data.jobs
          .slice(0, 10)
          .sort((a: Job, b: Job) => {
            if (a.status === 'running' && b.status !== 'running') return -1;
            if (a.status !== 'running' && b.status === 'running') return 1;
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
          })
          .slice(0, 5);
        
        setJobs(recentJobs);
        
        // Notify when a running job completes
        const runningJob = recentJobs.find((j: Job) => j.status === 'running');
        if (!runningJob && onJobComplete) {
          const justFinished = recentJobs.find((j: Job) => j.status === 'finished');
          if (justFinished) {
            onJobComplete(justFinished.task_id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    }
  };

  useEffect(() => {
    fetchJobs();
    
    // Poll every 3 seconds
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleCancelTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(`${API_BASE_URL}/api/cancel/${taskId}`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        fetchJobs();
      }
    } catch (error) {
      console.error('Cancel error:', error);
    }
  };

  const runningJobs = jobs.filter(j => j.status === 'running');
  const recentJobs = jobs.filter(j => j.status !== 'running').slice(0, 3);

  const getDisplayName = (job: Job): string => {
    if (job.original_filename && job.original_filename.trim()) {
      const name = job.original_filename;
      return name.length > 20 ? name.substring(0, 17) + '...' : name;
    }
    return `Task ${job.task_id}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
      case 'finished':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'error':
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      case 'cancelled':
        return <XCircle className="h-3.5 w-3.5 text-gray-400" />;
      default:
        return <AlertCircle className="h-3.5 w-3.5 text-gray-400" />;
    }
  };

  const formatElapsed = (job: Job): string => {
    if (job.status !== 'running') return '';
    const elapsed = job.elapsed || 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  // Don't render if no jobs
  if (jobs.length === 0) return null;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={`inline-flex items-center h-8 px-3 gap-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
            runningJobs.length > 0 
              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' 
              : 'hover:bg-gray-100'
          }`}
        >
          {runningJobs.length > 0 ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs font-medium">
                {runningJobs.length} running
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs font-medium text-gray-600">Jobs</span>
            </>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-72 p-0">
        <div className="px-3 py-2 border-b border-gray-100">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Job Queue
          </h4>
        </div>
        
        <div className="max-h-64 overflow-y-auto">
          {/* Running Jobs */}
          {runningJobs.length > 0 && (
            <div className="p-2 space-y-1">
              {runningJobs.map((job) => (
                <div
                  key={job.task_id}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg bg-blue-50 border border-blue-100"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">
                      {getDisplayName(job)}
                    </p>
                    <p className="text-[10px] text-blue-600">
                      Processing... {formatElapsed(job)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => handleCancelTask(job.task_id, e)}
                    className="h-6 w-6 p-0 hover:bg-red-100 hover:text-red-600 cursor-pointer"
                    title="Cancel"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          
          {/* Recent Jobs */}
          {recentJobs.length > 0 && (
            <div className="p-2 space-y-1">
              {runningJobs.length > 0 && (
                <p className="text-[10px] font-medium text-gray-400 uppercase px-2 pt-1">
                  Recent
                </p>
              )}
              {recentJobs.map((job) => (
                <div
                  key={job.task_id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50"
                >
                  {getStatusIcon(job.status)}
                  <p className="text-xs text-gray-700 truncate flex-1">
                    {getDisplayName(job)}
                  </p>
                  <span className="text-[10px] text-gray-400">
                    {job.runtime ? `${job.runtime}s` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          
          {jobs.length === 0 && (
            <div className="p-4 text-center text-xs text-gray-400">
              No recent jobs
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

