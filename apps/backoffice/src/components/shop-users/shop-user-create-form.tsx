"use client";

import { useRef, useState } from "react";
import type { B2bUnit } from "@/lib/b2b-units";
import type { CustomerAccount } from "@/lib/customer-accounts";
import { ApiError, errorMessage } from "@/lib/erp-api";
import { accountChoices, assignableUnits, inactiveUnits } from "@/lib/shop-user-display";
import { createShopUser, type ShopUserDetail } from "@/lib/shop-users";
import { Field, FormActions, FormErrorAlert, inputClass } from "../forms/form-controls";
import { SidePanel } from "../forms/side-panel";

type Errors = { account?: string; email?: string; displayName?: string };

/** Printable characters, one @ and a dot in the domain, like the ERP rule */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(account: string, email: string, displayName: string): Errors {
  const errors: Errors = {};
  if (!account) errors.account = "Select the customer account.";
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = "Enter a valid e-mail address.";
  if (!displayName.trim()) errors.displayName = "Enter the name of the person.";
  else if (displayName.trim().length > 100) errors.displayName = "Use at most 100 characters.";
  return errors;
}

/**
 * Creates a shop user of a customer account with some of its units. There
 * is no password field: the person sets it with a one-time activation link.
 */
export function ShopUserCreateForm({
  accounts,
  units,
  onClose,
  onCreated,
}: {
  accounts: CustomerAccount[] | null;
  units: B2bUnit[] | null;
  onClose: () => void;
  onCreated: (user: ShopUserDetail) => void;
}) {
  const [account, setAccount] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[] | null>(null);
  const [emailTaken, setEmailTaken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const errors = validate(account, email, displayName);
  const shown: Errors = submitAttempted ? errors : {};
  const emailError = shown.email ?? (emailTaken === email.trim().toLowerCase() ? "A shop user with this e-mail address already exists." : undefined);
  const choices = accountChoices(accounts ?? []);
  const assignable = account ? assignableUnits(units ?? [], account) : [];
  const inactive = account ? inactiveUnits(units ?? [], account) : [];

  function chooseAccount(value: string) {
    setAccount(value);
    // Units of another account are never sent
    setUnitIds([]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setSubmitAttempted(true);
    setServerErrors(null);
    if (Object.keys(errors).length > 0) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      onCreated(await createShopUser({ accountCustomerNumber: account, email: email.trim(), displayName: displayName.trim(), unitIds }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setEmailTaken(email.trim().toLowerCase());
      } else {
        setServerErrors(error instanceof ApiError ? error.messages : [errorMessage(error)]);
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <SidePanel title="New Shop User" isBusy={isSubmitting} onClose={onClose}>
      <form noValidate onSubmit={handleSubmit} data-shop-user-create className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <p className="text-ink-muted">
            A shop user is a person of a customer account who orders in the customer shop. There is no password here:
            after saving, create an activation link with which the person sets their own password.
          </p>
          {serverErrors && <FormErrorAlert messages={serverErrors} />}

          <Field id="shop-user-account" label="Customer account" error={shown.account}>
            <select
              id="shop-user-account"
              value={account}
              onChange={(event) => chooseAccount(event.target.value)}
              aria-invalid={shown.account ? true : undefined}
              className={inputClass(shown.account)}
            >
              <option value="">{accounts === null ? "Loading accounts…" : "Select an account"}</option>
              {choices.map((choice) => (
                <option key={choice.accountCustomerNumber} value={choice.accountCustomerNumber} disabled={!choice.isActive}>
                  {choice.accountCustomerNumber} · {choice.name}
                  {choice.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </Field>

          <Field id="shop-user-email" label="E-mail address" error={emailError} hint="The sign-in name. It cannot be changed later.">
            <input
              id="shop-user-email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={emailError ? true : undefined}
              className={inputClass(emailError)}
            />
          </Field>

          <Field id="shop-user-name" label="Display name" error={shown.displayName}>
            <input
              id="shop-user-name"
              type="text"
              autoComplete="off"
              maxLength={100}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={shown.displayName ? true : undefined}
              className={inputClass(shown.displayName)}
            />
          </Field>

          <fieldset>
            <legend className="mb-1.5 font-medium">B2B units</legend>
            {!account ? (
              <p className="text-xs text-ink-muted">Select the account first: only its own units can be assigned.</p>
            ) : assignable.length === 0 && inactive.length === 0 ? (
              <p className="text-xs text-ink-muted">This account has no B2B units yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {assignable.map((unit) => (
                  <li key={unit.unitId}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-canvas">
                      <input
                        type="checkbox"
                        data-unit-option={unit.unitId}
                        checked={unitIds.includes(unit.unitId)}
                        onChange={() =>
                          setUnitIds((current) =>
                            current.includes(unit.unitId) ? current.filter((id) => id !== unit.unitId) : [...current, unit.unitId],
                          )
                        }
                        className="size-4 accent-brand"
                      />
                      <span className="flex-1">
                        <span className="block font-medium">{unit.name}</span>
                        <span className="block font-mono text-xs text-ink-muted">{unit.unitId}</span>
                      </span>
                    </label>
                  </li>
                ))}
                {inactive.map((unit) => (
                  <li key={unit.unitId} className="flex items-center gap-3 px-3 py-2.5 text-ink-muted">
                    <input type="checkbox" disabled aria-label={`${unit.unitId} is inactive`} className="size-4" />
                    <span className="flex-1">
                      <span className="block">{unit.name}</span>
                      <span className="block font-mono text-xs">{unit.unitId} · inactive, cannot be assigned</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-xs text-ink-muted">Units can also be assigned or removed later.</p>
          </fieldset>
        </div>
        <FormActions isSubmitting={isSubmitting} submitLabel="Create Shop User" onCancel={onClose} />
      </form>
    </SidePanel>
  );
}
