// Building blocks shared by the master data list pages (materials, customers)
import {
  AlertIcon,
  CheckIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from "./icons";

export function PageHeader({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          Master Data
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-ink-muted">{description}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 font-medium text-white shadow-sm hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <PlusIcon />
        {actionLabel}
      </button>
    </div>
  );
}

export function SuccessNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mt-6 flex items-center gap-2 rounded-md border border-success/30 bg-success-soft px-4 py-3 text-success"
    >
      <CheckIcon />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs font-medium underline"
      >
        Dismiss
      </button>
    </div>
  );
}

export function SearchInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative flex-1 sm:w-72 sm:flex-none">
      <span className="sr-only">{label}</span>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-line py-2 pr-3 pl-9 outline-none placeholder:text-ink-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}

export function RefreshButton({
  isLoading,
  onClick,
}: {
  isLoading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 font-medium hover:bg-canvas disabled:opacity-60"
    >
      <RefreshIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
      Refresh
    </button>
  );
}

export function LoadError({
  title,
  message,
  isRetrying,
  onRetry,
}: {
  title: string;
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="grid size-10 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertIcon className="size-5" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-ink-muted">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {isRetrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

export function LoadingRows({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="divide-y divide-line">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex animate-pulse gap-6 px-4 py-4">
          <div className="h-4 w-24 rounded bg-canvas" />
          <div className="h-4 flex-1 rounded bg-canvas" />
          <div className="h-4 w-20 rounded bg-canvas" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-ink-muted">{text}</p>
    </div>
  );
}
