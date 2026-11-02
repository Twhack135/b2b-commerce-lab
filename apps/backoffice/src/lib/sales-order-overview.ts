// The sales order overview: its state lives completely in the URL of the
// page (search, filters, page size and the page), so a reload, the browser
// back button and the way back from an order restore exactly the same view.
// Only imports without runtime code, so it can be tested with `node --test`.
//
// Pagination follows the forward-only keyset API GET /sales-orders: `after`
// is the cursor of the current page, `prev` the cursors of the pages before
// it (the client-side history for "Previous"). Page 1 has no cursor.
// New orders get higher numbers and therefore appear on page 1; pages
// already listed do not shift (see "Refresh" in the overview).

import { isCalendarDate } from "./dates.ts";
import { formatApiAmount } from "./money.ts";
import type { SalesOrderList, SalesOrderSummary } from "./sales-orders.ts";

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZES = [25, 50, 100] as const;
export const MAX_PAGE_SIZE = 100;
export const SEARCH_MAX_LENGTH = 100;
/** Bound for the cursor history in the URL */
export const MAX_PREVIOUS_PAGES = 200;

export type DeliveryBlockFilter = "SALES_REVIEW" | "NONE";

/** Search and filters; "" means not set */
export type OverviewFilters = {
  q: string;
  salesOrganization: string;
  distributionChannel: string;
  division: string;
  soldTo: string;
  unitId: string;
  deliveryBlock: "" | DeliveryBlockFilter;
  orderDateFrom: string;
  orderDateTo: string;
};

export type OverviewState = {
  filters: OverviewFilters;
  limit: number;
  /** Cursor of the current page; null on page 1 */
  after: string | null;
  /** Cursors of the pages before the current one, page 2 first */
  prev: string[];
};

export const NO_FILTERS: OverviewFilters = {
  q: "",
  salesOrganization: "",
  distributionChannel: "",
  division: "",
  soldTo: "",
  unitId: "",
  deliveryBlock: "",
  orderDateFrom: "",
  orderDateTo: "",
};

export const FIRST_PAGE: OverviewState = {
  filters: NO_FILTERS,
  limit: DEFAULT_PAGE_SIZE,
  after: null,
  prev: [],
};

const FILTER_NAMES = Object.keys(NO_FILTERS) as (keyof OverviewFilters)[];

/** Every parameter the overview URL may contain, in URL order */
export const URL_PARAMETERS = [...FILTER_NAMES, "limit", "after", "prev"] as const;

const SALES_ORDER_NUMBER = /^\d{10}$/;
const BUSINESS_KEY = /^\S([\s\S]*\S)?$/;
const KEY_MAX_LENGTH = 20;

/** Why a filter value cannot be used, or null; same rules as the ERP API */
const FILTER_RULES: Record<keyof OverviewFilters, (value: string) => string | null> = {
  q: (value) =>
    value.trim() === ""
      ? "is empty"
      : value.length > SEARCH_MAX_LENGTH
        ? `is longer than ${SEARCH_MAX_LENGTH} characters`
        : null,
  salesOrganization: (value) =>
    /^[A-Z0-9]{4}$/.test(value) ? null : "is not a sales organization code",
  distributionChannel: (value) =>
    /^[A-Z0-9]{2}$/.test(value) ? null : "is not a distribution channel code",
  division: (value) => (/^[A-Z0-9]{2}$/.test(value) ? null : "is not a division code"),
  soldTo: (value) => keyProblem(value),
  unitId: (value) => keyProblem(value),
  deliveryBlock: (value) =>
    value === "SALES_REVIEW" || value === "NONE" ? null : "must be SALES_REVIEW or NONE",
  orderDateFrom: (value) => (isCalendarDate(value) ? null : "is not a valid date"),
  orderDateTo: (value) => (isCalendarDate(value) ? null : "is not a valid date"),
};

function keyProblem(value: string): string | null {
  if (!BUSINESS_KEY.test(value)) return "is empty or starts or ends with a space";
  if (value.length > KEY_MAX_LENGTH) return `is longer than ${KEY_MAX_LENGTH} characters`;
  return null;
}

/** Why a filter input cannot be applied yet, or null ("" is always fine) */
export function filterProblem(name: keyof OverviewFilters, value: string): string | null {
  return value === "" ? null : FILTER_RULES[name](value);
}

/**
 * Session storage key of the last overview URL query, for the way back
 * from an order to the same overview page
 */
