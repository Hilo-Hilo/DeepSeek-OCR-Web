"use client";

import { ThemeProvider } from "next-themes";
import { TaskProvider } from "@/features/tasks/task-store";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TaskProvider>
        {children}
        <Toaster position="top-right" richColors />
      </TaskProvider>
    </ThemeProvider>
  );
}





