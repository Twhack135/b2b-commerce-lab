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
  secondaryAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  secondaryAction?: { label: string; onClick: () => void };
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
      <div className="flex flex-wrap gap-2">
        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-2 font-medium shadow-sm hover:bg-canvas"
          >
            {secondaryAction.label}
          </button>
        )}
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 font-medium text-white shadow-sm hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <PlusIcon />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

export type StatusFilterValue = "all" | "active" | "inactive";

const STATUS_FILTERS: { value: StatusFilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/** True if an item with this status passes the filter */
export function matchesStatus(filter: StatusFilterValue, isActive: boolean) {
  return filter === "all" || isActive === (filter === "active");
}

/** All / Active / Inactive switch with counts */
export function StatusFilter({
  value,
  onChange,
  counts,
}: {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
  counts?: Record<StatusFilterValue, number>;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Filter by status"
      className="inline-flex rounded-md border border-line p-0.5"
    >
      {STATUS_FILTERS.map((filter) => {
        const isSelected = value === filter.value;
        return (
          <button
            key={filter.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(filter.value)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              isSelected
                ? "bg-brand-soft text-brand-strong"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {filter.label}
            {counts && (
              <span className="ml-1 tabular-nums opacity-70">
                {counts[filter.value]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Counts for StatusFilter */
export function statusCounts(items: { isActive: boolean }[]) {
  const active = items.filter((item) => item.isActive).length;
  return { all: items.length, active, inactive: items.length - active };
}

/** Green "Active" or grey "Inactive" badge */
export function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-success">
      <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-ink-muted">
      <span className="size-1.5 rounded-full bg-ink-muted" aria-hidden="true" />
      Inactive
    </span>
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
