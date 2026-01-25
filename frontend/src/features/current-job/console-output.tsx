"use client";

import React, { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal } from "lucide-react";

export function ConsoleOutput({ messages }: { messages: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="rounded-xl border bg-zinc-950 text-zinc-100 overflow-hidden h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2 flex-shrink-0">
        <Terminal className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-mono text-zinc-200">Console Output</h3>
        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden" ref={scrollRef}>
        <ScrollArea className="h-full w-full">
          <div className="p-3 font-mono text-xs space-y-1">
            {messages.length > 0 ? (
              messages.map((msg, idx) => {
                const s = String(msg ?? "");
                const color =
                  s.includes("Error") || s.includes("error") || s.includes("ERROR")
                    ? "text-red-400"
                    : s.includes("Warning") || s.includes("warning") || s.includes("WARN")
                      ? "text-yellow-300"
                      : s.includes("Success") || s.includes("success") || s.includes("✅")
                        ? "text-emerald-300"
                        : "text-zinc-200";

                return (
                  <div key={idx} className={color}>
                    <span className="text-zinc-600 mr-2 select-none">{String(idx + 1).padStart(3, " ")}|</span>
                    {s}
                  </div>
                );
              })
            ) : (
              <div className="text-zinc-500 italic">Waiting for output…</div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}





