"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listB2bUnits } from "@/lib/b2b-units";
import { listCustomers } from "@/lib/customers";
import { ApiError, errorMessage } from "@/lib/erp-api";
import { salesAreaLabel } from "@/lib/sales-area-display";
import { listSalesAreas, type SalesArea } from "@/lib/sales-areas";
import {
  deliveryBlockLabel,
  FIRST_PAGE,
  filterProblem,
  hasFilters,
  LatestRequest,
  listQuery,
  listView,
  nextPage,
  OVERVIEW_STORAGE_KEY,
  type OverviewFilters,
  type OverviewState,
  overviewQuery,
  PAGE_SIZES,
  pageNumber,
  parseOverviewUrl,
  previousPage,
  rangeLabel,
  SEARCH_MAX_LENGTH,
  salesAreaFilterChange,
  salesAreaFilterValue,
  STATUS_LABELS,
  summaryNetValue,
  summarySalesArea,
  withFilters,
} from "@/lib/sales-order-overview";
import {
  listSalesOrders,
  type SalesOrderList,
  type SalesOrderSummary,
} from "@/lib/sales-orders";
import { useListData } from "@/lib/use-list-data";
import { AlertIcon } from "../icons";
import {
  LoadError,
  LoadingRows,
  PageHeader,
  RefreshButton,
  SearchInput,
} from "../list-page";

/** Typing is applied to the URL (and the list) after this pause */
const INPUT_DELAY_MS = 350;

type Result =
  | { kind: "loaded"; list: SalesOrderList }
  | { kind: "error"; status: number; message: string };

/**
 * The sales order overview (like SAP VA05): stored orders, newest sales
 * order number first, searched, filtered and paged on the server. Every
 * row shows the order's own snapshots, never current master data. The
 * state is the page URL (see sales-order-overview.ts).
 */
