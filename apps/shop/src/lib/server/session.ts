import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { currentAccount, type ShopAccount } from "./erp-shop-api";
import { selectedUnitFrom, sessionTokenFrom } from "./request-security";

/**
 * The signed-in account context of this request, checked by the ERP on
 * every call (expiry, sign-out, disabled user, inactive account, unit
 * assignments). null when signed out. Asked once per request, however many
 * components need it (header and page).
 */
export const signedInSession = cache(async (): Promise<ShopAccount | null> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const host = headerStore.get("host");
  return currentAccount(sessionTokenFrom(cookieStore, host), selectedUnitFrom(cookieStore, host));
});
