"use client";

import { useState } from "react";
import { listCustomers, type Customer } from "@/lib/customers";
import { useListData } from "@/lib/use-list-data";
import {
  EmptyState,
  LoadError,
  LoadingRows,
  PageHeader,
  RefreshButton,
  SearchInput,
  SuccessNotice,
} from "../list-page";
import { CustomerForm } from "./customer-form";
import { CustomerTable } from "./customer-table";

type Panel = { mode: "create" } | { mode: "edit"; customer: Customer } | null;

type StatusFilter = "all" | "active" | "inactive";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function CustomerManagement() {
  const {
    items: customers,
    isLoading,
    loadError,
    reload,
  } = useListData(listCustomers);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
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
  const counts: Record<StatusFilter, number> = {
    all: all.length,
    active: all.filter((customer) => customer.isActive).length,
    inactive: all.filter((customer) => !customer.isActive).length,
  };

  const query = search.trim().toLowerCase();
  const visibleCustomers = all.filter(
    (customer) =>
      (statusFilter === "all" ||
        customer.isActive === (statusFilter === "active")) &&
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

          <div
            role="radiogroup"
            aria-label="Filter by status"
            className="inline-flex rounded-md border border-line p-0.5"
          >
            {STATUS_FILTERS.map((filter) => {
              const isSelected = statusFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setStatusFilter(filter.value)}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    isSelected
                      ? "bg-brand-soft text-brand-strong"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {filter.label}
                  {customers && (
                    <span className="ml-1 tabular-nums opacity-70">
                      {counts[filter.value]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

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
