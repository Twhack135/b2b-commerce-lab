"use client";

import { useState } from "react";
import { listCustomers, type Customer } from "@/lib/customers";
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
import { CustomerForm } from "./customer-form";
import { CustomerTable } from "./customer-table";

type Panel = { mode: "create" } | { mode: "edit"; customer: Customer } | null;

export function CustomerManagement() {
  const {
    items: customers,
    isLoading,
    loadError,
    reload,
  } = useListData(listCustomers);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function handleSaved(customer: Customer, mode: "create" | "edit") {
    setPanel(null);
    setNotice(
      mode === "create"
        ? `Customer ${customer.customerNumber} was created.`
        : `Customer ${customer.customerNumber} was updated.`,
    );
    reload();
  }

  const all = customers ?? [];

  const query = search.trim().toLowerCase();
  const visibleCustomers = all.filter(
    (customer) =>
      matchesStatus(statusFilter, customer.isActive) &&
      [
        customer.customerNumber,
        customer.name,
        customer.city,
        customer.postalCode,
      ].some((text) => text.toLowerCase().includes(query)),
  );
  const isFiltered = query !== "" || statusFilter !== "all";

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Customer Management"
        description="Create and maintain customers of the ERP customer master."
        actionLabel="New Customer"
        onAction={() => {
          setNotice(null);
          setPanel({ mode: "create" });
        }}
      />

      {notice && (
        <SuccessNotice message={notice} onDismiss={() => setNotice(null)} />
      )}

      {/* List card */}
      <section
        aria-label="Customers"
        className="mt-6 rounded-lg border border-line bg-surface shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">
            Customers
            {customers && (
              <span className="ml-2 font-normal text-ink-muted">
                ({isFiltered ? `${visibleCustomers.length} of ` : ""}
                {customers.length})
              </span>
            )}
          </h2>

          <StatusFilter
            value={statusFilter}
            onChange={setStatusFilter}
            counts={customers ? statusCounts(customers) : undefined}
          />

          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <SearchInput
              label="Search customers"
              placeholder="Search number, name or city"
              value={search}
              onChange={setSearch}
            />
            <RefreshButton isLoading={isLoading} onClick={reload} />
          </div>
        </div>

        {loadError ? (
          <LoadError
            title="Customers could not be loaded"
            message={loadError}
            isRetrying={isLoading}
            onRetry={reload}
          />
        ) : customers === null ? (
          <LoadingRows label="Loading customers" />
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            text="Create the first customer to get started."
          />
        ) : visibleCustomers.length === 0 ? (
          <EmptyState
            title="No matching customers"
            text="Change the search or the status filter."
          />
        ) : (
          <CustomerTable
            customers={visibleCustomers}
            onSelect={(customer) => {
              setNotice(null);
              setPanel({ mode: "edit", customer });
            }}
          />
        )}
      </section>

      {panel && (
        <CustomerForm
          // A new key resets the form when another customer is opened
          key={panel.mode === "edit" ? panel.customer.customerNumber : "new"}
          customer={panel.mode === "edit" ? panel.customer : undefined}
          onClose={() => setPanel(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
