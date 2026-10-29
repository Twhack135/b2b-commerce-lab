"use client";

import { useRef, useState } from "react";
import { ApiError, errorMessage } from "@/lib/erp-api";
import {
  GENERIC_VALIDATION_MESSAGE,
  splitValidationMessages,
} from "@/lib/form-errors";
import {
  parsePrice,
  validateMaterialForm,
  type FieldErrors,
  type MaterialFormField,
  type MaterialFormValues,
} from "@/lib/material-validation";
import { createMaterial, updateMaterial, type Material } from "@/lib/materials";
import {
  Field,
  FormActions,
  FormErrorAlert,
  inputClass,
} from "../forms/form-controls";
import { SidePanel } from "../forms/side-panel";

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
      const { fieldErrors, otherMessages } = splitValidationMessages(
        error.messages,
        FIELDS,
      );
      setServerErrors(fieldErrors);
      setGeneralError(
        otherMessages.length > 0 ? otherMessages : [GENERIC_VALIDATION_MESSAGE],
      );
      return;
    }

    setGeneralError(error.messages);
  }

  const title =
    mode === "create" ? "New Material" : `Edit ${material?.materialNumber}`;

  return (
    <SidePanel title={title} isBusy={isSubmitting} onClose={onClose}>
      <form
        noValidate
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          {generalError && <FormErrorAlert messages={generalError} />}

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

        <FormActions
          isSubmitting={isSubmitting}
          submitLabel={mode === "create" ? "Create Material" : "Save Changes"}
          onCancel={onClose}
        />
      </form>
    </SidePanel>
  );
}
