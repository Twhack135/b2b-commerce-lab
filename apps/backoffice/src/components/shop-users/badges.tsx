import type { Tone } from "@/lib/shop-user-display";

const TONES: Record<Tone, { badge: string; dot: string }> = {
  success: { badge: "bg-success-soft text-success", dot: "bg-success" },
  warning: { badge: "bg-warning-soft text-warning", dot: "bg-warning" },
  danger: { badge: "bg-danger-soft text-danger", dot: "bg-danger" },
  info: { badge: "bg-brand-soft text-brand-strong", dot: "bg-brand" },
  neutral: { badge: "bg-canvas text-ink-muted", dot: "bg-ink-muted" },
};

/** A small state badge; the hint is the tooltip and screen reader text */
export function ToneBadge({ label, tone, hint }: { label: string; tone: Tone; hint?: string }) {
  const style = TONES[tone];
  return (
    <span
      title={hint}
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${style.badge}`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {label}
      {hint && <span className="sr-only">: {hint}</span>}
    </span>
  );
}

/** The Backoffice has no administrator sign-in: it says so where it matters */
export function LocalOnlyNotice() {
  return (
    <div
      role="note"
      data-local-only-notice
      className="mt-6 flex gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-warning"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true" className="mt-0.5 size-5 shrink-0">
        <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" strokeLinejoin="round" />
        <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
      </svg>
      <div>
        <p className="font-semibold">Local administration without sign-in</p>
        <p className="mt-0.5">
          This Backoffice has no administrator sign-in yet. It may only run on this computer and must never be made
          reachable from other computers. Treat activation links like passwords.
        </p>
      </div>
    </div>
  );
}
