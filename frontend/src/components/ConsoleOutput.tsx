import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';

interface ConsoleOutputProps {
  messages: string[];
}

export function ConsoleOutput({ messages }: ConsoleOutputProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-lg overflow-hidden h-full flex flex-col">
      <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex items-center gap-2 flex-shrink-0">
        <Terminal className="h-4 w-4 text-green-400" />
        <h3 className="text-sm text-gray-300 font-mono">Console Output</h3>
        <div className="ml-auto flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span className="text-xs text-gray-500">Live</span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden" ref={scrollRef}>
        <ScrollArea className="h-full w-full">
          <div className="p-3 font-mono text-xs space-y-1">
            {messages.length > 0 ? (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`${
                    msg.includes('Error') || msg.includes('error') || msg.includes('ERROR')
                      ? 'text-red-400'
                      : msg.includes('Warning') || msg.includes('warning') || msg.includes('WARN')
                      ? 'text-yellow-400'
                      : msg.includes('✅') || msg.includes('Success') || msg.includes('success')
                      ? 'text-green-400'
                      : msg.includes('🔄') || msg.includes('Loading') || msg.includes('loading')
                      ? 'text-blue-400'
                      : 'text-gray-300'
                  }`}
                >
                  <span className="text-gray-600 mr-2 select-none">{String(idx + 1).padStart(3, ' ')}|</span>
                  {msg}
                </div>
              ))
            ) : (
              <div className="text-gray-500 italic">Waiting for output...</div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

