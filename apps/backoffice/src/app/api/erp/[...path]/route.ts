/**
 * Server-side proxy: forwards /api/erp/<path> to <ERP_API_URL>/<path>.
 * Because the browser only talks to Next.js, the ERP API needs no CORS setup.
 *
 * Only the routes listed in ALLOWED_ROUTES are forwarded. Everything else is
 * answered here and never reaches the ERP API.
 */

const DEFAULT_ERP_API_URL = "http://localhost:3000";
const TIMEOUT_MS = 10_000;

type Method = "GET" | "POST" | "PATCH" | "PUT";

type Route = {
  method: Method;
  path: string[];
  /** Patterns a ":param" segment must match, e.g. a sales order number */
  params?: Record<string, RegExp>;
  /** Overrides TIMEOUT_MS for a slow endpoint */
  timeoutMs?: number;
  /**
   * The query parameters this route forwards, each with its format check.
   * Without it, query strings are never forwarded.
   */
  query?: Record<string, (value: string) => boolean>;
};

const isKey = (value: string) => /^\S([\s\S]*\S)?$/.test(value) && value.length <= 20;

// GET /sales-orders: the parameters of the order list (Sprint 10D-A). The
// ERP API validates them completely; the proxy only lets these through.
const SALES_ORDER_LIST_QUERY: Route["query"] = {
  q: (value) => /\S/.test(value) && value.length <= 100,
  salesOrganization: (value) => /^[A-Z0-9]{4}$/.test(value),
  distributionChannel: (value) => /^[A-Z0-9]{2}$/.test(value),
  division: (value) => /^[A-Z0-9]{2}$/.test(value),
  soldTo: isKey,
  unitId: isKey,
  deliveryBlock: (value) => value === "SALES_REVIEW" || value === "NONE",
  orderDateFrom: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
  orderDateTo: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
  limit: (value) => /^(100|[1-9]\d?)$/.test(value),
  after: (value) => /^\d{10}$/.test(value),
};

// ":param" matches exactly one path segment, e.g. a material number.
// Add a line here when a new ERP endpoint should be reachable.
const ALLOWED_ROUTES: Route[] = [
  { method: "GET", path: ["materials"] },
  { method: "GET", path: ["materials", ":materialNumber"] },
  { method: "POST", path: ["materials"] },
  { method: "PATCH", path: ["materials", ":materialNumber"] },
  { method: "GET", path: ["customers"] },
  { method: "GET", path: ["customers", ":customerNumber"] },
  { method: "POST", path: ["customers"] },
  { method: "PATCH", path: ["customers", ":customerNumber"] },
  // Sales area assignments of a customer; listed with the customer
  { method: "POST", path: ["customers", ":customerNumber", "sales-areas"] },
  {
    method: "PATCH",
    path: [
      "customers",
      ":customerNumber",
      "sales-areas",
      ":salesOrganization",
      ":distributionChannel",
      ":division",
    ],
  },
  // Read-only currencies and organizational structure
  { method: "GET", path: ["currencies"] },
  { method: "GET", path: ["sales-organizations"] },
  { method: "GET", path: ["distribution-channels"] },
  { method: "GET", path: ["divisions"] },
  { method: "GET", path: ["sales-areas"] },
  { method: "GET", path: ["customer-accounts"] },
  { method: "GET", path: ["customer-accounts", ":accountCustomerNumber"] },
  {
    method: "PUT",
    path: ["customer-accounts", ":accountCustomerNumber", "members"],
  },
  { method: "GET", path: ["b2b-units"] },
  { method: "GET", path: ["b2b-units", ":unitId"] },
  { method: "POST", path: ["b2b-units"] },
  { method: "PATCH", path: ["b2b-units", ":unitId"] },
  // Read-only condition type configuration
  { method: "GET", path: ["condition-types"] },
  { method: "GET", path: ["price-conditions"] },
  { method: "GET", path: ["price-conditions", ":conditionId"] },
  { method: "POST", path: ["price-conditions"] },
  { method: "PATCH", path: ["price-conditions", ":conditionId"] },
  // Calculates only; POST because query strings are not forwarded
  { method: "POST", path: ["pricing", "price"] },
  // Read-only order simulation; nothing is stored
  { method: "POST", path: ["sales-orders", "simulate"] },
  // Creates a sales order. The ERP API transaction may wait up to 25 s for
  // locks, so the proxy waits longer than for other requests.
  { method: "POST", path: ["sales-orders"], timeoutMs: 30_000 },
  // The read-only order list with search, filters and pagination
  { method: "GET", path: ["sales-orders"], query: SALES_ORDER_LIST_QUERY },
  // A stored sales order; only 10-digit numbers, so e.g. "simulate" never
  // matches this route
  {
    method: "GET",
    path: ["sales-orders", ":salesOrderNumber"],
    params: { salesOrderNumber: /^\d{10}$/ },
  },
];

