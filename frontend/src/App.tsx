import { useState, useEffect, useRef } from 'react';
import { FileUploader } from './components/FileUploader';
import { PromptInput } from './components/PromptInput';
import { FileExplorer } from './components/FileExplorer';
import { FilePreview } from './components/FilePreview';
import { HistoryPanel } from './components/HistoryPanel';
import { ConsoleOutput } from './components/ConsoleOutput';
import { JobQueuePanel } from './components/JobQueuePanel';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner@2.0.3';
import API_CONFIG from './config/api';

interface FileNode {
  name: string;
  type: 'folder' | 'file';
  fileType?: 'markdown' | 'image' | 'pdf';
  content?: string;
}

const API_BASE_URL = API_CONFIG.BASE_URL;

export default function App() {
  const [activeTab, setActiveTab] = useState('current');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFilePath, setUploadedFilePath] = useState<string>('');
  const [originalFilename, setOriginalFilename] = useState<string>('');
  const [prompt, setPrompt] = useState('<image>\n<|grounding|>Convert the document to markdown.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string>('');
  const [resultDir, setResultDir] = useState<string>('');
  const [parseCompleted, setParseCompleted] = useState(false);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<any>(null);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [consoleMessages, setConsoleMessages] = useState<string[]>([]);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [totalRuntime, setTotalRuntime] = useState<number | null>(null);
  
  // Track if we've restored state from a running job
  const hasRestoredState = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check for running jobs on mount and restore state
  useEffect(() => {
    const checkRunningJobs = async () => {
      if (hasRestoredState.current) return;
      
      try {
        const response = await fetch(`${API_BASE_URL}/api/history`);
        const data = await response.json();
        
        if (data.status === 'success' && data.jobs) {
          const runningJob = data.jobs.find((job: any) => job.status === 'running');
          
          if (runningJob) {
            hasRestoredState.current = true;
            
            // Restore state from running job
            setTaskId(runningJob.task_id);
            setIsProcessing(true);
            setOriginalFilename(runningJob.original_filename || runningJob.filename || '');
            
            // Calculate elapsed time from job start
            if (runningJob.timestamp) {
              const startTime = new Date(runningJob.timestamp).getTime();
              setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
            }
            
            toast.info('Resuming running job', {
              description: `Task ${runningJob.task_id} is still processing`,
            });
            
            // Start polling for completion
            startPolling(runningJob.task_id, Date.now());
          }
        }
      } catch (error) {
        console.error('Failed to check running jobs:', error);
      }
    };
    
    checkRunningJobs();
    
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  const startPolling = (taskIdToTrack: string, startTime: number) => {
    // Start elapsed time counter
    timerIntervalRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    // Poll for completion
    pollIntervalRef.current = setInterval(async () => {
      try {
        const progressRes = await fetch(`${API_BASE_URL}/api/progress/${taskIdToTrack}`);
        const progressData = await progressRes.json();
        
        if (progressData.status === 'success' && 
            (progressData.state === 'finished' || progressData.state === 'error' || progressData.state === 'cancelled')) {
          
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setIsProcessing(false);
          
          if (progressData.state === 'finished') {
            // Fetch result
            const resultRes = await fetch(`${API_BASE_URL}/api/result/${taskIdToTrack}`);
            const resultData = await resultRes.json();
            
            if (resultData.status === 'success' && resultData.state === 'finished') {
              setResultDir(resultData.result_dir);
              setParseCompleted(true);
              const runtime = resultData.runtime || Math.floor((Date.now() - startTime) / 1000);
              setTotalRuntime(runtime);
              toast.success('Processing complete!', {
                description: `Finished in ${formatTime(runtime)}`,
              });
            }
          } else if (progressData.state === 'cancelled') {
            toast.info('Task was cancelled');
          } else if (progressData.state === 'error') {
            toast.error('Processing failed');
          }
        }
      } catch (error) {
        console.error('Progress poll error:', error);
      }
    }, 2000);
  };

  const handleFileChange = async (file: File | null) => {
    setUploadedFile(file);
    // Reset states when file is deleted
    if (!file) {
      setParseCompleted(false);
      setSelectedPreviewFile(null);
      setIsProcessing(false);
      setUploadedFilePath('');
      setOriginalFilename('');
      setTaskId('');
      setResultDir('');
      setConsoleMessages([]);
      setElapsedTime(0);
      setTotalRuntime(null);
    } else {
      // Upload file to backend
      try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        });
        
        const data = await response.json();
        if (data.status === 'success') {
          setUploadedFilePath(data.file_path);
          setOriginalFilename(data.original_filename || file.name);
          toast.success('File uploaded successfully', {
            description: `Uploaded ${file.name}`,
          });
        } else {
          toast.error('File upload failed', {
            description: data.message || 'Unknown error',
          });
        }
      } catch (error) {
        console.error('Upload error:', error);
        toast.error('File upload failed', {
          description: 'Unable to connect to backend service',
        });
      }
    }
  };

  const handleStartParsing = async () => {
    if (!uploadedFilePath) {
      toast.error('Please upload a file first');
      return;
    }

    setIsProcessing(true);
    setParseCompleted(false);
    setResultDir('');
    setConsoleMessages([]);
    setElapsedTime(0);
    setTotalRuntime(null);

    const startTime = Date.now();

    try {
      const response = await fetch(`${API_BASE_URL}/api/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file_path: uploadedFilePath,
          prompt: prompt,
          original_filename: originalFilename,
        }),
      });

      const data = await response.json();
      if (data.status === 'running' && data.task_id) {
        setTaskId(data.task_id);
        
        // Connect to console WebSocket
        const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/ws/console/${data.task_id}`;
        const ws = new WebSocket(wsUrl);
        
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'log') {
            setConsoleMessages(prev => [...prev, message.content]);
          }
        };
        
        ws.onerror = () => {
          console.log('Console WebSocket connection failed (optional feature)');
        };
        
        // Start polling
        startPolling(data.task_id, startTime);
        
      } else {
        toast.error('Failed to start processing task', {
          description: data.message || 'Unknown error',
        });
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('Parse error:', error);
      toast.error('Processing failed', {
        description: 'Unable to connect to backend service',
      });
      setIsProcessing(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-teal-50">
      <Toaster position="top-right" />
      
      {/* Header with Tabs */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-8 py-3 flex items-center justify-between">
          <h1 className="text-2xl text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-cyan-600 font-semibold">
            DeepSeek OCR
          </h1>
          
          {/* Navigation Tabs in Header */}
          <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('current')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all cursor-pointer ${
                activeTab === 'current'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              Current Job
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              History
            </button>
          </div>
          
          {/* Job Queue Panel in Header */}
          <div className="w-[140px] flex justify-end">
            <JobQueuePanel />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-8 py-6">
        {activeTab === 'current' ? (
          <div className="grid grid-cols-2 gap-6 h-[calc(100vh-100px)]">
            {/* Left Panel - File Upload */}
            <div className="flex flex-col min-h-0">
              <FileUploader 
                onFileChange={handleFileChange}
                initialFile={uploadedFile}
              />
            </div>

            {/* Right Panel - Results */}
            <div className="flex flex-col gap-4 min-h-0">
              {/* Prompt Input and File Explorer */}
              <div 
                className={`flex gap-4 flex-shrink-0 transition-all duration-300 overflow-hidden ${
                  isPreviewExpanded ? 'h-0 opacity-0' : 'h-[280px] opacity-100'
                }`}
              >
                <div className="flex-1 min-h-0">
                  <PromptInput
                    prompt={prompt}
                    onPromptChange={setPrompt}
                    onParse={handleStartParsing}
                    isProcessing={isProcessing}
                    hasFile={!!uploadedFile || !!uploadedFilePath}
                    isCompact={isPreviewExpanded}
                    elapsedTime={isProcessing ? elapsedTime : undefined}
                    totalRuntime={totalRuntime}
                  />
                </div>
                <div className="w-[320px] min-h-0">
                  <FileExplorer
                    onFileSelect={setSelectedPreviewFile}
                    selectedFile={selectedPreviewFile}
                    parseCompleted={parseCompleted}
                    resultDir={resultDir}
                    taskId={taskId}
                  />
                </div>
              </div>

              {/* Console Output - only show during processing */}
              {isProcessing && consoleMessages.length > 0 && (
                <div className="h-[150px] flex-shrink-0">
                  <ConsoleOutput messages={consoleMessages} />
                </div>
              )}

              {/* File Preview */}
              <div className="flex-1 min-h-0">
                <FilePreview 
                  file={selectedPreviewFile}
                  isExpanded={isPreviewExpanded}
                  onToggleExpand={() => setIsPreviewExpanded(!isPreviewExpanded)}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-[calc(100vh-100px)]">
            <HistoryPanel />
          </div>
        )}
      </main>
    </div>
  );
}
