import "server-only";
import { cookies, headers } from "next/headers";
import { currentSession, type ShopSession } from "./erp-shop-api";
import { sessionTokenFrom } from "./request-security";

/**
 * The signed-in session of this request, checked by the ERP on every call
 * (expiry, sign-out, disabled user, inactive account). null when signed out.
 */
export async function signedInSession(): Promise<ShopSession | null> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return currentSession(sessionTokenFrom(cookieStore, headerStore.get("host")));
}
