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

// ":param" matches exactly one path segment, e.g. a material number.
// Add a line here when a new ERP endpoint should be reachable.
const ALLOWED_ROUTES: { method: Method; path: string[] }[] = [
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
];

/** Read at request time; never taken from the incoming request */
function erpApiUrl() {
  return (process.env.ERP_API_URL || DEFAULT_ERP_API_URL).replace(/\/+$/, "");
}

function matchesPath(pattern: string[], segments: string[]) {
  return (
    pattern.length === segments.length &&
    pattern.every((part, index) =>
      part.startsWith(":")
        ? isValidParam(segments[index])
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
    matchesPath(route.path, path),
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

  // Query strings are not forwarded; no ERP endpoint uses them yet
  const target = `${erpApiUrl()}/${path.map(encodeURIComponent).join("/")}`;
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
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
