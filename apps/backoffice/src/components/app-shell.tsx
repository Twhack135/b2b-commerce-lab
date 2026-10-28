"use client";

import { useState } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

/** Page frame: sidebar on the left, header on top, page content below */
export function AppShell({ children }: { children: React.ReactNode }) {
  // Only used on small screens, where the sidebar slides in
  const [isNavOpen, setIsNavOpen] = useState(false);

  return (
    <div className="flex h-full">
      <Sidebar isOpen={isNavOpen} onNavigate={() => setIsNavOpen(false)} />

      {isNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setIsNavOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenNav={() => setIsNavOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
