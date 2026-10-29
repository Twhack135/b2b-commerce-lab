"use client";

import { useRef, useState } from "react";
import type { B2bUnit } from "@/lib/b2b-units";
import { todayIsoDate } from "@/lib/dates";
import { ApiError, errorMessage } from "@/lib/erp-api";
import {
  GENERIC_VALIDATION_MESSAGE,
  splitValidationMessages,
} from "@/lib/form-errors";
import type { Material } from "@/lib/materials";
import { formatAmount } from "@/lib/money";
import { unitOptions } from "@/lib/price-condition-form";
import {
  MAX_QUANTITY,
  PRICE_CHECK_FIELDS,
  SOURCE_LABELS,
  toPriceRequest,
  validatePriceCheck,
  type PriceCheckErrors,
  type PriceCheckField,
  type PriceCheckValues,
} from "@/lib/price-check";
import { calculatePrice, type PriceResult } from "@/lib/pricing";
import { Field, FormErrorAlert, inputClass } from "../forms/form-controls";
import { SidePanel } from "../forms/side-panel";
import { PricingAnalysis } from "./pricing-analysis";

/**
 * Determines the price of a material for a B2B unit on an explicit date,
 * like the ERP API will for future orders. Nothing is stored.
 */
export function PriceCheckPanel({
  materials,
  units,
  onClose,
}: {
  /** null while loading */
  materials: Material[] | null;
  units: B2bUnit[] | null;
  onClose: () => void;
}) {
  const [values, setValues] = useState<PriceCheckValues>(() => ({
    materialNumber: "",
    unitId: "",
    pricingDate: todayIsoDate(),
    quantity: "1",
  }));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<PriceCheckErrors>({});
  const [generalError, setGeneralError] = useState<string[] | null>(null);
  const [result, setResult] = useState<PriceResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const checkingRef = useRef(false);

  const clientErrors = validatePriceCheck(values);

  function visibleError(field: PriceCheckField) {
    return serverErrors[field] ?? (submitAttempted ? clientErrors[field] : undefined);
  }

  function change(field: PriceCheckField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkingRef.current) return;

    setSubmitAttempted(true);
    setGeneralError(null);
    if (Object.keys(clientErrors).length > 0) return;

    checkingRef.current = true;
    setIsChecking(true);
    try {
      setResult(await calculatePrice(toPriceRequest(values)));
    } catch (error) {
      setResult(null);
      showApiError(error);
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  }

  function showApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setGeneralError([errorMessage(error)]);
      return;
    }
    if (error.status === 400 || error.status === 422) {
      const { fieldErrors, otherMessages } = splitValidationMessages(
        error.messages,
        PRICE_CHECK_FIELDS,
        { materialNumber: "Material", unitId: "B2B unit" },
      );
      setServerErrors(fieldErrors);
      setGeneralError(
        otherMessages.length > 0
          ? otherMessages
          : [
              error.status === 422
                ? "No price can be determined for this selection. See the marked fields."
                : GENERIC_VALIDATION_MESSAGE,
            ],
      );
      return;
    }
    setGeneralError(error.messages);
  }

  return (
    <SidePanel title="Price Check" isBusy={false} onClose={onClose} size="lg">
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
        <p className="text-xs text-ink-muted">
          Determines the price like a future order would: first a valid B2B
          unit price, then a valid price for the unit&apos;s Sold-to, then
          the material&apos;s base price. Nothing is stored.
        </p>

        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          {generalError && <FormErrorAlert messages={generalError} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="checkMaterial" label="Material" error={visibleError("materialNumber")}>
              <select
                id="checkMaterial"
                value={values.materialNumber}
                disabled={materials === null}
                autoFocus
                onChange={(e) => change("materialNumber", e.target.value)}
                className={`${inputClass(visibleError("materialNumber"))} bg-surface`}
              >
                <option value="">{materials === null ? "Loading materials…" : "Select a material"}</option>
                {materials?.map((m) => (
                  <option key={m.materialNumber} value={m.materialNumber}>
                    {m.materialNumber} – {m.description}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="checkUnit" label="B2B Unit" error={visibleError("unitId")}>
              <select
                id="checkUnit"
                value={values.unitId}
                disabled={units === null}
                onChange={(e) => change("unitId", e.target.value)}
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
            </Field>

            <Field id="checkDate" label="Pricing date" error={visibleError("pricingDate")}>
              <input
                id="checkDate"
                type="date"
                value={values.pricingDate}
                onChange={(e) => change("pricingDate", e.target.value)}
                className={inputClass(visibleError("pricingDate"))}
              />
            </Field>

            <Field
              id="checkQuantity"
              label="Quantity (pieces)"
              error={visibleError("quantity")}
              hint={`1 to ${MAX_QUANTITY.toLocaleString("en-US")}`}
            >
              <input
                id="checkQuantity"
                inputMode="numeric"
                autoComplete="off"
                value={values.quantity}
                onChange={(e) => change("quantity", e.target.value)}
                className={`${inputClass(visibleError("quantity"))} text-right tabular-nums`}
              />
            </Field>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isChecking}
              className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {isChecking ? "Checking…" : "Check Price"}
            </button>
          </div>
        </form>

        {result && <PriceResultView result={result} />}
      </div>
    </SidePanel>
  );
}

function PriceResultView({ result }: { result: PriceResult }) {
  return (
    <section aria-label="Price result" aria-live="polite" className="space-y-4">
      <div className="rounded-lg border border-brand/30 bg-brand-soft/40 p-4">
        <p className="text-xs text-ink-muted">
          <span className="font-mono">{result.materialNumber}</span> –{" "}
          {result.materialDescription} for{" "}
          <span className="font-mono">{result.unitId}</span> (Sold-to{" "}
          <span className="font-mono">{result.soldToCustomerNumber}</span>) on{" "}
          <span className="tabular-nums">{result.pricingDate}</span>
        </p>

        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-muted">Unit price</dt>
            <dd data-result="unitPrice" className="text-xl font-semibold tabular-nums">
              {formatAmount(result.unitPrice)} <span className="text-sm">{result.currency}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Quantity</dt>
            <dd className="text-xl font-semibold tabular-nums">{result.quantity}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Net value</dt>
            <dd data-result="netValue" className="text-xl font-semibold tabular-nums">
              {formatAmount(result.netValue)} <span className="text-sm">{result.currency}</span>
            </dd>
          </div>
        </dl>

        <p data-result="source" className="mt-3 text-sm">
          <span className="font-medium">{SOURCE_LABELS[result.source]}</span>
          {result.conditionId !== null ? (
            <>
              {" "}– price condition {result.conditionId}, valid {result.validFrom} –{" "}
              {result.validTo ?? "open-ended"}
            </>
          ) : (
            " – no valid price condition"
          )}
        </p>
      </div>

      <PricingAnalysis steps={result.steps} currency={result.currency} />
    </section>
  );
}

