"use client";

import { useSyncExternalStore } from "react";
import { todayIsoDate } from "./dates";

const noSubscription = () => () => {};

/**
 * Today as YYYY-MM-DD in the browser, or null while the page is rendered on
 * the server. The current time is only read in the browser, so the server
 * output never depends on the server's clock or time zone.
 */
export function useToday(): string | null {
  return useSyncExternalStore(noSubscription, todayIsoDate, () => null);
}
