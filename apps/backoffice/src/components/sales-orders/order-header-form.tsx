"use client";

import type { B2bUnit, PartnerSummary } from "@/lib/b2b-units";
import {
  CUSTOMER_NOTE_MAX_LENGTH,
  CUSTOMER_REFERENCE_MAX_LENGTH,
  inactiveDefaultShipTo,
  shipToOptions,
  unitPartners,
  type HeaderField,
  type OrderSimulationValues,
} from "@/lib/order-simulation-form";
import type { RequestedShippingMethod, SimulationMessage } from "@/lib/sales-orders";
import type { PartnerRole } from "@/lib/simulation-display";
import { Field, inputClass } from "../forms/form-controls";

const SHIPPING_METHODS: { value: RequestedShippingMethod; label: string; hint: string }[] = [
  { value: "STANDARD", label: "Standard", hint: "Regular delivery" },
  { value: "EXPRESS", label: "Express", hint: "Faster delivery requested" },
];

/** Order header: B2B unit, derived partners, Ship-to and header data */
export function OrderHeaderForm({
  values,
  units,
  unitsError,
  errors,
  partnerMessages,
  fieldMessages,
  orderDate,
  onSelectUnit,
  onChange,
}: {
  values: OrderSimulationValues;
  /** Today; null until known in the browser. Prices are always determined
      for the order date (pricing date = order date, an internal rule). */
  orderDate: string | null;
  /** null while loading */
  units: B2bUnit[] | null;
  unitsError: string | null;
  /** Visible input errors */
  errors: Partial<Record<HeaderField, string>>;
  /** Messages of a current simulation by partner role */
  partnerMessages: Partial<Record<PartnerRole, SimulationMessage[]>>;
  /** Info and warnings of a current simulation by field */
  fieldMessages: Partial<Record<string, SimulationMessage[]>>;
  onSelectUnit: (unitId: string) => void;
  onChange: (changes: Partial<OrderSimulationValues>) => void;
}) {
  const unit = units?.find((u) => u.unitId === values.unitId);
  const partners = unitPartners(unit);
  const shipTos = shipToOptions(unit);
  const inactiveDefault = inactiveDefaultShipTo(unit);
  const shippingInfo = fieldMessages.requestedShippingMethod?.[0];

  return (
    <section
      aria-labelledby="header-title"
      className="rounded-lg border border-line bg-surface shadow-sm"
    >
      <h2 id="header-title" className="border-b border-line px-4 py-3 font-semibold">
        Order Header
      </h2>

      <div className="space-y-5 px-4 py-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="unitId" label="B2B Unit" error={errors.unitId}>
            <select
              id="unitId"
              value={values.unitId}
              disabled={units === null}
              aria-invalid={errors.unitId ? true : undefined}
              onChange={(e) => onSelectUnit(e.target.value)}
              className={`${inputClass(errors.unitId)} bg-surface`}
            >
              <option value="">
                {units === null
                  ? unitsError
                    ? "B2B units could not be loaded"
                    : "Loading B2B units…"
                  : "Select a B2B unit"}
              </option>
              {units?.map((u) => (
                <option key={u.unitId} value={u.unitId} disabled={!u.isActive}>
                  {u.unitId} – {u.name}
                  {u.isActive ? "" : " (inactive – cannot be selected)"}
                </option>
              ))}
            </select>
          </Field>

          <Field
            id="shipToCustomerNumber"
            label="Ship-to (SH)"
            error={errors.shipToCustomerNumber}
            hint={
              inactiveDefault && values.shipToCustomerNumber === ""
                ? `The default Ship-to ${inactiveDefault.customerNumber} is inactive. Select another allowed Ship-to.`
                : unit
                  ? "Only the Ship-tos allowed for this unit."
                  : undefined
            }
          >
            <select
              id="shipToCustomerNumber"
              value={values.shipToCustomerNumber}
              disabled={!unit}
              aria-invalid={errors.shipToCustomerNumber ? true : undefined}
              onChange={(e) => onChange({ shipToCustomerNumber: e.target.value })}
              className={`${inputClass(errors.shipToCustomerNumber)} bg-surface`}
            >
              <option value="">{unit ? "Select a Ship-to" : "Select a B2B unit first"}</option>
              {shipTos.map((s) => (
                <option key={s.customerNumber} value={s.customerNumber} disabled={!s.isSelectable}>
                  {s.customerNumber} – {s.name}
                  {s.isDefault ? " (default)" : ""}
                  {s.isActive ? "" : " (inactive – cannot be selected)"}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Partners always come from the unit and cannot be changed here */}
        <div>
          <p className="mb-1.5 font-medium">Partners from the B2B unit</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <PartnerCard role="Sold-to (SP)" partner={partners?.soldTo} messages={partnerMessages.soldTo} />
            <PartnerCard role="Bill-to (BP)" partner={partners?.billTo} messages={partnerMessages.billTo} />
            <PartnerCard role="Payer (PY)" partner={partners?.payer} messages={partnerMessages.payer} />
          </div>
          {partnerMessages.account && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {partnerMessages.account.map((m) => m.text).join(" ")}
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* The order date is shown only; it cannot be changed */}
          <div>
            <p className="mb-1.5 font-medium">Order date</p>
            <p
              data-order-date
              className="rounded-md border border-line bg-canvas px-3 py-2 font-mono text-ink-muted tabular-nums"
            >
              {orderDate ?? "—"}
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">Today. It cannot be changed.</p>
          </div>

          <Field
            id="requestedDeliveryDate"
            label="Requested delivery date (optional)"
            error={errors.requestedDeliveryDate}
            hint="A request only, not a confirmed delivery date. The delivery date is confirmed during order processing."
          >
            <input
              id="requestedDeliveryDate"
              type="date"
              value={values.requestedDeliveryDate}
              min={orderDate ?? undefined}
              aria-invalid={errors.requestedDeliveryDate ? true : undefined}
              onChange={(e) => onChange({ requestedDeliveryDate: e.target.value })}
              className={inputClass(errors.requestedDeliveryDate)}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">

          <fieldset>
            <legend className="mb-1.5 font-medium">Requested shipping method</legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-2">
              {SHIPPING_METHODS.map((method) => (
                <label
                  key={method.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${
                    values.requestedShippingMethod === method.value
                      ? "border-brand bg-brand-soft/40"
                      : "border-line hover:bg-canvas"
                  }`}
                >
                  <input
                    type="radio"
                    name="requestedShippingMethod"
                    value={method.value}
                    checked={values.requestedShippingMethod === method.value}
                    onChange={() => onChange({ requestedShippingMethod: method.value })}
                    className="mt-1 accent-brand"
                  />
                  <span>
                    <span className="block font-medium">{method.label}</span>
                    <span className="block text-xs text-ink-muted">{method.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              {shippingInfo
                ? shippingInfo.text
                : "A request only: no delivery date or freight is determined."}
            </p>
          </fieldset>
        </div>

        <Field
          id="customerReference"
          label="Customer reference (optional)"
          error={errors.customerReference}
          hint="The customer's purchase order number."
        >
          <div className="relative">
            <input
              id="customerReference"
              autoComplete="off"
              placeholder="e.g. PO-2026-00123"
              value={values.customerReference}
              aria-invalid={errors.customerReference ? true : undefined}
              aria-describedby="customerReference-count"
              onChange={(e) => onChange({ customerReference: e.target.value })}
              className={`${inputClass(errors.customerReference)} pr-16 placeholder:text-ink-muted/60`}
            />
            <Counter
              id="customerReference-count"
              length={values.customerReference.length}
              max={CUSTOMER_REFERENCE_MAX_LENGTH}
              className="absolute top-1/2 right-3 -translate-y-1/2"
            />
          </div>
        </Field>

        <Field
          id="customerNote"
          label="Customer note (optional)"
          error={errors.customerNote}
          hint="A note means Sales must review the order before delivery."
        >
          <textarea
            id="customerNote"
            rows={3}
            placeholder="e.g. Please deliver to Gate 3. Contact our warehouse before arrival."
            value={values.customerNote}
            aria-invalid={errors.customerNote ? true : undefined}
            aria-describedby="customerNote-count"
            onChange={(e) => onChange({ customerNote: e.target.value })}
            className={`${inputClass(errors.customerNote)} resize-y placeholder:text-ink-muted/60`}
          />
          <div className="mt-1 flex justify-end">
            <Counter id="customerNote-count" length={values.customerNote.length} max={CUSTOMER_NOTE_MAX_LENGTH} />
          </div>
        </Field>
      </div>
    </section>
  );
}

function Counter({
  id,
  length,
  max,
  className = "",
}: {
  id: string;
  length: number;
  max: number;
  className?: string;
}) {
  return (
    <span
      id={id}
      className={`text-xs tabular-nums ${length > max ? "font-medium text-danger" : "text-ink-muted"} ${className}`}
    >
      {length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
      <span className="sr-only"> characters</span>
    </span>
  );
}

function PartnerCard({
  role,
  partner,
  messages,
}: {
  role: string;
  partner?: PartnerSummary;
  messages?: SimulationMessage[];
}) {
  const hasError = !!messages?.length || (partner && !partner.isActive);
  return (
    <div
      data-partner={role}
      className={`rounded-md border px-3 py-2 ${hasError ? "border-danger/40 bg-danger-soft" : "border-line bg-canvas"}`}
    >
      <p className="text-xs text-ink-muted">{role}</p>
      {partner ? (
        <>
          <p className="font-mono text-sm">{partner.customerNumber}</p>
          <p className="text-xs">
            {partner.name}
            {!partner.isActive && <span className="ml-1 font-medium text-danger">(inactive)</span>}
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-muted">—</p>
      )}
      {messages?.map((m) => (
        <p key={m.code} role="alert" className="mt-1 text-xs text-danger">
          {m.text}
        </p>
      ))}
    </div>
  );
}
