"use client";

import { useRef, useState } from "react";
import type { B2bUnit } from "@/lib/b2b-units";
import type { Customer } from "@/lib/customers";
import { todayIsoDate } from "@/lib/dates";
import { ApiError, errorMessage } from "@/lib/erp-api";
import {
  GENERIC_VALIDATION_MESSAGE,
  splitValidationMessages,
} from "@/lib/form-errors";
import {
  conditionTypeLabel,
  RESTRICTION_TEXTS,
} from "@/lib/condition-type-display";
import type { ConditionType } from "@/lib/condition-types";
import type { Material } from "@/lib/materials";
import { formatAmount } from "@/lib/money";
import {
  conditionToForm,
  conditionWarnings,
  conflictingConditionId,
  emptyConditionForm,
  PRICE_CONDITION_FIELDS,
  PRICE_CONDITION_LABELS,
  SCOPE_LABELS,
  soldToOptions,
  toCreateInput,
  toUpdateInput,
  unitOptions,
  validatePriceConditionForm,
  type PriceConditionFieldErrors,
  type PriceConditionFormField,
  type PriceConditionFormValues,
} from "@/lib/price-condition-form";
import {
  createPriceCondition,
  updatePriceCondition,
  type PriceCondition,
  type PriceConditionScope,
} from "@/lib/price-conditions";
import { AlertIcon } from "../icons";
import {
  Field,
  FormActions,
  FormErrorAlert,
  inputClass,
} from "../forms/form-controls";
import { SidePanel } from "../forms/side-panel";

const SCOPES: { value: PriceConditionScope; hint: string }[] = [
  { value: "B2B_UNIT", hint: "Highest priority: price for one ordering unit" },
  { value: "SOLD_TO", hint: "For all units with this Sold-to" },
];

/**
 * Side panel for creating a price condition (no `condition` given) or
 * editing one. Material, level, Sold-to or unit and currency are fixed after
 * creation; amount, validity and status can be changed.
 */
