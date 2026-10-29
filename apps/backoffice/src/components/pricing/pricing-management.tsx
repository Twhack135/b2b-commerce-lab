"use client";

import { useState } from "react";
import { listB2bUnits } from "@/lib/b2b-units";
import { listCustomers } from "@/lib/customers";
import { listMaterials } from "@/lib/materials";
import {
  filterConditions,
  SCOPE_LABELS,
} from "@/lib/price-condition-form";
import {
  listPriceConditions,
  type PriceCondition,
  type PriceConditionScope,
} from "@/lib/price-conditions";
import { useListData } from "@/lib/use-list-data";
import { useToday } from "@/lib/use-today";
import {
  EmptyState,
  LoadError,
  LoadingRows,
  PageHeader,
  RefreshButton,
  SearchInput,
  StatusFilter,
  statusCounts,
  SuccessNotice,
  type StatusFilterValue,
} from "../list-page";
import { PriceCheckPanel } from "./price-check-panel";
import { PriceConditionForm } from "./price-condition-form";
import { PriceConditionTable } from "./price-condition-table";

type Panel =
  | { kind: "create" }
  | { kind: "edit"; condition: PriceCondition }
  | { kind: "check" }
  | null;

const filterSelectClass =
  "rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function PricingManagement() {
  const conditions = useListData(listPriceConditions);
  // Choices of the condition form and the price check
  const materials = useListData(listMaterials);
  const customers = useListData(listCustomers);
  const units = useListData(listB2bUnits);
  const today = useToday();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [materialFilter, setMaterialFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState<PriceConditionScope | "">("");
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reloadAll() {
    conditions.reload();
    materials.reload();
    customers.reload();
    units.reload();
  }

  function open(next: Panel) {
    setNotice(null);
    setPanel(next);
  }

  function handleSaved(condition: PriceCondition, mode: "create" | "edit") {
    setPanel(null);
    setNotice(
      mode === "create"
        ? `Price condition ${condition.conditionId} was created.`
        : `Price condition ${condition.conditionId} was updated.`,
    );
    conditions.reload();
  }

  const all = conditions.items ?? [];
  const visible = filterConditions(all, {
    materialNumber: materialFilter,
    scope: scopeFilter,
    status: statusFilter,
    search,
  });
  const isFiltered =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    materialFilter !== "" ||
    scopeFilter !== "";
  // Materials of the stored conditions, so the filter also works while
  // the material list is loading
  const materialChoices = [
    ...new Map(
      all.map((c) => [c.materialNumber, c.materialDescription] as const),
    ),
  ].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Pricing"
        description="Customer-specific material prices. Priority: B2B unit price, then Sold-to price, then the material's base price."
        actionLabel="New Price Condition"
        onAction={() => open({ kind: "create" })}
        secondaryAction={{
          label: "Price Check",
          onClick: () => open({ kind: "check" }),
        }}
      />

      {notice && (
        <SuccessNotice message={notice} onDismiss={() => setNotice(null)} />
      )}

      {/* List card */}
      <section
        aria-label="Price conditions"
        className="mt-6 rounded-lg border border-line bg-surface shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">
            Price Conditions
            {conditions.items && (
              <span className="ml-2 font-normal text-ink-muted">
                ({isFiltered ? `${visible.length} of ` : ""}
                {conditions.items.length})
              </span>
            )}
          </h2>

          <StatusFilter
            value={statusFilter}
            onChange={setStatusFilter}
            counts={conditions.items ? statusCounts(conditions.items) : undefined}
          />

          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            Material
            <select
              aria-label="Filter by material"
              value={materialFilter}
              onChange={(e) => setMaterialFilter(e.target.value)}
              className={filterSelectClass}
            >
              <option value="">All</option>
              {materialChoices.map(([number, description]) => (
                <option key={number} value={number}>
                  {number} – {description}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            Level
            <select
              aria-label="Filter by level"
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as PriceConditionScope | "")}
              className={filterSelectClass}
            >
              <option value="">All</option>
              {(Object.keys(SCOPE_LABELS) as PriceConditionScope[]).map((scope) => (
                <option key={scope} value={scope}>
                  {SCOPE_LABELS[scope]}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <SearchInput
              label="Search price conditions"
              placeholder="Search material, Sold-to or unit"
              value={search}
              onChange={setSearch}
            />
            <RefreshButton
              isLoading={conditions.isLoading || units.isLoading}
              onClick={reloadAll}
            />
          </div>
        </div>

        {conditions.loadError ? (
          <LoadError
            title="Price conditions could not be loaded"
            message={conditions.loadError}
            isRetrying={conditions.isLoading}
            onRetry={reloadAll}
          />
        ) : conditions.items === null ? (
          <LoadingRows label="Loading price conditions" />
        ) : conditions.items.length === 0 ? (
          <EmptyState
            title="No price conditions yet"
            text="Without conditions, every B2B unit gets the material's base price. Create the first condition to give a unit or Sold-to its own price."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching price conditions"
            text="Change the search or the filters."
          />
        ) : (
          <PriceConditionTable
            conditions={visible}
            today={today}
            onSelect={(condition) => open({ kind: "edit", condition })}
          />
        )}
      </section>

      {(panel?.kind === "create" || panel?.kind === "edit") && (
        <PriceConditionForm
          // A new key resets the form when another condition is opened
          key={panel.kind === "edit" ? panel.condition.conditionId : "new"}
          condition={panel.kind === "edit" ? panel.condition : undefined}
          materials={materials.items}
          customers={customers.items}
          units={units.items}
          onClose={() => setPanel(null)}
          onSaved={handleSaved}
        />
      )}

      {panel?.kind === "check" && (
        <PriceCheckPanel
          materials={materials.items}
          units={units.items}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}