export function SalesOrderOverview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.toString();
  const { state, ignored } = useMemo(
    () => parseOverviewUrl(new URLSearchParams(urlQuery)),
    [urlQuery],
  );

  const show = useCallback(
    (next: OverviewState) => {
      const query = overviewQuery(next);
      router.replace(query ? `/sales-orders?${query}` : "/sales-orders", { scroll: false });
    },
    [router],
  );

  // The way back from an order leads to this page of the overview
  useEffect(() => {
    try {
      window.sessionStorage.setItem(OVERVIEW_STORAGE_KEY, overviewQuery(state));
    } catch {
      // Without session storage the way back starts on page 1
    }
  }, [state]);

  // The list of the current URL. Increasing reloadCount loads it again.
  const apiQuery = listQuery(state);
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = `${apiQuery}#${reloadCount}`;
  const [result, setResult] = useState<{ key: string; result: Result } | null>(null);
  const [requests] = useState(() => new LatestRequest());
  useEffect(() => {
    const request = requests.start();
    listSalesOrders(apiQuery).then(
      (list) => {
        if (requests.isLatest(request)) {
          setResult({ key: requestKey, result: { kind: "loaded", list } });
        }
      },
      (error: unknown) => {
        if (requests.isLatest(request)) {
          setResult({
            key: requestKey,
            result: {
              kind: "error",
              status: error instanceof ApiError ? error.status : 0,
              message: errorMessage(error),
            },
          });
        }
      },
    );
  }, [apiQuery, requestKey, requests]);

  const isLoading = result?.key !== requestKey;
  const view = listView(state, isLoading || !result ? { kind: "loading" } : result.result);
  // While the next page or new filters load, the previous rows stay visible
  const shownList =
    view.kind === "orders"
      ? view.list
      : view.kind === "loading" && result?.result.kind === "loaded" && result.result.list.items.length > 0
        ? result.result.list
        : null;
  const reload = () => setReloadCount((count) => count + 1);
  const filtersSet = hasFilters(state.filters);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Sales"
        title="Sales Orders"
        description="Stored sales orders, newest first. Every order is shown as it was created."
        actionLabel="New Order Simulation"
        actionHref="/sales-orders/simulation"
      />

      {ignored.length > 0 && (
        <div
          role="status"
          data-ignored-parameters={ignored.join(" | ")}
          className="mt-6 flex flex-wrap items-start gap-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            Some values in the address could not be used and are ignored:{" "}
            {ignored.join(", ")}.
          </p>
          <button type="button" onClick={() => show(state)} className="font-medium underline">
            Remove them
          </button>
        </div>
      )}

      <section aria-label="Sales orders" className="mt-6 rounded-lg border border-line bg-surface shadow-sm">
        <Filters state={state} onChange={show} />

        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">
            Sales Orders
            {shownList && (
              <span data-total={shownList.total} className="ml-2 font-normal text-ink-muted">
                ({shownList.total} {filtersSet ? "matching" : "in total"})
              </span>
            )}
          </h2>
          <div className="ml-auto flex items-center gap-2">
            {filtersSet && (
              <button
                type="button"
                onClick={() => show(FIRST_PAGE)}
                className="rounded-md px-3 py-2 font-medium text-brand hover:bg-canvas"
              >
                Clear filters
              </button>
            )}
            <RefreshButton isLoading={isLoading} onClick={reload} />
          </div>
        </div>

        <div data-overview-state={isLoading && shownList ? "reloading" : view.kind}>
          {view.kind === "error" ? (
            <ListError view={view} onRetry={reload} onClear={() => show(FIRST_PAGE)} />
          ) : shownList ? (
            <div aria-busy={isLoading} className={isLoading ? "opacity-60 transition-opacity" : undefined}>
              <OrderTable orders={shownList.items} />
              <OrderCards orders={shownList.items} />
            </div>
          ) : view.kind === "loading" ? (
            <LoadingRows label="Loading sales orders" />
          ) : view.kind === "no-orders" ? (
            <div className="px-6 py-14 text-center">
              <p className="font-semibold">No sales orders yet</p>
              <p className="mt-1 text-ink-muted">
                Sales orders appear here once they are created from an order simulation.
              </p>
              <Link href="/sales-orders/simulation" className="mt-3 inline-block font-medium text-brand underline">
                Start a New Order Simulation
              </Link>
            </div>
          ) : view.kind === "no-matches" ? (
            <div className="px-6 py-14 text-center">
              <p className="font-semibold">No sales orders match your search and filters</p>
              <p className="mt-1 text-ink-muted">Change the search or the filters, or clear them.</p>
              <button
                type="button"
                onClick={() => show(FIRST_PAGE)}
                className="mt-3 font-medium text-brand underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <p className="font-semibold">This page has no sales orders</p>
              <p className="mt-1 text-ink-muted">The orders may have changed since the list was opened.</p>
              <button
                type="button"
                onClick={() => show(withFilters(state, {}))}
                className="mt-3 font-medium text-brand underline"
              >
                Back to the first page
              </button>
            </div>
          )}
        </div>

        <Pagination
          state={state}
          list={shownList}
          isLoading={isLoading}
          onChange={show}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search and filters
// ---------------------------------------------------------------------------

/**
 * Text that is applied after a pause in typing. The text follows the URL
 * when the URL changes from elsewhere (e.g. browser back or Clear filters),
 * but not when the URL only took over what was typed.
 */
