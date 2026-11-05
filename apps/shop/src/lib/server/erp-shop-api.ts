import "server-only";
import { readShopServerConfig } from "./config";

// The only way from the shop to the ERP: server-side calls to the shop API
// /shop/v1 with the service key. The browser never calls the ERP API, and
// the shop never calls the ERP admin endpoints (docs/adr/0001, 0005).
//
// The service key only proves that the call comes from the shop server; it
// authorizes no customer data. Customer calls also carry the user's session
// token (X-Shop-Session), taken from the HttpOnly cookie (docs/adr/0003).

const SERVICE_KEY_HEADER = "X-Shop-Service-Key";
const SESSION_HEADER = "X-Shop-Session";
const CLIENT_ADDRESS_HEADER = "X-Shop-Client-Address";
/** The unit the user chose (a preference; the ERP checks it every time) */
const UNIT_HEADER = "X-Shop-Unit";
const TIMEOUT_MS = 10_000;

/** The fixed paths the shop calls; nothing else is ever requested */
type ShopApiPath =
  | "/shop/v1/health"
  | "/shop/v1/auth/login"
  | "/shop/v1/auth/activation"
  | "/shop/v1/auth/password-reset"
  | "/shop/v1/auth/logout"
  | "/shop/v1/account";

type Answer = { status: number; body: unknown };

/**
 * One call to the ERP shop API. Configuration problems, network errors and
 * timeouts all answer status 0; the reason is only logged on the server.
 */
async function callShopApi(
  path: ShopApiPath,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    sessionToken?: string;
    clientAddress?: string;
    unitId?: string;
  } = {},
): Promise<Answer> {
  const config = readShopServerConfig(process.env);
  if (!config.ok) {
    console.error(`Shop: ERP shop API not configured: ${config.problem}`);
    return { status: 0, body: null };
  }
  const headers: Record<string, string> = {
    [SERVICE_KEY_HEADER]: config.serviceKey,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.sessionToken) headers[SESSION_HEADER] = options.sessionToken;
  if (options.clientAddress) headers[CLIENT_ADDRESS_HEADER] = options.clientAddress;
  if (options.unitId) headers[UNIT_HEADER] = options.unitId;
  try {
    const response = await fetch(`${config.erpApiUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    console.error(`Shop: ERP shop API not reachable (${path})`);
    return { status: 0, body: null };
  }
}

export type ErpStatus = "ok" | "unavailable";

/** Technical health of the ERP shop API, without reasons */
export async function erpShopHealth(): Promise<ErpStatus> {
  const answer = await callShopApi("/shop/v1/health");
  const ok =
    answer.status === 200 &&
    typeof answer.body === "object" &&
    answer.body !== null &&
    "status" in answer.body &&
    answer.body.status === "ok";
  if (!ok && answer.status !== 0) console.error(`Shop: ERP shop API health answered HTTP ${answer.status}`);
  return ok ? "ok" : "unavailable";
}

/** The signed-in user as the ERP shop API describes them */
export type ShopUser = {
  email: string;
  displayName: string;
  role: "BUYER";
  account: { customerNumber: string; name: string };
};

/** A unit the user may act for; canOrder is false while it is inactive */
export type ShopUnit = { unitId: string; name: string; canOrder: boolean };

/**
 * The signed-in user's working context, checked by the ERP on this request:
 * the authorized units and the selected one (always one of them, or null).
 */
export type ShopAccount = {
  user: ShopUser;
  units: ShopUnit[];
  selectedUnit: ShopUnit | null;
  /** The remembered unit is not (or no longer) authorized */
  requestedUnitRejected: boolean;
  expiresAt: string;
};

/** Failures as the shop shows them: no reasons beyond these */
export type AuthFailure = "invalid" | "locked" | "unavailable";

function failureOf(status: number): AuthFailure {
  if (status === 429) return "locked";
  if (status === 400 || status === 401) return "invalid";
  if (status !== 0) console.error(`Shop: ERP shop API answered HTTP ${status}`);
  return "unavailable";
}

export async function login(input: {
  email: string;
  password: string;
  clientAddress?: string;
  previousSessionToken?: string;
}): Promise<{ ok: true; sessionToken: string; expiresAt: Date } | { ok: false; failure: AuthFailure }> {
  const answer = await callShopApi("/shop/v1/auth/login", {
    method: "POST",
    body: { email: input.email, password: input.password },
    clientAddress: input.clientAddress,
    sessionToken: input.previousSessionToken,
  });
  const body = answer.body as { sessionToken?: unknown; expiresAt?: unknown } | null;
  if (answer.status === 200 && typeof body?.sessionToken === "string" && typeof body.expiresAt === "string") {
    return { ok: true, sessionToken: body.sessionToken, expiresAt: new Date(body.expiresAt) };
  }
  return { ok: false, failure: failureOf(answer.status) };
}

export async function activate(input: {
  token: string;
  password: string;
  clientAddress?: string;
}): Promise<{ ok: true } | { ok: false; failure: AuthFailure | "password"; messages: string[] }> {
  const answer = await callShopApi("/shop/v1/auth/activation", {
    method: "POST",
    body: { token: input.token, password: input.password },
    clientAddress: input.clientAddress,
  });
  if (answer.status === 204) return { ok: true };
  const body = answer.body as { code?: unknown; message?: unknown } | null;
  if (answer.status === 400 && body?.code === "PASSWORD_POLICY" && Array.isArray(body.message)) {
    return { ok: false, failure: "password", messages: body.message.filter((m): m is string => typeof m === "string") };
  }
  return { ok: false, failure: failureOf(answer.status), messages: [] };
}

/** A new password with a reset link (Sprint 12C); the same answers as activate */
export async function resetPassword(input: {
  token: string;
  password: string;
  clientAddress?: string;
}): Promise<{ ok: true } | { ok: false; failure: AuthFailure | "password"; messages: string[] }> {
  const answer = await callShopApi("/shop/v1/auth/password-reset", {
    method: "POST",
    body: { token: input.token, password: input.password },
    clientAddress: input.clientAddress,
  });
  if (answer.status === 204) return { ok: true };
  const body = answer.body as { code?: unknown; message?: unknown } | null;
  if (answer.status === 400 && body?.code === "PASSWORD_POLICY" && Array.isArray(body.message)) {
    return { ok: false, failure: "password", messages: body.message.filter((m): m is string => typeof m === "string") };
  }
  return { ok: false, failure: failureOf(answer.status), messages: [] };
}

/**
 * The account context of the session, with the remembered unit checked by
 * the ERP; null when signed out, expired, no longer allowed or ERP
 * unavailable.
 */
export async function currentAccount(
  sessionToken: string | undefined,
  unitId: string | undefined,
): Promise<ShopAccount | null> {
  if (!sessionToken) return null;
  const answer = await callShopApi("/shop/v1/account", { sessionToken, unitId });
  // 401 is a normal signed-out answer; 0 was already logged
  if (![0, 200, 401].includes(answer.status)) console.error(`Shop: ERP shop API answered HTTP ${answer.status}`);
  return answer.status === 200 ? (answer.body as ShopAccount) : null;
}

export async function logout(sessionToken: string | undefined): Promise<void> {
  if (!sessionToken) return;
  await callShopApi("/shop/v1/auth/logout", { method: "POST", sessionToken });
}