export const OVERVIEW_STORAGE_KEY = "b2b-backoffice.sales-order-overview";

/** The parameters of a page URL, e.g. from useSearchParams() */
export type UrlParameters = { getAll(name: string): string[]; keys(): Iterable<string> };

/**
 * The overview state of a page URL. Values that cannot be used are left
 * out and listed in `ignored`, so the overview never sends them to the ERP
 * API: unknown or repeated parameters, invalid values, a channel without
 * sales organization, a date range that ends before it starts, and a page
 * history that does not fit the current page (then page 1 is shown).
 */
export function parseOverviewUrl(params: UrlParameters): {
  state: OverviewState;
  ignored: string[];
} {
  const ignored: string[] = [];
  const single = (name: string): string | null => {
    const values = params.getAll(name);
    if (values.length > 1) {
      ignored.push(`${name} (given more than once)`);
      return null;
    }
    return values[0] ?? null;
  };

  for (const name of new Set(params.keys())) {
    if (!(URL_PARAMETERS as readonly string[]).includes(name)) {
      ignored.push(`${name} (unknown parameter)`);
    }
  }

  const filters: OverviewFilters = { ...NO_FILTERS };
  for (const name of FILTER_NAMES) {
    const value = single(name);
    if (value === null) continue;
    const problem = FILTER_RULES[name](value);
    if (problem) {
      ignored.push(`${name} (${problem})`);
    } else {
      // Checked by FILTER_RULES.deliveryBlock
      (filters as Record<string, string>)[name] = name === "q" ? value.trim() : value;
    }
  }
  if (filters.distributionChannel && !filters.salesOrganization) {
    ignored.push("distributionChannel (needs a sales organization)");
    filters.distributionChannel = "";
  }
  if (filters.division && !filters.distributionChannel) {
    ignored.push("division (needs a distribution channel)");
    filters.division = "";
  }
  if (filters.orderDateFrom && filters.orderDateTo && filters.orderDateTo < filters.orderDateFrom) {
    ignored.push("orderDateTo (before orderDateFrom)");
    filters.orderDateTo = "";
  }

  let limit = DEFAULT_PAGE_SIZE;
  const limitText = single("limit");
  if (limitText !== null) {
    if (/^(100|[1-9]\d?)$/.test(limitText)) {
      limit = Number(limitText);
    } else {
      ignored.push(`limit (must be a whole number from 1 to ${MAX_PAGE_SIZE})`);
    }
  }

  const page = parsePage(single("after"), single("prev"));
  if (page.problem) ignored.push(page.problem);

  return { state: { filters, limit, after: page.after, prev: page.prev }, ignored };
}

function parsePage(
  after: string | null,
  prevText: string | null,
): { after: string | null; prev: string[]; problem?: string } {
  const firstPage = (problem: string) => ({ after: null, prev: [], problem });
  if (after === null) {
    return prevText === null ? { after: null, prev: [] } : firstPage("prev (without page)");
  }
  if (!SALES_ORDER_NUMBER.test(after)) return firstPage("after (not a page of the list)");
  const prev = prevText === null ? [] : prevText.split(",");
  if (prev.length > MAX_PREVIOUS_PAGES) return firstPage("prev (too many pages)");
  // Each page starts below the one before it
  const cursors = [...prev, after];
  const descending = cursors.every(
    (cursor, index) =>
      SALES_ORDER_NUMBER.test(cursor) && (index === 0 || cursor < cursors[index - 1]),
  );
  if (!descending) return firstPage("prev (does not fit the page)");
  return { after, prev };
}

/** The URL query of the state, without defaults (empty on page 1 without filters) */
export function overviewQuery(state: OverviewState): string {
  const params = filterParams(state);
  if (state.after) params.set("after", state.after);
  if (state.prev.length > 0) params.set("prev", state.prev.join(","));
  return params.toString();
}

/** The query of GET /sales-orders for the current page */
export function listQuery(state: OverviewState): string {
  const params = filterParams(state);
  if (state.after) params.set("after", state.after);
  return params.toString();
}

function filterParams(state: OverviewState): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of FILTER_NAMES) {
    const value = state.filters[name];
    if (value !== "") params.set(name, value);
  }
  if (state.limit !== DEFAULT_PAGE_SIZE) params.set("limit", String(state.limit));
  return params;
}