export function PriceConditionForm({
  condition,
  conditionTypes,
  conditionTypesError,
  materials,
  customers,
  units,
  onClose,
  onSaved,
}: {
  condition?: PriceCondition;
  /** null while loading */
  conditionTypes: ConditionType[] | null;
  conditionTypesError: string | null;
  materials: Material[] | null;
  customers: Customer[] | null;
  units: B2bUnit[] | null;
  onClose: () => void;
  onSaved: (condition: PriceCondition, mode: "create" | "edit") => void;
}) {
  const mode = condition ? "edit" : "create";

  const [values, setValues] = useState<PriceConditionFormValues>(() =>
    condition ? conditionToForm(condition) : emptyConditionForm(todayIsoDate()),
  );
  // Fields the user has changed or left; errors show only for those
  const [touched, setTouched] = useState<Set<PriceConditionFormField>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Errors reported by the ERP API, shown until the field is changed
  const [serverErrors, setServerErrors] = useState<PriceConditionFieldErrors>({});
  const [generalError, setGeneralError] = useState<string[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A ref changes immediately, so a fast double click cannot submit twice
  const submittingRef = useRef(false);

  const clientErrors = validatePriceConditionForm(values, {
    mode,
    materials: materials ?? [],
    customers: customers ?? [],
    units: units ?? [],
    conditionTypes: conditionTypes ?? [],
    original: condition,
  });

  function visibleError(field: PriceConditionFormField) {
    if (serverErrors[field]) return serverErrors[field];
    if (submitAttempted || touched.has(field)) return clientErrors[field];
    return undefined;
  }

  function change(changes: Partial<PriceConditionFormValues>) {
    const fields = Object.keys(changes) as PriceConditionFormField[];
    setValues((current) => ({ ...current, ...changes }));
    setTouched((current) => new Set([...current, ...fields]));
    setServerErrors((current) => {
      const copy = { ...current };
      for (const field of fields) delete copy[field];
      // A changed period may resolve an overlap reported for the other date
      if (fields.includes("validFrom") || fields.includes("validTo")) {
        delete copy.validFrom;
        delete copy.validTo;
      }
      return copy;
    });
  }

  function touch(field: PriceConditionFormField) {
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
    try {
      const saved = condition
        ? await updatePriceCondition(condition.conditionId, toUpdateInput(values))
        : await createPriceCondition(toCreateInput(values, materials ?? []));
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
      const otherId = conflictingConditionId(error.messages);
      const hint = otherId
        ? `Overlaps with price condition ${otherId}.`
        : "Overlaps with another active price condition.";
      setServerErrors({ validFrom: hint, validTo: hint });
      setGeneralError([
        ...error.messages.map((m) => (m.endsWith(".") ? m : `${m}.`)),
        "Change the validity period, or deactivate one of the two conditions.",
      ]);
      return;
    }
    if (error.status === 404) {
      setGeneralError([
        "This price condition no longer exists. Close the panel and refresh the list.",
      ]);
      return;
    }
    if (error.status === 400 || error.status === 422) {
      const { fieldErrors, otherMessages } = splitValidationMessages(
        error.messages,
        PRICE_CONDITION_FIELDS,
        PRICE_CONDITION_LABELS,
      );
      setServerErrors(fieldErrors);
      setGeneralError(
        otherMessages.length > 0
          ? otherMessages
          : [
              error.status === 422
                ? "The ERP API rejected the price condition. Please check the marked fields."
                : GENERIC_VALIDATION_MESSAGE,
            ],
      );
      return;
    }
    // e.g. 5xx, network
    setGeneralError(error.messages);
  }

  const material = materials?.find((m) => m.materialNumber === values.materialNumber);
  const currency = condition?.currency ?? material?.currency;
  const warnings = condition ? conditionWarnings(condition) : [];
  const title = condition
    ? `Edit Price Condition ${condition.conditionId}`
    : "New Price Condition";

  return (
    <SidePanel title={title} isBusy={isSubmitting} onClose={onClose}>
      <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          {generalError && <FormErrorAlert messages={generalError} />}

          {warnings.length > 0 && (
            <div
              role="status"
              className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-danger"
            >
              <p className="flex items-center gap-2 font-medium">
                <AlertIcon className="size-4" />
                {warnings.join(". ")}.
              </p>
              <p className="mt-1 text-xs">
                The condition stays as it is, but it cannot be reactivated
                while this is the case. The price check rejects inactive units
                and Sold-tos.
              </p>
            </div>
          )}

          {/* Condition type: what kind of price this record is */}
          <Field
            id="conditionTypeCode"
            label="Condition type"
            error={visibleError("conditionTypeCode")}
            hint={
              mode === "edit"
                ? "Cannot be changed."
                : "Only condition types that are usable for condition records can be selected."
            }
          >
            {condition ? (
              <ReadOnly>
                <span data-read-only-condition-type className="font-mono">
                  {condition.conditionType.code}
                </span>{" "}
                – {condition.conditionType.name}
              </ReadOnly>
            ) : (
              <select
                id="conditionTypeCode"
                value={values.conditionTypeCode}
                disabled={conditionTypes === null}
                onChange={(e) => change({ conditionTypeCode: e.target.value })}
                onBlur={() => touch("conditionTypeCode")}
                className={`${inputClass(visibleError("conditionTypeCode"))} bg-surface`}
              >
                <option value="">
                  {conditionTypes === null
                    ? conditionTypesError
                      ? "Condition types could not be loaded"
                      : "Loading condition types…"
                    : "Select a condition type"}
                </option>
                {conditionTypes?.map((type) => (
                  <option
                    key={type.code}
                    value={type.code}
                    disabled={!type.usableForPriceConditions}
                  >
                    {conditionTypeLabel(type)}
                    {type.restriction ? ` (${RESTRICTION_TEXTS[type.restriction]})` : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {/* Material */}
          <Field
            id="materialNumber"
            label="Material"
            error={visibleError("materialNumber")}
            hint={
              mode === "edit"
                ? "Cannot be changed."
                : material
                  ? `Base price ${formatAmount(material.price.toFixed(2))} ${material.currency} (fallback if no condition applies)`
                  : undefined
            }
          >
            {condition ? (
              <ReadOnly>
                <span className="font-mono">{condition.materialNumber}</span> –{" "}
                {condition.materialDescription}
              </ReadOnly>
            ) : (
              <select
                id="materialNumber"
                value={values.materialNumber}
                disabled={materials === null}
                autoFocus
                onChange={(e) => change({ materialNumber: e.target.value })}
                onBlur={() => touch("materialNumber")}
                className={`${inputClass(visibleError("materialNumber"))} bg-surface`}
              >
                <option value="">
                  {materials === null ? "Loading materials…" : "Select a material"}
                </option>
                {materials?.map((m) => (
                  <option key={m.materialNumber} value={m.materialNumber}>
                    {m.materialNumber} – {m.description} ({m.currency})
                  </option>
                ))}
              </select>
            )}
          </Field>

          {/* Level */}
          <fieldset>
            <legend className="mb-1.5 font-medium">Level</legend>
            {condition ? (
              <ReadOnly>{SCOPE_LABELS[condition.scope]} price</ReadOnly>
            ) : (
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
                {SCOPES.map((scope) => (
                  <label
                    key={scope.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${
                      values.scope === scope.value
                        ? "border-brand bg-brand-soft/40"
                        : "border-line hover:bg-canvas"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scope"
                      value={scope.value}
                      checked={values.scope === scope.value}
                      onChange={() =>
                        change({ scope: scope.value, soldToCustomerNumber: "", unitId: "" })
                      }
                      className="mt-1 accent-brand"
                    />
                    <span>
                      <span className="block font-medium">{SCOPE_LABELS[scope.value]}</span>
                      <span className="block text-xs text-ink-muted">{scope.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {visibleError("scope") && (
              <p role="alert" className="mt-1.5 text-xs text-danger">
                {visibleError("scope")}
              </p>
            )}
          </fieldset>

          {/* Sold-to or unit */}
          {values.scope === "B2B_UNIT" && (
            <Field
              id="unitId"
              label="B2B Unit"
              error={visibleError("unitId")}
              hint={mode === "edit" ? "Cannot be changed." : "Only active units with an active Sold-to."}
            >
              {condition?.unit ? (
                <ReadOnly>
                  <span className="font-mono">{condition.unit.unitId}</span> – {condition.unit.name}{" "}
                  <span className="text-xs">(Sold-to {condition.unit.soldTo.customerNumber})</span>
                </ReadOnly>
              ) : (
                <select
                  id="unitId"
                  value={values.unitId}
                  disabled={units === null}
                  onChange={(e) => change({ unitId: e.target.value })}
                  onBlur={() => touch("unitId")}
                  className={`${inputClass(visibleError("unitId"))} bg-surface`}
                >
                  <option value="">{units === null ? "Loading B2B units…" : "Select a B2B unit"}</option>
                  {unitOptions(units ?? []).map((u) => (
                    <option key={u.unitId} value={u.unitId} disabled={!u.isSelectable}>
                      {u.unitId} – {u.name} (Sold-to {u.soldToCustomerNumber})
                      {u.note ? ` – ${u.note}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {values.scope === "SOLD_TO" && (
            <Field
              id="soldToCustomerNumber"
              label="Sold-to Customer"
              error={visibleError("soldToCustomerNumber")}
              hint={
                mode === "edit"
                  ? "Cannot be changed."
                  : "Applies to all B2B units with this Sold-to, unless a unit has its own price."
              }
            >
              {condition?.soldTo ? (
                <ReadOnly>
                  <span className="font-mono">{condition.soldTo.customerNumber}</span> –{" "}
                  {condition.soldTo.name}
                </ReadOnly>
              ) : (
                <select
                  id="soldToCustomerNumber"
                  value={values.soldToCustomerNumber}
                  disabled={customers === null}
                  onChange={(e) => change({ soldToCustomerNumber: e.target.value })}
                  onBlur={() => touch("soldToCustomerNumber")}
                  className={`${inputClass(visibleError("soldToCustomerNumber"))} bg-surface`}
                >
                  <option value="">{customers === null ? "Loading customers…" : "Select a customer"}</option>
                  {soldToOptions(customers ?? []).map((c) => (
                    <option key={c.customerNumber} value={c.customerNumber} disabled={!c.isActive}>
                      {c.customerNumber} – {c.name}
                      {c.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {/* Amount */}
          <Field
            id="amount"
            label="Price per piece"
            error={visibleError("amount")}
            hint="Up to two decimal places, e.g. 4200.50."
          >
            <div className="flex items-stretch">
              <input
                id="amount"
                inputMode="decimal"
                autoComplete="off"
                value={values.amount}
                onChange={(e) => change({ amount: e.target.value })}
                onBlur={() => touch("amount")}
                className={`${inputClass(visibleError("amount"))} rounded-r-none text-right tabular-nums`}
              />
              <span className="inline-flex items-center rounded-r-md border border-l-0 border-line bg-canvas px-3 font-mono text-ink-muted">
                {currency ?? "—"}
              </span>
            </div>
          </Field>

          {/* Validity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="validFrom" label="Valid from" error={visibleError("validFrom")}>
              <input
                id="validFrom"
                type="date"
                value={values.validFrom}
                onChange={(e) => change({ validFrom: e.target.value })}
                onBlur={() => touch("validFrom")}
                className={inputClass(visibleError("validFrom"))}
              />
            </Field>
            <Field
              id="validTo"
              label="Valid to"
              error={visibleError("validTo")}
              hint="Inclusive. Leave empty for open-ended."
            >
              <input
                id="validTo"
                type="date"
                value={values.validTo}
                min={values.validFrom || undefined}
                onChange={(e) => change({ validTo: e.target.value })}
                onBlur={() => touch("validTo")}
                className={inputClass(visibleError("validTo"))}
              />
            </Field>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border border-line px-4 py-3">
            <div>
              <label htmlFor="isActive" className="font-medium">
                Active
              </label>
              <p className="mt-0.5 text-xs text-ink-muted">
                Inactive conditions are ignored by the price determination and
                do not block other validity periods.
              </p>
            </div>
            <input
              id="isActive"
              type="checkbox"
              role="switch"
              checked={values.isActive}
              onChange={(e) => {
                const isActive = e.target.checked;
                setValues((v) => ({ ...v, isActive }));
                // The status decides whether inactive partners are an error
                setServerErrors((current) => ({
                  ...current,
                  unitId: undefined,
                  soldToCustomerNumber: undefined,
                }));
              }}
              className="mt-1 size-5 shrink-0 accent-brand"
            />
          </div>
        </div>

        <FormActions
          isSubmitting={isSubmitting}
          submitLabel={mode === "create" ? "Create Price Condition" : "Save Changes"}
          onCancel={onClose}
        />
      </form>
    </SidePanel>
  );
}

function ReadOnly({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-canvas px-3 py-2 text-ink-muted">
      {children}
    </div>
  );
}
