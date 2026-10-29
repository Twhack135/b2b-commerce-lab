import { AlertIcon } from "../icons";

/** Label, input and either an error or a hint below it */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

/** CSS classes for text inputs and selects */
export function inputClass(error: string | undefined, readOnly = false) {
  const base = "w-full rounded-md border px-3 py-2 outline-none focus:ring-2";
  if (readOnly) {
    return `${base} cursor-not-allowed border-line bg-canvas font-mono text-ink-muted focus:ring-0`;
  }
  return error
    ? `${base} border-danger focus:ring-danger/20`
    : `${base} border-line focus:border-brand focus:ring-brand/20`;
}

/** Error box at the top of a form, for errors that belong to no field */
export function FormErrorAlert({ messages }: { messages: string[] }) {
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-danger"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </div>
  );
}

/** Cancel and submit buttons at the bottom of a side panel form */
export function FormActions({
  isSubmitting,
  submitLabel,
  onCancel,
}: {
  isSubmitting: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex shrink-0 justify-end gap-3 border-t border-line bg-canvas/50 px-6 py-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-canvas disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}
