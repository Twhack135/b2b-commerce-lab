"use client";

import { useRef, useState } from "react";
import {
  accountPartners,
  B2B_UNIT_FIELDS,
  chooseDefaultShipTo,
  emptyUnitForm,
  inactivePartnerWarnings,
  MAX_SHIP_TOS,
  partnerOptions,
  prefillForAccount,
  salesAreaStatusLookup,
  toCreateInput,
  toggleShipTo,
  toUpdateInput,
  UNIT_ID_MAX_LENGTH,
  unitToForm,
  validateB2bUnitForm,
  type B2bUnitFieldErrors,
  type B2bUnitFormField,
  type B2bUnitFormValues,
  type PartnerOption,
} from "@/lib/b2b-unit-form";
import {
  createB2bUnit,
  updateB2bUnit,
  type B2bUnit,
  type PartnerSummary,
} from "@/lib/b2b-units";
import type { CustomerAccount } from "@/lib/customer-accounts";
import type { Customer } from "@/lib/customers";
import { ApiError, errorMessage } from "@/lib/erp-api";
import {
  findSalesArea,
  salesAreaId,
  salesAreaLabel,
} from "@/lib/sales-area-display";
import type { SalesArea } from "@/lib/sales-areas";
import {
  GENERIC_VALIDATION_MESSAGE,
  splitValidationMessages,
} from "@/lib/form-errors";
import { AlertIcon } from "../icons";
import {
  Field,
  FormActions,
  FormErrorAlert,
  inputClass,
} from "../forms/form-controls";
import { SidePanel } from "../forms/side-panel";

type PartnerField =
  | "soldToCustomerNumber"
  | "billToCustomerNumber"
  | "payerCustomerNumber";

/**
 * Side panel for creating a B2B unit (no `unit` given) or editing one.
 * Unit ID, sales area, account and Sold-to are fixed after creation.
 */
