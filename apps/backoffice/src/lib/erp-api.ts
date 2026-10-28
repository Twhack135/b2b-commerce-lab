/**
 * Small helper for calling the ERP API from the browser.
 * All requests go through our own Next.js proxy at /api/erp.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];

  constructor(status: number, messages: string[]) {
    super(messages.join(" "));
    this.status = status;
    this.messages = messages;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
};

export async function erpFetch<T>(
  path: string,
  { method = "GET", body }: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/erp${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, [
      "Network error. Please check your connection and try again.",
    ]);
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, readMessages(response.status, data));
  }
  return data as T;
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
