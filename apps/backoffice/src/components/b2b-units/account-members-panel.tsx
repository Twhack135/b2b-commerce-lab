"use client";

import { useRef, useState } from "react";
import {
  candidateNote,
  memberCandidates,
  memberErrors,
  ownerOptions,
  validateMemberSelection,
  type MemberCandidate,
} from "@/lib/account-membership";
import {
  getCustomerAccount,
  replaceAccountMembers,
  type CustomerAccount,
} from "@/lib/customer-accounts";
import { listCustomers } from "@/lib/customers";
import { ApiError, errorMessage } from "@/lib/erp-api";
import { useListData } from "@/lib/use-list-data";
import {
  Field,
  FormActions,
  FormErrorAlert,
  inputClass,
} from "../forms/form-controls";
import { SidePanel } from "../forms/side-panel";

/**
 * Panel to view and manage the members of a customer account. An account is
 * represented by its owner customer; saving replaces the complete member list
 * (and creates the account if the owner has none yet).
 */
export function AccountMembersPanel({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: CustomerAccount[];
  onClose: () => void;
  onSaved: (account: CustomerAccount) => void;
}) {
  const customers = useListData(listCustomers);

  const [owner, setOwner] = useState("");
  // The selected account as currently stored, loaded when it is chosen
  const [loadedAccount, setLoadedAccount] = useState<CustomerAccount | null>(null);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [generalError, setGeneralError] = useState<string[] | null>(null);
  const [perCustomerErrors, setPerCustomerErrors] = useState<Map<string, string>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // Ignores a slow response for an account that is no longer selected
  const requestedOwner = useRef("");

  const allCustomers = customers.items ?? [];
  const owners = ownerOptions(allCustomers, accounts);
  const hasAccount = accounts.some((a) => a.accountCustomerNumber === owner);

  // Use the freshly loaded account instead of the list version, if present
  const currentAccounts = loadedAccount
    ? accounts
        .filter((a) => a.accountCustomerNumber !== loadedAccount.accountCustomerNumber)
        .concat(loadedAccount)
    : accounts;
  const candidates = owner ? memberCandidates(allCustomers, currentAccounts, owner) : [];

  const selectionError = owner ? validateMemberSelection(selected, candidates) : undefined;
  const ownerError = submitAttempted && !owner ? "Select an account owner." : undefined;

  async function chooseOwner(customerNumber: string) {
    requestedOwner.current = customerNumber;
    setOwner(customerNumber);
    setLoadedAccount(null);
    setSelected([]);
    setGeneralError(null);
    setPerCustomerErrors(new Map());
    if (!accounts.some((a) => a.accountCustomerNumber === customerNumber)) return;

    setIsLoadingAccount(true);
    try {
      const account = await getCustomerAccount(customerNumber);
      if (requestedOwner.current !== customerNumber) return;
      setLoadedAccount(account);
      setSelected(account.members.map((m) => m.customerNumber));
    } catch (error) {
      if (requestedOwner.current !== customerNumber) return;
      setGeneralError([`The account could not be loaded. ${errorMessage(error)}`]);
    } finally {
      if (requestedOwner.current === customerNumber) setIsLoadingAccount(false);
    }
  }

  function toggle(customerNumber: string) {
    setSelected((current) =>
      current.includes(customerNumber)
        ? current.filter((n) => n !== customerNumber)
        : [...current, customerNumber],
    );
    setPerCustomerErrors((current) => {
      const copy = new Map(current);
      copy.delete(customerNumber);
      return copy;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setSubmitAttempted(true);
    setGeneralError(null);
    if (!owner || selectionError || isLoadingAccount) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      onSaved(await replaceAccountMembers(owner, selected));
    } catch (error) {
      // Keep the selection so nothing is lost after an error
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
    if (error.status === 404) {
      setGeneralError(["This customer no longer exists. Close the panel and refresh the list."]);
      return;
    }
    const byCustomer = memberErrors(error.messages);
    setPerCustomerErrors(byCustomer);
    const other = error.messages
      .filter((m) => !/^memberCustomerNumbers \S+ (is|does|owns) /.test(m))
      .map((m) => (m.endsWith(".") ? m : `${m}.`));
    setGeneralError(
      other.length > 0
        ? other
        : ["Some members could not be saved. See the marked customers below."],
    );
  }

  const query = search.trim().toLowerCase();
  const visibleCandidates = candidates.filter(
    (c) =>
      selected.includes(c.customerNumber) ||
      `${c.customerNumber} ${c.name}`.toLowerCase().includes(query),
  );

  return (
    <SidePanel title="Account Members" isBusy={isSubmitting} onClose={onClose} size="lg">
      <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          <div className="rounded-md border border-brand/20 bg-brand-soft/60 px-4 py-3 text-sm">
            <p className="font-medium">How customer accounts work</p>
            <p className="mt-1 text-ink-muted">
              A customer account is currently represented by its <strong>owner</strong>,
              an existing Customer Master record. <strong>Members</strong> are other
              customers of the account, e.g. plants, warehouses or billing
              offices. Only the owner and members can be partners in the
              account&apos;s B2B units. A customer can belong to only one account.
            </p>
          </div>

          {generalError && <FormErrorAlert messages={generalError} />}

          <Field
            id="accountOwner"
            label="Account owner"
            error={ownerError}
            hint={
              owner && !hasAccount
                ? "This customer has no account yet. Saving creates a new account."
                : "Choose an existing account or a customer to create a new account."
            }
          >
            <select
              id="accountOwner"
              value={owner}
              disabled={customers.items === null || isSubmitting}
              onChange={(e) => void chooseOwner(e.target.value)}
              className={`${inputClass(ownerError)} bg-surface`}
            >
              <option value="">
                {customers.loadError
                  ? "Customers could not be loaded"
                  : customers.items === null
                    ? "Loading customers…"
                    : "Select an account owner"}
              </option>
              <optgroup label="Existing accounts">
                {owners
                  .filter((o) => o.hasAccount)
                  .map((o) => (
                    <option key={o.customerNumber} value={o.customerNumber}>
                      {o.customerNumber} – {o.name}
                      {o.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Create a new account for">
                {owners
                  .filter((o) => !o.hasAccount)
                  .map((o) => (
                    <option key={o.customerNumber} value={o.customerNumber}>
                      {o.customerNumber} – {o.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </Field>

          {owner && (
            <section className="space-y-3" aria-labelledby="members-title">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3
                    id="members-title"
                    className="text-xs font-semibold tracking-wide text-ink-muted uppercase"
                  >
                    Members
                  </h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    {selected.length} selected. Customers of other accounts are shown
                    but cannot be added.
                  </p>
                </div>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter customers"
                  aria-label="Filter customers"
                  className="w-48 rounded-md border border-line px-3 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>

              {selectionError && submitAttempted && (
                <p role="alert" className="text-xs text-danger">
                  {selectionError}
                </p>
              )}

              {isLoadingAccount ? (
                <p className="px-1 py-4 text-ink-muted">Loading members…</p>
              ) : candidates.length === 0 ? (
                <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-ink-muted">
                  There are no other customers yet.
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {visibleCandidates.map((candidate) => (
                    <CandidateRow
                      key={candidate.customerNumber}
                      candidate={candidate}
                      checked={selected.includes(candidate.customerNumber)}
                      error={perCustomerErrors.get(candidate.customerNumber)}
                      onToggle={() => toggle(candidate.customerNumber)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <FormActions isSubmitting={isSubmitting} submitLabel="Save Members" onCancel={onClose} />
      </form>
    </SidePanel>
  );
}

function CandidateRow({
  candidate,
  checked,
  error,
  onToggle,
}: {
  candidate: MemberCandidate;
  checked: boolean;
  error?: string;
  onToggle: () => void;
}) {
  const id = `member-${candidate.customerNumber}`;
  const note = candidateNote(candidate);
  const isLocked = !candidate.isSelectable && !checked;
  return (
    <li
      data-member={candidate.customerNumber}
      className={`flex items-start gap-3 px-3 py-2.5 ${checked ? "bg-brand-soft/30" : ""} ${isLocked ? "opacity-70" : ""}`}
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={isLocked}
        onChange={onToggle}
        className="mt-1 size-4 shrink-0 accent-brand"
      />
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="font-mono text-sm">{candidate.customerNumber}</span>
        <span className="ml-2 text-sm">{candidate.name}</span>
        {note && (
          <span
            className={`block text-xs ${candidate.isActive ? "text-ink-muted" : "text-danger"}`}
          >
            {note}
          </span>
        )}
        {error && (
          <span role="alert" className="block text-xs font-medium text-danger">
            {error}
          </span>
        )}
      </label>
    </li>
  );
}
