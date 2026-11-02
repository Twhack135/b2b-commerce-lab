import type { NextRequest } from "next/server";
import { clearUnitCookies, forbidden, redirectTo, unsupportedMediaType } from "@/lib/server/auth-responses";
import { currentAccount } from "@/lib/server/erp-shop-api";
import { isUnitIdFormat, sameOrigin, sessionTokenFrom, unitCookie } from "@/lib/server/request-security";

/**
 * Choosing the unit to work with (POST form, also without JavaScript).
 * The ERP decides: only a unit it authorizes for this session is
 * remembered. The cookie is a preference that the ERP checks again on
 * every request; it never grants access by itself (docs/adr/0007).
 */
export async function POST(request: NextRequest) {
  const origin = sameOrigin(request.headers);
  const cookie = origin && unitCookie(origin);
  if (!origin || !cookie) return forbidden();
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return unsupportedMediaType();
  }
  const unitId = (await request.formData()).get("unitId");
  if (!isUnitIdFormat(unitId)) return redirectTo(origin, "/account?unit=unavailable");

  const account = await currentAccount(sessionTokenFrom(request.cookies, request.headers.get("host")), unitId);
  if (!account) return redirectTo(origin, "/login");
  if (account.selectedUnit?.unitId !== unitId) {
    const response = redirectTo(origin, "/account?unit=unavailable");
    clearUnitCookies(response);
    return response;
  }
  const response = redirectTo(origin, "/account?unit=selected");
  response.cookies.set(cookie.name, unitId, { ...cookie.options, expires: new Date(account.expiresAt) });
  return response;
}
