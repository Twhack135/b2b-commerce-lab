import type { NextRequest } from "next/server";
import { clearSessionCookies, redirectTo, refusedForm } from "@/lib/server/auth-responses";
import { logout } from "@/lib/server/erp-shop-api";
import { sameOrigin, sessionTokenFrom } from "@/lib/server/request-security";

/**
 * Sign-out (POST from the shop only): ends the session in the ERP, so the
 * token cannot be used again, and removes the cookie.
 */
export async function POST(request: NextRequest) {
  const origin = sameOrigin(request.headers);
  // Refused: the session stays as it is
  if (!origin) return refusedForm("/account");
  await logout(sessionTokenFrom(request.cookies, request.headers.get("host")));
  const response = redirectTo(origin, "/login?signedOut=1");
  clearSessionCookies(response);
  return response;
}
