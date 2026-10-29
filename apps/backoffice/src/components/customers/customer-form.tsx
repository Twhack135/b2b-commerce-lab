"use client";

import { useRef, useState } from "react";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import {
  MAX_LENGTH,
  validateCustomerForm,
  type CustomerFieldErrors,
  type CustomerFormField,
  type CustomerFormValues,
} from "@/lib/customer-validation";
import {
  createCustomer,
  updateCustomer,
  type Customer,
} from "@/lib/customers";
import { ApiError, errorMessage } from "@/lib/erp-api";
import {
  GENERIC_VALIDATION_MESSAGE,
  splitValidationMessages,
} from "@/lib/form-errors";
import {
  Field,
  FormActions,
  FormErrorAlert,
  inputClass,
} from "../forms/form-controls";
import { SidePanel } from "../forms/side-panel";

const FIELDS: CustomerFormField[] = [
  "customerNumber",
  "name",
  "street",
  "postalCode",
  "city",
  "country",
];

/**
 * Side panel for creating a customer (no `customer` given)
 * or editing an existing one.
 */
export function CustomerForm({
  customer,
  onClose,
  onSaved,
}: {
  customer?: Customer;
  onClose: () => void;
  onSaved: (customer: Customer, mode: "create" | "edit") => void;
}) {
  const mode = customer ? "edit" : "create";

  const [values, setValues] = useState<CustomerFormValues>({
    customerNumber: customer?.customerNumber ?? "",
    name: customer?.name ?? "",
    street: customer?.street ?? "",
    postalCode: customer?.postalCode ?? "",
    city: customer?.city ?? "",
    country: customer?.country ?? "DE",
    isActive: customer?.isActive ?? true,
  });
  // Fields the user has left at least once; errors show only for those
  const [touched, setTouched] = useState<Set<CustomerFormField>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Errors reported by the ERP API, shown until the field is changed
  const [serverErrors, setServerErrors] = useState<CustomerFieldErrors>({});
  const [generalError, setGeneralError] = useState<string[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A ref changes immediately, so a fast double click cannot submit twice
  const submittingRef = useRef(false);

  const clientErrors = validateCustomerForm(values, mode);

  function visibleError(field: CustomerFormField) {
    if (serverErrors[field]) return serverErrors[field];
    if (submitAttempted || touched.has(field)) return clientErrors[field];
    return undefined;
  }

  function change(field: CustomerFormField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
  }

  function touch(field: CustomerFormField) {
    setTouched((current) => new Set(current).add(field));
  }

  /** Common props for the text inputs */
  function textInput(field: CustomerFormField) {
    return {
      id: field,
      value: values[field],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        change(field, event.target.value),
      onBlur: () => touch(field),
      autoComplete: "off",
      className: inputClass(visibleError(field)),
    };
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
      name: values.name.trim(),
      street: values.street.trim(),
      postalCode: values.postalCode.trim(),
      city: values.city.trim(),
      country: values.country,
      isActive: values.isActive,
    };

    try {
      const saved = customer
        ? await updateCustomer(customer.customerNumber, changes)
        : await createCustomer({
            customerNumber: values.customerNumber,
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
        customerNumber: `Customer ${values.customerNumber} already exists. Use a different customer number.`,
      });
      return;
    }

    if (error.status === 404) {
      setGeneralError([
        "This customer no longer exists. Close the panel and refresh the list.",
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
    mode === "create" ? "New Customer" : `Edit ${customer?.customerNumber}`;

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
            id="customerNumber"
            label="Customer Number"
            error={visibleError("customerNumber")}
            hint={
              mode === "edit"
                ? "The customer number cannot be changed."
                : `Unique key, for example CUST-0004. At most ${MAX_LENGTH.customerNumber} characters.`
            }
          >
            <input
              {...textInput("customerNumber")}
              readOnly={mode === "edit"}
              autoFocus={mode === "create"}
              className={inputClass(
                visibleError("customerNumber"),
                mode === "edit",
              )}
            />
          </Field>

          <Field id="name" label="Name" error={visibleError("name")}>
            <input {...textInput("name")} autoFocus={mode === "edit"} />
          </Field>

          <Field id="street" label="Street" error={visibleError("street")}>
            <input {...textInput("street")} />
          </Field>

          <div className="grid grid-cols-[8rem_1fr] gap-4">
            <Field
              id="postalCode"
              label="Postal Code"
              error={visibleError("postalCode")}
            >
              <input {...textInput("postalCode")} />
            </Field>

            <Field id="city" label="City" error={visibleError("city")}>
              <input {...textInput("city")} />
            </Field>
          </div>

          <Field id="country" label="Country" error={visibleError("country")}>
            <select
              id="country"
              value={values.country}
              onChange={(event) => change("country", event.target.value)}
              onBlur={() => touch("country")}
              className={`${inputClass(visibleError("country"))} bg-surface`}
            >
              <option value="">Select a country</option>
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} ({option.code})
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-md border border-line px-4 py-3">
            <div>
              <label htmlFor="isActive" className="font-medium">
                Active
              </label>
              <p className="mt-0.5 text-xs text-ink-muted">
                Inactive customers stay in the system but are marked as not in
                use.
              </p>
            </div>
            <input
              id="isActive"
              type="checkbox"
              role="switch"
              checked={values.isActive}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
              className="mt-1 size-5 shrink-0 accent-brand"
            />
          </div>
        </div>

        <FormActions
          isSubmitting={isSubmitting}
          submitLabel={mode === "create" ? "Create Customer" : "Save Changes"}
          onCancel={onClose}
        />
      </form>
    </SidePanel>
  );
}
