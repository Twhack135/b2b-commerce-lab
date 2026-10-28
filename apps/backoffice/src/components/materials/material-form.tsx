"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "@/lib/erp-api";
import {
  parsePrice,
  validateMaterialForm,
  type FieldErrors,
  type MaterialFormField,
  type MaterialFormValues,
} from "@/lib/material-validation";
import { createMaterial, updateMaterial, type Material } from "@/lib/materials";
import { AlertIcon, CloseIcon } from "../icons";

const FIELDS: MaterialFormField[] = [
  "materialNumber",
  "description",
  "price",
  "currency",
];

/**
 * Side panel for creating a material (no `material` given)
 * or editing an existing one.
 */
export function MaterialForm({
  material,
  onClose,
  onSaved,
}: {
  material?: Material;
  onClose: () => void;
  onSaved: (material: Material, mode: "create" | "edit") => void;
}) {
  const mode = material ? "edit" : "create";

  const [values, setValues] = useState<MaterialFormValues>({
    materialNumber: material?.materialNumber ?? "",
    description: material?.description ?? "",
    price: material ? material.price.toFixed(2) : "",
    currency: material?.currency ?? "EUR",
  });
  // Fields the user has left at least once; errors show only for those
  const [touched, setTouched] = useState<Set<MaterialFormField>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Errors reported by the ERP API, shown until the field is changed
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A ref changes immediately, so a fast double click cannot submit twice
  const submittingRef = useRef(false);

  const clientErrors = validateMaterialForm(values, mode);

  function visibleError(field: MaterialFormField) {
    if (serverErrors[field]) return serverErrors[field];
    if (submitAttempted || touched.has(field)) return clientErrors[field];
    return undefined;
  }

  function change(field: MaterialFormField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
  }

  function touch(field: MaterialFormField) {
    setTouched((current) => new Set(current).add(field));
  }

  // Close with the Escape key, unless a save is in progress
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submittingRef.current) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    setSubmitAttempted(true);
    setGeneralError(null);
    if (Object.keys(clientErrors).length > 0) return;

    submittingRef.current = true;
    setIsSubmitting(true);

    const changes = {
      description: values.description.trim(),
      price: parsePrice(values.price),
      currency: values.currency,
    };

    try {
      const saved = material
        ? await updateMaterial(material.materialNumber, changes)
        : await createMaterial({
            materialNumber: values.materialNumber,
            ...changes,
          });
      onSaved(saved, mode);
    } catch (error) {
      // Keep all user input so nothing is lost after an error
      showApiError(error);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function showApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setGeneralError([errorMessage(error)]);
      return;
    }

    if (error.status === 409) {
      setServerErrors({
        materialNumber: `Material ${values.materialNumber} already exists. Use a different material number.`,
      });
      return;
    }

    if (error.status === 404) {
      setGeneralError([
        "This material no longer exists. Close the panel and refresh the list.",
      ]);
      return;
    }

    if (error.status === 400) {
      // NestJS messages start with the field name, e.g. "price must ..."
      const fieldErrors: FieldErrors = {};
      const otherMessages: string[] = [];
      for (const message of error.messages) {
        const field = FIELDS.find((name) => message.startsWith(`${name} `));
        if (field && !fieldErrors[field]) {
          fieldErrors[field] = capitalize(message) + ".";
        } else if (!field) {
          otherMessages.push(capitalize(message) + ".");
        }
      }
      setServerErrors(fieldErrors);
      setGeneralError(
        otherMessages.length > 0
          ? otherMessages
          : ["The ERP API rejected the input. Please check the fields."],
      );
      return;
    }

    setGeneralError(error.messages);
  }

  const title =
    mode === "create" ? "New Material" : `Edit ${material?.materialNumber}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close panel"
        className="absolute inset-0 bg-black/30"
        onClick={() => !isSubmitting && onClose()}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="material-form-title"
        className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-xl"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
          <h2 id="material-form-title" className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="rounded-md p-1.5 text-ink-muted hover:bg-canvas disabled:opacity-50"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        <form
          noValidate
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            {generalError && (
              <div
                role="alert"
                className="flex gap-2 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-danger"
              >
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                <div className="space-y-1">
                  {generalError.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              </div>
            )}

            <Field
              id="materialNumber"
              label="Material Number"
              error={visibleError("materialNumber")}
              hint={
                mode === "edit"
                  ? "The material number cannot be changed."
                  : "Unique key, for example MAT-003."
              }
            >
              <input
                id="materialNumber"
                value={values.materialNumber}
                onChange={(event) => change("materialNumber", event.target.value)}
                onBlur={() => touch("materialNumber")}
                readOnly={mode === "edit"}
                autoFocus={mode === "create"}
                autoComplete="off"
                className={inputClass(
                  visibleError("materialNumber"),
                  mode === "edit",
                )}
              />
            </Field>

            <Field
              id="description"
              label="Description"
              error={visibleError("description")}
            >
              <input
                id="description"
                value={values.description}
                onChange={(event) => change("description", event.target.value)}
                onBlur={() => touch("description")}
                autoFocus={mode === "edit"}
                autoComplete="off"
                className={inputClass(visibleError("description"))}
              />
            </Field>

            <div className="grid grid-cols-[1fr_7rem] gap-4">
              <Field
                id="price"
                label="Price"
                error={visibleError("price")}
                hint="Up to two decimal places."
              >
                <input
                  id="price"
                  inputMode="decimal"
                  value={values.price}
                  onChange={(event) => change("price", event.target.value)}
                  onBlur={() => touch("price")}
                  placeholder="0.00"
                  autoComplete="off"
                  className={`${inputClass(visibleError("price"))} text-right tabular-nums`}
                />
              </Field>

              <Field
                id="currency"
                label="Currency"
                error={visibleError("currency")}
              >
                <input
                  id="currency"
                  value={values.currency}
                  // Currency codes are always uppercase, e.g. EUR
                  onChange={(event) =>
                    change("currency", event.target.value.toUpperCase())
                  }
                  onBlur={() => touch("currency")}
                  maxLength={3}
                  autoComplete="off"
                  className={`${inputClass(visibleError("currency"))} uppercase`}
                />
              </Field>
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-line bg-canvas/50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
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
              {isSubmitting
                ? "Saving…"
                : mode === "create"
                  ? "Create Material"
                  : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
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

function inputClass(error: string | undefined, readOnly = false) {
  const base =
    "w-full rounded-md border px-3 py-2 outline-none focus:ring-2";
  if (readOnly) {
    return `${base} cursor-not-allowed border-line bg-canvas font-mono text-ink-muted focus:ring-0`;
  }
  return error
    ? `${base} border-danger focus:ring-danger/20`
    : `${base} border-line focus:border-brand focus:ring-brand/20`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
