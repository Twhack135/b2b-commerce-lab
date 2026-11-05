import { connection } from "next/server";
import { isLocalHost } from "../../../lib/request-guard.ts";
import { shopLinks } from "../../../lib/shop-links.ts";

/**
 * The configured shop addresses for the "Open Shop" menu, read from the
 * environment of the Backoffice server at request time (not at build
 * time), so each installation shows its own shops. Local only, like the
 * ERP proxy; the answer holds no secret and is not cached.
 */
export async function GET(request: Request) {
  await connection();
  if (!isLocalHost(request.headers.get("host"))) {
    return Response.json({ statusCode: 403, message: "Request not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(shopLinks(process.env), { headers: { "Cache-Control": "no-store" } });
}
