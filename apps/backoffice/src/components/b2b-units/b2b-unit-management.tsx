"use client";

import { useState } from "react";
import { listB2bUnits, type B2bUnit } from "@/lib/b2b-units";
import {
  listCustomerAccounts,
  type CustomerAccount,
} from "@/lib/customer-accounts";
import { useListData } from "@/lib/use-list-data";
import {
  EmptyState,
  LoadError,
  LoadingRows,
  matchesStatus,
  PageHeader,
  RefreshButton,
  SearchInput,
  StatusFilter,
  statusCounts,
  SuccessNotice,
  type StatusFilterValue,
} from "../list-page";
import { AccountMembersPanel } from "./account-members-panel";
import { B2bUnitForm } from "./b2b-unit-form";
import { B2bUnitTable } from "./b2b-unit-table";

type Panel =
  | { kind: "create" }
  | { kind: "edit"; unit: B2bUnit }
  | { kind: "members" }
  | null;

export function B2bUnitManagement() {
  const units = useListData(listB2bUnits);
  // Accounts with their members are the partner choices of the unit form
  const accounts = useListData(listCustomerAccounts);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reloadAll() {
    units.reload();
    accounts.reload();
  }

  function open(next: Panel) {
    setNotice(null);
    setPanel(next);
  }

  function handleUnitSaved(unit: B2bUnit, mode: "create" | "edit") {
    setPanel(null);
    setNotice(
      mode === "create"
        ? `B2B unit ${unit.unitId} was created.`
        : `B2B unit ${unit.unitId} was updated.`,
    );
    units.reload();
  }

  function handleMembersSaved(account: CustomerAccount) {
    setPanel(null);
    setNotice(`Members of account ${account.accountCustomerNumber} were saved.`);
    reloadAll();
  }

  const all = units.items ?? [];
  const query = search.trim().toLowerCase();
  const visibleUnits = all.filter(
    (unit) =>
      matchesStatus(statusFilter, unit.isActive) &&
      [
        unit.unitId,
        unit.name,
        unit.account.customerNumber,
        unit.account.name,
        unit.soldTo.customerNumber,
        unit.soldTo.name,
      ].some((text) => text.toLowerCase().includes(query)),
  );
  const isFiltered = query !== "" || statusFilter !== "all";

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="B2B Units"
        description="Ordering contexts of customer accounts with their partner functions (Sold-to, Bill-to, Payer, Ship-to)."
        actionLabel="New B2B Unit"
        onAction={() => open({ kind: "create" })}
        secondaryAction={{
          label: "Manage Account Members",
          onClick: () => open({ kind: "members" }),
        }}
      />

      {notice && (
        <SuccessNotice message={notice} onDismiss={() => setNotice(null)} />
      )}

      {/* List card */}
      <section
        aria-label="B2B units"
        className="mt-6 rounded-lg border border-line bg-surface shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">
            B2B Units
            {units.items && (
              <span className="ml-2 font-normal text-ink-muted">
                ({isFiltered ? `${visibleUnits.length} of ` : ""}
                {units.items.length})
              </span>
            )}
          </h2>

          <StatusFilter
            value={statusFilter}
            onChange={setStatusFilter}
            counts={units.items ? statusCounts(units.items) : undefined}
          />

          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <SearchInput
              label="Search B2B units"
              placeholder="Search unit, account or Sold-to"
              value={search}
              onChange={setSearch}
            />
            <RefreshButton
              isLoading={units.isLoading || accounts.isLoading}
              onClick={reloadAll}
            />
          </div>
        </div>

        {units.loadError ? (
          <LoadError
            title="B2B units could not be loaded"
            message={units.loadError}
            isRetrying={units.isLoading}
            onRetry={reloadAll}
          />
        ) : units.items === null ? (
          <LoadingRows label="Loading B2B units" />
        ) : units.items.length === 0 ? (
          <EmptyState
            title="No B2B units yet"
            text={
              accounts.items?.length === 0
                ? "Create a customer account first with “Manage Account Members”, then create the first unit."
                : "Create the first B2B unit to get started."
            }
          />
        ) : visibleUnits.length === 0 ? (
          <EmptyState
            title="No matching B2B units"
            text="Change the search or the status filter."
          />
        ) : (
          <B2bUnitTable
            units={visibleUnits}
            onSelect={(unit) => open({ kind: "edit", unit })}
          />
        )}
      </section>

      {(panel?.kind === "create" || panel?.kind === "edit") && (
        <B2bUnitForm
          // A new key resets the form when another unit is opened
          key={panel.kind === "edit" ? panel.unit.unitId : "new"}
          unit={panel.kind === "edit" ? panel.unit : undefined}
          accounts={accounts.items}
          accountsError={accounts.loadError}
          onClose={() => setPanel(null)}
          onSaved={handleUnitSaved}
        />
      )}

      {panel?.kind === "members" && (
        <AccountMembersPanel
          accounts={accounts.items ?? []}
          onClose={() => setPanel(null)}
          onSaved={handleMembersSaved}
        />
      )}
    </div>
  );
}
