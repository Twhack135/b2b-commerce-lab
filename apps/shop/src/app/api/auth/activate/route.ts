import type { NextRequest } from "next/server";
import { forbidden, json, unsupportedMediaType } from "@/lib/server/auth-responses";
import { activate } from "@/lib/server/erp-shop-api";
import { clientAddress, sameOrigin, trustedProxyHops } from "@/lib/server/request-security";

/**
 * Sets the first password with an activation link (JSON, from the
 * activation page). Answers: activated, password (rules not met, with the
 * reasons), invalid (link unknown, used or expired), locked, unavailable.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return forbidden();
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return unsupportedMediaType();
  }
  const body: unknown = await request.json().catch(() => null);
  const { token, password } = (body ?? {}) as { token?: unknown; password?: unknown };
  if (typeof token !== "string" || typeof password !== "string" || token.length > 100 || password.length > 1024) {
    return json({ status: "invalid" }, 400);
  }

  const result = await activate({ token, password, clientAddress: clientAddress(request.headers, trustedProxyHops(process.env)) });
  if (result.ok) return json({ status: "activated" });
  if (result.failure === "password") return json({ status: "password", messages: result.messages }, 400);
  if (result.failure === "invalid") return json({ status: "invalid" }, 400);
  if (result.failure === "locked") return json({ status: "locked" }, 429);
  return json({ status: "unavailable" }, 503);
}