/** True if any search or filter is set */
export function hasFilters(filters: OverviewFilters): boolean {
  return FILTER_NAMES.some((name) => filters[name] !== "");
}

/** Changed search, filters or page size always start again on page 1 */
export function withFilters(
  state: OverviewState,
  change: Partial<OverviewFilters>,
  limit: number = state.limit,
): OverviewState {
  return { filters: { ...state.filters, ...change }, limit, after: null, prev: [] };
}

export function nextPage(state: OverviewState, nextCursor: string): OverviewState {
  return {
    ...state,
    after: nextCursor,
    prev: state.after ? [...state.prev, state.after] : [],
  };
}

export function previousPage(state: OverviewState): OverviewState {
  if (!state.after) return state;
  return {
    ...state,
    after: state.prev.at(-1) ?? null,
    prev: state.prev.slice(0, -1),
  };
}

/** 1 for the first page */
export function pageNumber(state: OverviewState): number {
  return state.after ? state.prev.length + 2 : 1;
}

// ---------------------------------------------------------------------------
// Sales area filter: one select. "" = all, "1000" = a sales organization,
// "1000/10" = a distribution channel in it, "1000/10/00" = a sales area.
// ---------------------------------------------------------------------------

export function salesAreaFilterValue(filters: OverviewFilters): string {
  return [filters.salesOrganization, filters.distributionChannel, filters.division]
    .filter(Boolean)
    .join("/");
}

export function salesAreaFilterChange(
  value: string,
): Pick<OverviewFilters, "salesOrganization" | "distributionChannel" | "division"> {
  const [salesOrganization = "", distributionChannel = "", division = ""] = value
    ? value.split("/")
    : [];
  return { salesOrganization, distributionChannel, division };
}

// ---------------------------------------------------------------------------
// What the list shows
// ---------------------------------------------------------------------------

export type ListView =
  | { kind: "loading" }
  | { kind: "error"; message: string; invalidQuery: boolean }
  /** No sales order exists at all */
  | { kind: "no-orders" }
  /** Orders exist, but none matches the search and filters */
  | { kind: "no-matches" }
  /** A later page that is empty, e.g. after orders changed */
  | { kind: "page-empty" }
  | { kind: "orders"; list: SalesOrderList };

export function listView(
  state: OverviewState,
  result:
    | { kind: "loading" }
    | { kind: "error"; status: number; message: string }
    | { kind: "loaded"; list: SalesOrderList },
): ListView {
  if (result.kind === "loading") return { kind: "loading" };
  if (result.kind === "error") {
    return { kind: "error", message: result.message, invalidQuery: result.status === 400 };
  }
  const { list } = result;
  if (list.items.length > 0) return { kind: "orders", list };
  if (list.total > 0 || pageNumber(state) > 1) return { kind: "page-empty" };
  return hasFilters(state.filters) ? { kind: "no-matches" } : { kind: "no-orders" };
}

/** "10,695.00 EUR", "198.00 PLN", "1,400,000 JPY" */
export function summaryNetValue(order: SalesOrderSummary): string {
  return `${formatApiAmount(order.netValue, order.currencyDecimals)} ${order.currency}`;
}

export const STATUS_LABELS: Record<SalesOrderSummary["status"], string> = {
  OPEN: "Open",
};

/** The delivery block as shown in the list */
export function deliveryBlockLabel(order: SalesOrderSummary): string {
  return order.deliveryBlock === "SALES_REVIEW" ? "Sales review" : "None";
}

/** "1000/10/00" */
export function summarySalesArea(order: SalesOrderSummary): string {
  const { salesOrganization, distributionChannel, division } = order.salesArea;
  return `${salesOrganization}/${distributionChannel}/${division}`;
}

/** "Showing 26–50 of 61" */
export function rangeLabel(state: OverviewState, list: SalesOrderList): string {
  if (list.items.length === 0) return `0 of ${list.total}`;
  const first = (pageNumber(state) - 1) * state.limit + 1;
  return `${first}–${first + list.items.length - 1} of ${list.total}`;
}

// ---------------------------------------------------------------------------
// Answers that arrive late
// ---------------------------------------------------------------------------

/**
 * Hands out a number per request; only the answer of the latest request
 * may be shown, so a slow answer for old filters never replaces the result
 * of newer ones
 */
export class LatestRequest {
  private latest = 0;

  start(): number {
    this.latest += 1;
    return this.latest;
  }

  isLatest(request: number): boolean {
    return request === this.latest;
  }
}
