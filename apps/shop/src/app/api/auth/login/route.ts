import type { NextRequest } from "next/server";
import { forbidden, redirectTo, unsupportedMediaType } from "@/lib/server/auth-responses";
import { login } from "@/lib/server/erp-shop-api";
import {
  clientAddress,
  sameOrigin,
  sessionCookie,
  sessionTokenFrom,
  trustedProxyHops,
} from "@/lib/server/request-security";

/**
 * Sign-in form (POST, also without JavaScript). On success the session
 * token goes into an HttpOnly cookie and the browser is sent to the account
 * page; on failure back to the form with a generic reason. The previous
 * session of this browser is ended (no session fixation).
 */
export async function POST(request: NextRequest) {
  const origin = sameOrigin(request.headers);
  const cookie = origin && sessionCookie(origin);
  if (!origin || !cookie) return forbidden();
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return unsupportedMediaType();
  }
  const form = await request.formData();
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string" || email.length > 320 || password.length > 1024) {
    return redirectTo(origin, "/login?error=invalid");
  }

  const result = await login({
    email,
    password,
    clientAddress: clientAddress(request.headers, trustedProxyHops(process.env)),
    previousSessionToken: sessionTokenFrom(request.cookies, request.headers.get("host")),
  });
  if (!result.ok) return redirectTo(origin, `/login?error=${result.failure}`);

  const response = redirectTo(origin, "/account");
  response.cookies.set(cookie.name, result.sessionToken, { ...cookie.options, expires: result.expiresAt });
  return response;
}