function useDelayedInput(
  applied: string,
  apply: (value: string) => void,
  canApply: (value: string) => boolean,
) {
  const [draft, setDraft] = useState({ applied, text: applied });
  let text = draft.text;
  if (draft.applied !== applied) {
    text = draft.text.trim() === applied ? draft.text : applied;
    setDraft({ applied, text });
  }
  useEffect(() => {
    const value = text.trim();
    if (value === applied || !canApply(value)) return;
    const timer = setTimeout(() => apply(value), INPUT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, applied, apply, canApply]);
  return [text, (value: string) => setDraft({ applied, text: value })] as const;
}

type TextFilter = "q" | "soldTo" | "unitId" | "orderDateFrom" | "orderDateTo";

/**
 * A filter input applied after a pause in typing, once its value is valid.
 * It is applied to the overview state at that moment, so changes made to
 * other filters in the meantime are kept.
 */
function useTextFilter(
  state: OverviewState,
  onChange: (state: OverviewState) => void,
  name: TextFilter,
) {
  const latest = useRef({ state, onChange });
  useEffect(() => {
    latest.current = { state, onChange };
  });
  const apply = useCallback(
    (value: string) =>
      latest.current.onChange(withFilters(latest.current.state, { [name]: value })),
    [name],
  );
  // A date range that ends before it starts is never applied; a waiting
  // date is applied as soon as the other date allows it
  const { orderDateFrom, orderDateTo } = state.filters;
  const canApply = useCallback(
    (value: string) => {
      if (filterProblem(name, value) !== null) return false;
      if (name === "orderDateFrom") return !value || !orderDateTo || value <= orderDateTo;
      if (name === "orderDateTo") return !value || !orderDateFrom || value >= orderDateFrom;
      return true;
    },
    [name, orderDateFrom, orderDateTo],
  );
  return useDelayedInput(state.filters[name], apply, canApply);
}

function Filters({
  state,
  onChange,
}: {
  state: OverviewState;
  onChange: (state: OverviewState) => void;
}) {
  const { filters } = state;
  const salesAreas = useListData(listSalesAreas);
  const customers = useListData(listCustomers);
  const units = useListData(listB2bUnits);
  const [showMore, setShowMore] = useState(filters.soldTo !== "" || filters.unitId !== "");

  const change = (filterChange: Partial<OverviewFilters>) =>
    onChange(withFilters(state, filterChange));
  const [search, setSearch] = useTextFilter(state, onChange, "q");
  const [soldTo, setSoldTo] = useTextFilter(state, onChange, "soldTo");
  const [unitId, setUnitId] = useTextFilter(state, onChange, "unitId");
  const [dateFrom, setDateFrom] = useTextFilter(state, onChange, "orderDateFrom");
  const [dateTo, setDateTo] = useTextFilter(state, onChange, "orderDateTo");
  const dateRangeError =
    dateFrom && dateTo && dateTo < dateFrom ? "The end date is before the start date." : undefined;

  const salesAreaValue = salesAreaFilterValue(filters);
  return (
    <div className="space-y-3 border-b border-line px-4 py-3">
      <div className="flex gap-2">
        <SearchInput
          label="Search sales orders by number, customer reference, Sold-to number or name"
          placeholder="Search number, reference or Sold-to"
          value={search}
          onChange={(value) => setSearch(value.slice(0, SEARCH_MAX_LENGTH))}
          className="relative min-w-0 flex-1"
        />
        <button
          type="button"
          aria-expanded={showMore}
          aria-controls="moreFilters"
          onClick={() => setShowMore((open) => !open)}
          className="shrink-0 rounded-md border border-line px-3 py-2 font-medium hover:bg-canvas"
        >
          {showMore ? "Fewer filters" : "More filters"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FilterField id="salesAreaFilter" label="Sales area">
          <select
            id="salesAreaFilter"
            value={salesAreaValue}
            onChange={(event) => change(salesAreaFilterChange(event.target.value))}
            className={selectClass}
          >
            <option value="">All sales areas</option>
            {salesAreaOptions(salesAreas.items, salesAreaValue).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField id="deliveryBlockFilter" label="Delivery block">
          <select
            id="deliveryBlockFilter"
            value={filters.deliveryBlock}
            onChange={(event) =>
              change({ deliveryBlock: event.target.value as OverviewFilters["deliveryBlock"] })
            }
            className={selectClass}
          >
            <option value="">All</option>
            <option value="SALES_REVIEW">Sales review (SALES_REVIEW)</option>
            <option value="NONE">No delivery block</option>
          </select>
        </FilterField>
        <FilterField id="orderDateFrom" label="Order date from">
          <input
            id="orderDateFrom"
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
            className={selectClass}
          />
        </FilterField>
        <FilterField id="orderDateTo" label="Order date to" error={dateRangeError}>
          <input
            id="orderDateTo"
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            aria-invalid={dateRangeError ? true : undefined}
            onChange={(event) => setDateTo(event.target.value)}
            className={selectClass}
          />
        </FilterField>
      </div>

      {showMore && (
        <div id="moreFilters" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FilterField id="soldToFilter" label="Sold-to number" hint="Exact customer number">
            <input
              id="soldToFilter"
              list="soldToOptions"
              value={soldTo}
              maxLength={20}
              autoComplete="off"
              onChange={(event) => setSoldTo(event.target.value)}
              placeholder="e.g. CUST-1000"
              className={selectClass}
            />
            {/* Suggestions from current master data; the list itself shows
                the Sold-to as stored in each order */}
            <datalist id="soldToOptions">
              {customers.items?.map((customer) => (
                <option key={customer.customerNumber} value={customer.customerNumber}>
                  {customer.name}
                </option>
              ))}
            </datalist>
          </FilterField>
          <FilterField id="unitIdFilter" label="B2B unit ID" hint="Exact ID">
            <input
              id="unitIdFilter"
              list="unitIdOptions"
              value={unitId}
              maxLength={20}
              autoComplete="off"
              onChange={(event) => setUnitId(event.target.value)}
              placeholder="e.g. UNIT-STUTTGART"
              className={selectClass}
            />
            <datalist id="unitIdOptions">
              {units.items?.map((unit) => (
                <option key={unit.unitId} value={unit.unitId}>
                  {unit.name}
                </option>
              ))}
            </datalist>
          </FilterField>
        </div>
      )}
    </div>
  );
}

const selectClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 aria-invalid:border-danger";

function FilterField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 text-sm">
      <label htmlFor={id} className="mb-1 block font-medium text-ink-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

/**
 * Sales organizations ("all channels") and their sales areas from the
 * configuration; a value from the address that is not configured stays
 * selectable, so the select always shows the active filter
 */
function salesAreaOptions(areas: SalesArea[] | null, current: string) {
  const options: { value: string; label: string }[] = [];
  for (const area of areas ?? []) {
    const organization = area.salesOrganization;
    if (!options.some((o) => o.value === organization)) {
      options.push({
        value: organization,
        label: `${organization} – ${area.salesOrganizationName} (all)`,
      });
    }
    options.push({
      value: `${organization}/${area.distributionChannel}/${area.division}`,
      label: salesAreaLabel(area),
    });
  }
  if (current && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: current });
  }
  return options;
}

// ---------------------------------------------------------------------------
// The list: a table on wide screens, cards on narrow ones
// ---------------------------------------------------------------------------

function OrderLink({ order }: { order: SalesOrderSummary }) {
  return (
    <Link
      href={`/sales-orders/${order.salesOrderNumber}`}
      data-order-link={order.salesOrderNumber}
      className="font-mono font-semibold text-brand hover:underline"
    >
      {order.salesOrderNumber}
    </Link>
  );
}

function DeliveryBlockBadge({ order }: { order: SalesOrderSummary }) {
  return order.deliveryBlock ? (
    <span
      data-delivery-block={order.deliveryBlock}
      title="Delivery block SALES_REVIEW: delivery waits until Sales has reviewed the customer note"
      className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-warning"
    >
      <AlertIcon className="size-3" />
      {deliveryBlockLabel(order)}
    </span>
  ) : (
    <span data-delivery-block="NONE" className="text-ink-muted">
      {deliveryBlockLabel(order)}
    </span>
  );
}

function StatusLabel({ order }: { order: SalesOrderSummary }) {
  return (
    <span
      data-order-status={order.status}
      className="rounded-full border border-success/30 bg-success-soft px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-success"
    >
      {STATUS_LABELS[order.status]}
    </span>
  );
}

function OrderTable({ orders }: { orders: SalesOrderSummary[] }) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full text-left text-sm">
        <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Sales Order</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Order Date</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Sold-to</th>
            <th scope="col" className="px-4 py-2.5 font-medium">B2B Unit</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Sales Area</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Net Value</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Delivery Block</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((order) => (
            <tr key={order.salesOrderNumber} data-order-row={order.salesOrderNumber} className="align-top hover:bg-canvas/40">
              <td className="px-4 py-3">
                <OrderLink order={order} />
                {order.customerReference && (
                  <p data-customer-reference className="mt-0.5 text-xs text-ink-muted">
                    Ref. {order.customerReference}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 font-mono whitespace-nowrap tabular-nums">{order.orderDate}</td>
              <td className="px-4 py-3">
                <p className="font-mono text-xs">{order.soldTo.customerNumber}</p>
                <p>{order.soldTo.name}</p>
              </td>
              <td className="px-4 py-3">
                <p className="font-mono text-xs">{order.unit.unitId}</p>
                <p>{order.unit.name}</p>
              </td>
              <td className="px-4 py-3 font-mono whitespace-nowrap">{summarySalesArea(order)}</td>
              <td data-net-value className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                {summaryNetValue(order)}
              </td>
              <td className="px-4 py-3">
                <DeliveryBlockBadge order={order} />
              </td>
              <td className="px-4 py-3">
                <StatusLabel order={order} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderCards({ orders }: { orders: SalesOrderSummary[] }) {
  return (
    <ul className="divide-y divide-line lg:hidden">
      {orders.map((order) => (
        <li key={order.salesOrderNumber} data-order-card={order.salesOrderNumber} className="px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <OrderLink order={order} />
            <span data-net-value className="font-medium tabular-nums">{summaryNetValue(order)}</span>
          </div>
          {order.customerReference && (
            <p data-customer-reference className="text-xs text-ink-muted">
              Ref. {order.customerReference}
            </p>
          )}
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-muted">Order date</dt>
            <dd className="font-mono tabular-nums">{order.orderDate}</dd>
            <dt className="text-ink-muted">Sold-to</dt>
            <dd className="min-w-0 break-words">
              <span className="font-mono text-xs">{order.soldTo.customerNumber}</span> {order.soldTo.name}
            </dd>
            <dt className="text-ink-muted">B2B unit</dt>
            <dd className="min-w-0 break-words">
              <span className="font-mono text-xs">{order.unit.unitId}</span> {order.unit.name}
            </dd>
            <dt className="text-ink-muted">Sales area</dt>
            <dd className="font-mono">{summarySalesArea(order)}</dd>
          </dl>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusLabel order={order} />
            <DeliveryBlockBadge order={order} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ListError({
  view,
  onRetry,
  onClear,
}: {
  view: { message: string; invalidQuery: boolean };
  onRetry: () => void;
  onClear: () => void;
}) {
  if (view.invalidQuery) {
    return (
      <div data-invalid-query className="px-6 py-14 text-center">
        <p className="font-semibold">The search or filters could not be used</p>
        <p className="mt-1 text-ink-muted">{view.message}</p>
        <button type="button" onClick={onClear} className="mt-3 font-medium text-brand underline">
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <LoadError
      title="Sales orders could not be loaded"
      message={view.message}
      isRetrying={false}
      onRetry={onRetry}
    />
  );
}

// ---------------------------------------------------------------------------
// Pagination: forward with the cursor of the API, back with the history
// ---------------------------------------------------------------------------

function Pagination({
  state,
  list,
  isLoading,
  onChange,
}: {
  state: OverviewState;
  list: SalesOrderList | null;
  isLoading: boolean;
  onChange: (state: OverviewState) => void;
}) {
  const page = pageNumber(state);
  const sizes = PAGE_SIZES.includes(state.limit as (typeof PAGE_SIZES)[number])
    ? PAGE_SIZES
    : [...PAGE_SIZES, state.limit];
  const nextCursor = list?.hasMore ? list.nextCursor : null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-sm">
      <p data-page={page} className="text-ink-muted">
        Page {page}
        {list && list.items.length > 0 && (
          <span data-range>
            {" "}
            · {rangeLabel(state, list)}
          </span>
        )}
        {isLoading && <span role="status"> · Loading…</span>}
      </p>
      <label className="flex items-center gap-2 text-ink-muted">
        Per page
        <select
          id="pageSize"
          value={state.limit}
          onChange={(event) => onChange(withFilters(state, {}, Number(event.target.value)))}
          className="rounded-md border border-line bg-surface px-2 py-1"
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div className="ml-auto flex flex-wrap gap-2">
        {page > 2 && (
          <button
            type="button"
            data-first-page
            disabled={isLoading}
            onClick={() => onChange(withFilters(state, {}))}
            className={pageButtonClass}
          >
            First page
          </button>
        )}
        <button
          type="button"
          data-previous-page
          disabled={page === 1 || isLoading}
          onClick={() => onChange(previousPage(state))}
          className={pageButtonClass}
        >
          Previous
        </button>
        <button
          type="button"
          data-next-page
          disabled={!nextCursor || isLoading}
          onClick={() => nextCursor && onChange(nextPage(state, nextCursor))}
          className={pageButtonClass}
        >
          Next
        </button>
      </div>
      <p className="w-full text-xs text-ink-muted">
        Sorted by sales order number, newest first. Orders created after the list was opened
        appear on the first page; use Refresh or go back to the first page to see them.
      </p>
    </div>
  );
}

const pageButtonClass =
  "rounded-md border border-line px-3 py-1.5 font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";
