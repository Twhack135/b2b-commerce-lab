/**
 * Small helper for calling the ERP API from the browser.
 * All requests go through our own Next.js proxy at /api/erp.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];
  /** The parsed error body, e.g. the pricing analysis of NO_PRICE_FOUND */
  readonly data: unknown;

  constructor(status: number, messages: string[], data: unknown = null) {
    super(messages.join(" "));
    this.status = status;
    this.messages = messages;
    this.data = data;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT";
  body?: unknown;
  /** Give up waiting after this time (the server may still finish the request) */
  timeoutMs?: number;
};

/** Marks an ApiError of status 0 whose request ran out of time */
export const TIMEOUT = "TIMEOUT";

export async function erpFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  return (await erpRequest<T>(path, options)).data;
}

/** Like erpFetch, but also returns the HTTP status of a successful answer */
export async function erpRequest<T>(
  path: string,
  { method = "GET", body, timeoutMs }: RequestOptions = {},
): Promise<{ status: number; data: T }> {
  let response: Response;
  try {
    response = await fetch(`/api/erp${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(
        0,
        ["The ERP API did not answer in time. The request may still have been processed."],
        { code: TIMEOUT },
      );
    }
    throw new ApiError(0, [
      "Network error. Please check your connection and try again.",
    ]);
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, readMessages(response.status, data), data);
  }
  return { status: response.status, data: data as T };
}

/** NestJS sends { message: string } or { message: string[] } on errors */
function readMessages(status: number, data: unknown): string[] {
  const message =
    data !== null && typeof data === "object" && "message" in data
      ? data.message
      : undefined;

  if (Array.isArray(message)) {
    return message.filter((item): item is string => typeof item === "string");
  }
  if (typeof message === "string") {
    return [message];
  }
  return [`The request failed (HTTP ${status}). Please try again.`];
}

/** A single readable sentence for any error thrown by erpFetch */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
