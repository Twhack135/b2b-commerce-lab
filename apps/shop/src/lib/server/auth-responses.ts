import "server-only";
import { NextResponse } from "next/server";
import { LOCAL_SESSION_COOKIE, LOCAL_UNIT_COOKIE, SECURE_SESSION_COOKIE, SECURE_UNIT_COOKIE } from "./request-security";

// Answers of the shop's sign-in route handlers: never cached, and without
// any detail about why a request was refused.

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A browser form (sign-in, sign-out, unit choice) that did not come from a
 * page of this shop (CSRF protection): nothing was done. A browser would
 * show a JSON answer as a raw technical page, so the form is sent back to
 * a page of the shop instead. The address is relative: the Host of a
 * refused request is not trusted.
 */
export function refusedForm(path: "/login?error=request" | "/account") {
  return new NextResponse(null, { status: 303, headers: { Location: path, ...NO_STORE } });
}

/** Not from a page of this shop (CSRF protection); for script requests (JSON) */
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

/**
 * Removes both possible session cookies and the remembered unit (same
 * attributes as when set): the next person in this browser starts fresh
 */
export function clearSessionCookies(response: NextResponse) {
  clearCookies(response, SECURE_SESSION_COOKIE, LOCAL_SESSION_COOKIE);
  clearUnitCookies(response);
}

/** Removes only the remembered unit, e.g. when it is no longer authorized */
export function clearUnitCookies(response: NextResponse) {
  clearCookies(response, SECURE_UNIT_COOKIE, LOCAL_UNIT_COOKIE);
}

function clearCookies(response: NextResponse, secureName: string, localName: string) {
  response.cookies.set(secureName, "", { httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 0 });
  response.cookies.set(localName, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
