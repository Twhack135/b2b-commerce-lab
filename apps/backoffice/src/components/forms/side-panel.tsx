"use client";

import { useEffect } from "react";
import { CloseIcon } from "../icons";

const WIDTHS = {
  md: "max-w-md",
  // For forms with lists, e.g. B2B unit partners
  lg: "max-w-2xl",
};

/**
 * Panel that slides in from the right, used for create and edit forms.
 * While `isBusy` is true (e.g. saving), it cannot be closed.
 */
export function SidePanel({
  title,
  isBusy,
  onClose,
  size = "md",
  children,
}: {
  title: string;
  isBusy: boolean;
  onClose: () => void;
  size?: keyof typeof WIDTHS;
  children: React.ReactNode;
}) {
  // Close with the Escape key, unless a save is in progress
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isBusy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close panel"
        className="absolute inset-0 bg-black/30"
        onClick={() => !isBusy && onClose()}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="side-panel-title"
        className={`relative flex h-full w-full ${WIDTHS[size]} flex-col bg-surface shadow-xl`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
          <h2 id="side-panel-title" className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Close"
            className="rounded-md p-1.5 text-ink-muted hover:bg-canvas disabled:opacity-50"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
