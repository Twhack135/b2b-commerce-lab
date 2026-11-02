"use client";

import { useEffect, useRef, useState } from "react";
import type { IssuedActivationLink } from "@/lib/shop-users";
import { formatTimestamp } from "@/lib/shop-user-display";

/**
 * Shows a new activation link exactly once. The link only lives in the
 * component state of this dialog: it is never written to browser storage,
 * the address bar or a log, and it is gone when the dialog closes. The
 * Backoffice cannot show it again; a new link replaces it.
 */
export function ActivationLinkDialog({
  link,
  recipient,
  onClose,
}: {
  link: IssuedActivationLink;
  recipient: { displayName: string; email: string };
  onClose: () => void;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.activationLink);
      setCopy("copied");
    } catch {
      // Without clipboard access the text stays selected for Ctrl+C
      fieldRef.current?.select();
      setCopy("manual");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="activation-link-title"
        data-activation-link-dialog
        className="relative flex max-h-full w-full max-w-xl flex-col rounded-t-lg bg-surface shadow-xl sm:rounded-lg"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 id="activation-link-title" className="text-base font-semibold">
            Activation link for {recipient.displayName}
          </h2>
          <p className="mt-0.5 text-ink-muted">{recipient.email}</p>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-warning">
            <p className="font-semibold">Shown only this once</p>
            <p className="mt-0.5">
              Copy the link now and give it to the person through a trusted channel. Anyone with the link can set the
              password. It works once and expires on {formatTimestamp(link.expiresAt)}.
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block font-medium">Activation link</span>
            <input
              ref={fieldRef}
              readOnly
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={link.activationLink}
              data-activation-link
              onFocus={(event) => event.target.select()}
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 font-mono text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <p role="status" className="min-h-5 text-xs">
            {copy === "copied" && <span className="text-success">Copied to the clipboard.</span>}
            {copy === "manual" && (
              <span className="text-ink-muted">The link is selected: copy it with Ctrl+C (Cmd+C on a Mac).</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={copyLink}
            className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-canvas"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={onClose}
            data-activation-link-done
            className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
