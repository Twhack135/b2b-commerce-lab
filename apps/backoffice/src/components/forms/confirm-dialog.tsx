"use client";

import { useEffect, useRef } from "react";

/**
 * A centered dialog that asks for an explicit confirmation before a
 * permanent action. While `isBusy` is true it cannot be closed or confirmed
 * a second time.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  busyLabel,
  isBusy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  busyLabel: string;
  isBusy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // The safe choice has the focus; Escape cancels unless the action runs
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isBusy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 bg-black/30"
        onClick={() => !isBusy && onCancel()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative flex max-h-full w-full max-w-lg flex-col rounded-t-lg bg-surface shadow-xl sm:rounded-lg"
      >
        <h2 id="confirm-dialog-title" className="border-b border-line px-5 py-4 text-base font-semibold">
          {title}
        </h2>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-line px-5 py-4">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {isBusy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