export function B2bUnitForm({
  unit,
  accounts,
  accountsError,
  salesAreas,
  salesAreasError,
  customers,
  onClose,
  onSaved,
}: {
  unit?: B2bUnit;
  /** null while loading */
  accounts: CustomerAccount[] | null;
  accountsError: string | null;
  /** null while loading */
  salesAreas: SalesArea[] | null;
  salesAreasError: string | null;
  /** Customers with their sales area assignments; null while loading */
  customers: Customer[] | null;
  onClose: () => void;
  onSaved: (unit: B2bUnit, mode: "create" | "edit") => void;
}) {
  const mode = unit ? "edit" : "create";
  const original = unit ? unitToForm(unit) : undefined;

  const [values, setValues] = useState<B2bUnitFormValues>(
    original ?? emptyUnitForm(),
  );
  // Fields the user has changed or left; errors show only for those
  const [touched, setTouched] = useState<Set<B2bUnitFormField>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Errors reported by the ERP API, shown until the field is changed
  const [serverErrors, setServerErrors] = useState<B2bUnitFieldErrors>({});
  const [generalError, setGeneralError] = useState<string[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A ref changes immediately, so a fast double click cannot submit twice
  const submittingRef = useRef(false);
  const [shipToSearch, setShipToSearch] = useState("");

  const account = accounts?.find(
    (a) => a.accountCustomerNumber === values.accountCustomerNumber,
  );
  // Partner choices are the account owner and its members. While editing,
  // the saved partners are always included, even if the account list is
  // not available.
  const partners = mergePartners(
    accountPartners(account),
    unit ? savedPartners(unit) : [],
  );

  // Assignments of the partners to the unit's sales area; partners that are
  // not active there cannot be chosen
  const statusOf = salesAreaStatusLookup(customers, values.salesArea);

  const clientErrors = validateB2bUnitForm(values, {
    mode,
    partners,
    original: unit,
    salesAreas,
    statusOf,
  });

  function visibleError(field: B2bUnitFormField) {
    if (serverErrors[field]) return serverErrors[field];
    if (submitAttempted || touched.has(field)) return clientErrors[field];
    return undefined;
  }

  function update(
    fields: B2bUnitFormField[],
    next: (current: B2bUnitFormValues) => B2bUnitFormValues,
  ) {
    setValues(next);
    setTouched((current) => new Set([...current, ...fields]));
    setServerErrors((current) => {
      const copy = { ...current };
      for (const field of fields) delete copy[field];
      return copy;
    });
  }

  function setText(field: "unitId" | "name", value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
  }

  function touch(field: B2bUnitFormField) {
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
      const saved = unit
        ? await updateB2bUnit(unit.unitId, toUpdateInput(values))
        : await createB2bUnit(toCreateInput(values));
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
    if (error.status === 409 && error.message.endsWith("already exists")) {
      setServerErrors({
        unitId: `B2B unit ${values.unitId} already exists. Use a different unit ID.`,
      });
      return;
    }
    if (error.status === 404) {
      setGeneralError([
        "This B2B unit no longer exists. Close the panel and refresh the list.",
      ]);
      return;
    }
    if (error.status === 400 || error.status === 422) {
      const { fieldErrors, otherMessages } = splitValidationMessages(
        error.messages,
        B2B_UNIT_FIELDS,
      );
      setServerErrors(fieldErrors);
      setGeneralError(
        otherMessages.length > 0
          ? otherMessages
          : [
              error.status === 422
                ? "The ERP API rejected the partner configuration. Please check the marked fields."
                : GENERIC_VALIDATION_MESSAGE,
            ],
      );
      return;
    }
    // e.g. 409 "was changed at the same time", 5xx, network
    setGeneralError(error.messages);
  }

  const warnings = unit ? inactivePartnerWarnings(unit, statusOf) : [];
  const shipToOptions = partnerOptions(
    partners,
    unit?.shipTos.map((s) => s.customerNumber),
    statusOf,
  );
  const query = shipToSearch.trim().toLowerCase();
  const visibleShipTos = shipToOptions.filter(
    (option) =>
      values.shipToCustomerNumbers.includes(option.customerNumber) ||
      `${option.customerNumber} ${option.name}`.toLowerCase().includes(query),
  );

  const title = mode === "create" ? "New B2B Unit" : `Edit ${unit?.unitId}`;

  return (
    <SidePanel title={title} isBusy={isSubmitting} onClose={onClose} size="lg">
      <form
        noValidate
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {generalError && <FormErrorAlert messages={generalError} />}

          {warnings.length > 0 && (
            <div
              role="status"
              className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-danger"
            >
              <p className="flex items-center gap-2 font-medium">
                <AlertIcon className="size-4" />
                Inactive partners are assigned to this unit
              </p>
              <ul className="mt-1 list-disc pl-6 text-sm">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                They stay assigned until you change them. Inactive customers
                cannot be assigned newly. A unit can only be reactivated when
                all its partners are active in its sales area.
              </p>
            </div>
          )}

          {/* General */}
          <section className="space-y-4">
            <SectionTitle>General</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
              <Field
                id="unitId"
                label="Unit ID"
                error={visibleError("unitId")}
                hint={
                  mode === "edit"
                    ? "Cannot be changed."
                    : `Unique, e.g. NW-HAMBURG. Max. ${UNIT_ID_MAX_LENGTH} characters.`
                }
              >
                <input
                  id="unitId"
                  value={values.unitId}
                  onChange={(e) => setText("unitId", e.target.value)}
                  onBlur={() => touch("unitId")}
                  readOnly={mode === "edit"}
                  autoFocus={mode === "create"}
                  autoComplete="off"
                  className={inputClass(visibleError("unitId"), mode === "edit")}
                />
              </Field>
              <Field id="name" label="Name" error={visibleError("name")}>
                <input
                  id="name"
                  value={values.name}
                  onChange={(e) => setText("name", e.target.value)}
                  onBlur={() => touch("name")}
                  autoFocus={mode === "edit"}
                  autoComplete="off"
                  className={inputClass(visibleError("name"))}
                />
              </Field>
            </div>
            <Field
              id="salesArea"
              label="Sales Area"
              error={visibleError("salesArea")}
              hint={
                mode === "edit"
                  ? "Cannot be changed. All partners must be active in this sales area."
                  : "Sales Organization / Distribution Channel / Division. Cannot be changed after creation. All partners must be assigned to it."
              }
            >
              {mode === "edit" && unit ? (
                <div className="rounded-md border border-line bg-canvas px-3 py-2 text-ink-muted">
                  <SalesAreaText salesAreas={salesAreas} unit={unit} />
                </div>
              ) : (
                <select
                  id="salesArea"
                  value={values.salesArea}
                  disabled={salesAreas === null}
                  onChange={(e) => {
                    const salesArea = e.target.value;
                    const lookup = salesAreaStatusLookup(customers, salesArea);
                    // Partners are chosen again for the new sales area
                    update(
                      [
                        "salesArea",
                        "soldToCustomerNumber",
                        "billToCustomerNumber",
                        "payerCustomerNumber",
                        "shipToCustomerNumbers",
                        "defaultShipToCustomerNumber",
                      ],
                      (v) => prefillForAccount({ ...v, salesArea }, account, lookup),
                    );
                  }}
                  className={`${inputClass(visibleError("salesArea"))} bg-surface`}
                >
                  <option value="">
                    {salesAreas === null
                      ? salesAreasError
                        ? "Sales areas could not be loaded"
                        : "Loading sales areas…"
                      : "Select a sales area"}
                  </option>
                  {salesAreas?.map((area) => (
                    <option
                      key={salesAreaId(area)}
                      value={salesAreaId(area)}
                      disabled={!area.isActive}
                    >
                      {salesAreaLabel(area)}
                      {area.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <ActiveSwitch
              checked={values.isActive}
              onChange={(isActive) => setValues((v) => ({ ...v, isActive }))}
            />
          </section>

          {/* Account and fixed Sold-to */}
          <section className="space-y-4">
            <SectionTitle>Customer Account</SectionTitle>
            <p className="text-xs text-ink-muted">
              A customer account is currently represented by its owner, an
              existing customer. Partners can be the owner or members of the
              account. Account and Sold-to cannot be changed after the unit is
              created.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="accountCustomerNumber"
                label="Account"
                error={visibleError("accountCustomerNumber")}
                hint={
                  mode === "create" && accounts?.length === 0
                    ? "No accounts yet. Create one with “Manage Account Members”."
                    : undefined
                }
              >
                {mode === "edit" && unit ? (
                  <ReadOnlyPartner partner={unit.account} />
                ) : (
                  <select
                    id="accountCustomerNumber"
                    value={values.accountCustomerNumber}
                    disabled={accounts === null}
                    onChange={(e) => {
                      const next = accounts?.find(
                        (a) => a.accountCustomerNumber === e.target.value,
                      );
                      update(
                        [
                          "accountCustomerNumber",
                          "soldToCustomerNumber",
                          "billToCustomerNumber",
                          "payerCustomerNumber",
                          "shipToCustomerNumbers",
                          "defaultShipToCustomerNumber",
                        ],
                        (v) => prefillForAccount(v, next, statusOf),
                      );
                    }}
                    className={`${inputClass(visibleError("accountCustomerNumber"))} bg-surface`}
                  >
                    <option value="">
                      {accounts === null
                        ? accountsError
                          ? "Accounts could not be loaded"
                          : "Loading accounts…"
                        : "Select an account"}
                    </option>
                    {accounts?.map((a) => (
                      <option
                        key={a.accountCustomerNumber}
                        value={a.accountCustomerNumber}
                        disabled={!a.isActive}
                      >
                        {a.accountCustomerNumber} – {a.name}
                        {a.isActive ? ` (${a.members.length} members)` : " (inactive)"}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <PartnerSelect
                field="soldToCustomerNumber"
                label="Sold-to (SP)"
                values={values}
                readOnlyPartner={mode === "edit" ? unit?.soldTo : undefined}
                options={partnerOptions(partners, original ? [original.soldToCustomerNumber] : [], statusOf)}
                error={visibleError("soldToCustomerNumber")}
                onChange={(n) => update(["soldToCustomerNumber"], (v) => ({ ...v, soldToCustomerNumber: n }))}
              />
            </div>
          </section>

          {/* Billing */}
          <section className="space-y-4">
            <SectionTitle>Billing</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <PartnerSelect
                field="billToCustomerNumber"
                label="Bill-to (BP)"
                values={values}
                options={partnerOptions(partners, original ? [original.billToCustomerNumber] : [], statusOf)}
                error={visibleError("billToCustomerNumber")}
                onChange={(n) => update(["billToCustomerNumber"], (v) => ({ ...v, billToCustomerNumber: n }))}
              />
              <PartnerSelect
                field="payerCustomerNumber"
                label="Payer (PY)"
                values={values}
                options={partnerOptions(partners, original ? [original.payerCustomerNumber] : [], statusOf)}
                error={visibleError("payerCustomerNumber")}
                onChange={(n) => update(["payerCustomerNumber"], (v) => ({ ...v, payerCustomerNumber: n }))}
              />
            </div>
          </section>

          {/* Ship-tos */}
          <section className="space-y-3" aria-labelledby="ship-to-title">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <SectionTitle id="ship-to-title">Ship-to Partners (SH)</SectionTitle>
                <p className="mt-1 text-xs text-ink-muted">
                  Select the allowed Ship-tos and exactly one default.{" "}
                  {values.shipToCustomerNumbers.length} of {MAX_SHIP_TOS} selected.
                </p>
              </div>
              {shipToOptions.length > 6 && (
                <input
                  type="search"
                  value={shipToSearch}
                  onChange={(e) => setShipToSearch(e.target.value)}
                  placeholder="Filter partners"
                  aria-label="Filter Ship-to partners"
                  className="w-48 rounded-md border border-line px-3 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              )}
            </div>

            {(visibleError("shipToCustomerNumbers") ||
              visibleError("defaultShipToCustomerNumber")) && (
              <div role="alert" className="space-y-1 text-xs text-danger">
                {visibleError("shipToCustomerNumbers") && (
                  <p id="shipToCustomerNumbers-error">{visibleError("shipToCustomerNumbers")}</p>
                )}
                {visibleError("defaultShipToCustomerNumber") && (
                  <p id="defaultShipToCustomerNumber-error">
                    {visibleError("defaultShipToCustomerNumber")}
                  </p>
                )}
              </div>
            )}

            {shipToOptions.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-ink-muted">
                Select an account to see its partners.
              </p>
            ) : (
              <ShipToList
                options={visibleShipTos}
                values={values}
                onToggle={(n) =>
                  update(
                    ["shipToCustomerNumbers", "defaultShipToCustomerNumber"],
                    (v) => toggleShipTo(v, n),
                  )
                }
                onChooseDefault={(n) =>
                  update(
                    ["shipToCustomerNumbers", "defaultShipToCustomerNumber"],
                    (v) => chooseDefaultShipTo(v, n),
                  )
                }
              />
            )}
          </section>
        </div>

        <FormActions
          isSubmitting={isSubmitting}
          submitLabel={mode === "create" ? "Create B2B Unit" : "Save Changes"}
          onCancel={onClose}
        />
      </form>
    </SidePanel>
  );
}

function SectionTitle({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
      {children}
    </h3>
  );
}

function ActiveSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-line px-4 py-3">
      <div>
        <label htmlFor="isActive" className="font-medium">
          Active
        </label>
        <p className="mt-0.5 text-xs text-ink-muted">
          Inactive units stay in the system but are not offered for ordering.
        </p>
      </div>
      <input
        id="isActive"
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-brand"
      />
    </div>
  );
}

function ReadOnlyPartner({ partner }: { partner: PartnerSummary }) {
  return (
    <div className="rounded-md border border-line bg-canvas px-3 py-2 text-ink-muted">
      <span className="font-mono">{partner.customerNumber}</span> – {partner.name}
      {!partner.isActive && <span className="ml-1 font-medium text-danger">(inactive)</span>}
    </div>
  );
}

/** Why a partner cannot be chosen in the unit's sales area, if it cannot */
function salesAreaNote(option: PartnerOption) {
  if (option.salesAreaStatus === "missing") return "not assigned to the sales area";
  if (option.salesAreaStatus === "inactive") return "inactive in the sales area";
  return undefined;
}

function optionLabel(option: PartnerOption) {
  const areaNote = salesAreaNote(option);
  const suffix = !option.isActive
    ? option.isAssigned
      ? " (inactive – currently assigned)"
      : " (inactive)"
    : areaNote
      ? option.isAssigned
        ? ` (${areaNote} – currently assigned)`
        : ` (${areaNote})`
      : "";
  return `${option.customerNumber} – ${option.name}${suffix}`;
}

/** The unit's sales area with its name and currency, once loaded */
function SalesAreaText({
  salesAreas,
  unit,
}: {
  salesAreas: SalesArea[] | null;
  unit: B2bUnit;
}) {
  const area = findSalesArea(salesAreas, unit.salesArea);
  return <span className="font-mono">{area ? salesAreaLabel(area) : salesAreaId(unit.salesArea)}</span>;
}

function PartnerSelect({
  field,
  label,
  values,
  options,
  error,
  readOnlyPartner,
  onChange,
}: {
  field: PartnerField;
  label: string;
  values: B2bUnitFormValues;
  options: PartnerOption[];
  error?: string;
  readOnlyPartner?: PartnerSummary;
  onChange: (customerNumber: string) => void;
}) {
  return (
    <Field id={field} label={label} error={error}>
      {readOnlyPartner ? (
        <ReadOnlyPartner partner={readOnlyPartner} />
      ) : (
        <select
          id={field}
          value={values[field]}
          disabled={options.length === 0}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass(error)} bg-surface`}
        >
          <option value="">{options.length === 0 ? "Select an account first" : "Select a customer"}</option>
          {options.map((option) => (
            <option
              key={option.customerNumber}
              value={option.customerNumber}
              disabled={!option.isSelectable}
            >
              {optionLabel(option)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function ShipToList({
  options,
  values,
  onToggle,
  onChooseDefault,
}: {
  options: PartnerOption[];
  values: B2bUnitFormValues;
  onToggle: (customerNumber: string) => void;
  onChooseDefault: (customerNumber: string) => void;
}) {
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {options.map((option) => {
        const n = option.customerNumber;
        const isAllowed = values.shipToCustomerNumbers.includes(n);
        const isDefault = values.defaultShipToCustomerNumber === n;
        // The default stays allowed until another default is chosen
        const toggleLocked = isAllowed ? isDefault : !option.isSelectable;
        // Inactive customers and customers that are not active in the sales
        // area cannot become the new default (choosing it would add them)
        const defaultLocked =
          !isDefault &&
          (!option.isActive || salesAreaNote(option) !== undefined);
        const areaNote = salesAreaNote(option);
        const note = isDefault && isAllowed
          ? "Default – choose another default to remove it"
          : !option.isSelectable
            ? option.isActive && areaNote
              ? `Cannot be added: ${areaNote} (see Customers)`
              : "Inactive – cannot be added"
            : !option.isActive
              ? "Inactive – currently assigned"
              : areaNote
                ? `Currently assigned, but ${areaNote}`
                : undefined;
        const isWarning = !option.isActive || areaNote !== undefined;

        return (
          <li
            key={n}
            data-ship-to={n}
            className={`flex items-center gap-3 px-3 py-2.5 ${isAllowed ? "bg-brand-soft/30" : ""}`}
          >
            <input
              type="checkbox"
              id={`shipTo-${n}`}
              aria-label={`Allow ${n} as Ship-to`}
              checked={isAllowed}
              disabled={toggleLocked}
              onChange={() => onToggle(n)}
              className="size-4 shrink-0 accent-brand"
            />
            <label htmlFor={`shipTo-${n}`} className="min-w-0 flex-1">
              <span className="font-mono text-sm">{n}</span>
              <span className="ml-2 text-sm">{option.name}</span>
              {note && (
                <span
                  className={`block text-xs ${isWarning ? "text-danger" : "text-ink-muted"}`}
                >
                  {note}
                </span>
              )}
            </label>
            <label
              className={`flex shrink-0 items-center gap-1.5 text-xs ${defaultLocked ? "text-ink-muted/60" : "text-ink-muted"}`}
            >
              <input
                type="radio"
                name="defaultShipTo"
                aria-label={`Make ${n} the default Ship-to`}
                checked={isDefault}
                disabled={defaultLocked}
                onChange={() => onChooseDefault(n)}
                className="size-4 accent-brand"
              />
              Default
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function savedPartners(unit: B2bUnit): PartnerSummary[] {
  return [unit.account, unit.soldTo, unit.billTo, unit.payer, ...unit.shipTos];
}

/** Unique partners by customer number; the first occurrence wins */
function mergePartners(...lists: PartnerSummary[][]): PartnerSummary[] {
  const seen = new Map<string, PartnerSummary>();
  for (const partner of lists.flat()) {
    if (!seen.has(partner.customerNumber)) {
      seen.set(partner.customerNumber, {
        customerNumber: partner.customerNumber,
        name: partner.name,
        isActive: partner.isActive,
      });
    }
  }
  return [...seen.values()];
}
