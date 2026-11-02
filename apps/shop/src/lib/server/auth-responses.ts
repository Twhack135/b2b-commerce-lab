import "server-only";
import { NextResponse } from "next/server";
import { LOCAL_SESSION_COOKIE, SECURE_SESSION_COOKIE } from "./request-security";

// Answers of the shop's sign-in route handlers: never cached, and without
// any detail about why a request was refused.

const NO_STORE = { "Cache-Control": "no-store" };

/** Not from a page of this shop (CSRF protection) */
export function forbidden() {
  return NextResponse.json({ statusCode: 403, message: "Request not allowed." }, { status: 403, headers: NO_STORE });
}

export function unsupportedMediaType() {
  return NextResponse.json({ statusCode: 415, message: "Unsupported content type." }, { status: 415, headers: NO_STORE });
}

/** 303: the browser follows with GET, so a reload never repeats the POST */
export function redirectTo(origin: URL, path: string) {
  const response = NextResponse.redirect(new URL(path, origin), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Removes both possible session cookies (same attributes as when set) */
export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(SECURE_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 0 });
  response.cookies.set(LOCAL_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