/** Read at request time; never taken from the incoming request */
function erpApiUrl() {
  return (process.env.ERP_API_URL || DEFAULT_ERP_API_URL).replace(/\/+$/, "");
}

function matchesPath(route: Route, segments: string[]) {
  return (
    route.path.length === segments.length &&
    route.path.every((part, index) =>
      part.startsWith(":")
        ? isValidParam(segments[index]) &&
          (route.params?.[part.slice(1)]?.test(segments[index]) ?? true)
        : part === segments[index],
    )
  );
}

function isValidParam(segment: string) {
  return segment !== "" && segment !== "." && segment !== "..";
}

async function proxy(
  request: Request,
  ctx: RouteContext<"/api/erp/[...path]">,
) {
  const { path } = await ctx.params;

  const routesForPath = ALLOWED_ROUTES.filter((route) =>
    matchesPath(route, path),
  );
  if (routesForPath.length === 0) {
    return errorResponse(404, "Unknown ERP resource.");
  }

  const route = routesForPath.find((r) => r.method === request.method);
  if (!route) {
    return errorResponse(405, "This action is not supported.", {
      Allow: routesForPath.map((r) => r.method).join(", "),
    });
  }

  // Query strings are only forwarded for routes that list their parameters,
  // and only those parameters, each once and in a valid format
  const query = forwardedQuery(route, new URL(request.url).searchParams);
  if (query instanceof Response) return query;
  const target = `${erpApiUrl()}/${path.map(encodeURIComponent).join("/")}${query}`;
  const hasBody = route.method !== "GET";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: route.method,
      headers: hasBody
        ? { "Content-Type": "application/json", Accept: "application/json" }
        : { Accept: "application/json" },
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(route.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    // The request reached the ERP API and may still be processed there
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return errorResponse(
        504,
        "The ERP API did not answer in time. The request may still have been processed.",
      );
    }
    return errorResponse(
      502,
      "The ERP API is not reachable. Please check that it is running.",
    );
  }

  // Never pass internal server error details on to the browser
  if (upstream.status >= 500) {
    return errorResponse(
      upstream.status,
      "The ERP API reported an internal error. Please try again later.",
    );
  }

  // 2xx and 4xx responses (e.g. validation messages) are passed through
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

/**
 * "" or "?..." with the checked parameters of the route, rebuilt from
 * scratch; a 400 response if the request has a parameter the route does
 * not allow, a repeated parameter or a value in a wrong format
 */
function forwardedQuery(route: Route, params: URLSearchParams): string | Response {
  if (!route.query) return "";
  const forwarded = new URLSearchParams();
  for (const name of new Set(params.keys())) {
    const check = Object.hasOwn(route.query, name) ? route.query[name] : undefined;
    if (!check) {
      return errorResponse(400, `Query parameter ${name} is not supported.`);
    }
    const values = params.getAll(name);
    if (values.length > 1) {
      return errorResponse(400, `Query parameter ${name} must be given only once.`);
    }
    if (!check(values[0])) {
      return errorResponse(400, `Query parameter ${name} has an invalid value.`);
    }
    forwarded.set(name, values[0]);
  }
  const text = forwarded.toString();
  return text ? `?${text}` : "";
}

function errorResponse(
  status: number,
  message: string,
  headers?: Record<string, string>,
) {
  return Response.json({ statusCode: status, message }, { status, headers });
}

// Every method goes through the same check, so unsupported methods are
// rejected by our route list instead of relying on framework defaults
export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
