import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-surface">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-10">{children}</main>
        <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground lg:px-10">
          Local LLM Sentiment Tracker &middot; Data from r/LocalLLaMA
        </footer>
      </div>
    </div>
  );
}
