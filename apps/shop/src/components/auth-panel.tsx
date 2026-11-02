// The frame of the sign-in and activation pages: a calm brand panel with
// the promise of the shop next to a focused form card. Stacked on phones.

const POINTS = [
  "Your contract prices, determined live by the ERP",
  "Ordering for the units your company authorized",
  "Every order confirmed with its own document",
];

export function AuthPanel({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_48px_-24px_rgba(20,33,61,0.35)] md:grid-cols-[5fr_6fr]">
      <aside className="relative hidden flex-col justify-between bg-shell p-8 text-white md:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(11,107,203,0.55),transparent_60%)]"
        />
        <div className="relative">
          <p className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">B2B Commerce Lab</p>
          <p className="mt-3 text-2xl leading-snug font-semibold">Ordering for business customers</p>
        </div>
        <ul className="relative space-y-3 text-sm text-white/80">
          {POINTS.map((point) => (
            <li key={point} className="flex gap-3">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/70" />
              {point}
            </li>
          ))}
        </ul>
      </aside>
      <section className="px-6 py-8 sm:px-10 sm:py-12">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-ink-muted">{intro}</p>
        <div className="mt-8">{children}</div>
      </section>
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base outline-none transition-shadow placeholder:text-ink-muted/60 focus:border-brand focus:ring-4 focus:ring-brand/15 aria-invalid:border-danger";

export const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-base font-medium text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-70";

export function Notice({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  const style = {
    error: "border-danger/30 bg-danger-soft text-danger",
    success: "border-success/30 bg-success-soft text-success",
    info: "border-line bg-canvas text-ink",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} data-notice={kind} className={`rounded-lg border px-4 py-3 text-sm ${style}`}>
      {children}
    </div>
  );
}
