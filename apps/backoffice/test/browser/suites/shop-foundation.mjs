// The shop foundation (Sprint 11): shop frame, security headers, the
// technical health check and the boundary between shop and ERP. The shop
// has no customer functions yet, so this suite reads no business data and
// creates nothing.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPortInUse } from "../lib/safety.mjs";

const SHOP_HEADER = "X-Shop-Service-Key";

export default async function shopFoundationSuite({ page, urls, shopServiceKey, startErpApi, runDir, check, section }) {
  const SHOP = urls.shop;
  const evaluate = (expression) => page.evaluate(expression);
  page.extraHelpers = "";
  page.diagnostics = "";
  const errorsBefore = page.pageErrors.length;

  // ------------------------------------------------------------- shell
  section("Shop shell");
  await page.viewport(1440, 900);
  page.requests = [];
  await page.goto(`${SHOP}/`, "!!document.querySelector('[data-shop-shell]')");
  check("Start page in the shop frame", (await evaluate("document.querySelector('h1').textContent")) === "Ordering for business customers" && (await evaluate("document.title")) === "B2B Shop", await evaluate("document.title"));
  check("Navigation: Catalog, Quick Order and My Orders marked 'Soon' and not links; Account links to the account page (Sprint 12C)", (await evaluate("JSON.stringify([...document.querySelectorAll('[data-nav-item]')].map(e => e.dataset.navItem))")) === JSON.stringify(["Catalog", "Quick Order", "My Orders", "Account"]) && (await evaluate("[...document.querySelectorAll('[data-nav-item]')].slice(0, 3).every(e => e.tagName === 'SPAN' && e.getAttribute('aria-disabled') === 'true' && e.textContent.includes('Soon')) && [...document.querySelectorAll('nav a')].map(a => a.getAttribute('href')).join() === '/account'")));
  check("Development preview is stated", (await evaluate("$text('[data-preview-notice]')")).includes("Catalog, prices and ordering are not available yet") && (await evaluate("!!document.querySelector('[data-preview-badge]')")));
  // Since Sprint 12B the header offers the real sign-in; there is still no self-registration
  check("Signed out: 'Sign in' leads to the sign-in page, no form or registration on the start page", (await evaluate("document.querySelector('[data-sign-in-link]')?.getAttribute('href')")) === "/login" && (await evaluate("document.querySelectorAll('main form, main input').length === 0 && ![...document.querySelectorAll('a, button')].some(e => /register|sign.?up|create account/i.test(e.textContent))")));
  check("No customer, price or order data", !(await evaluate("/CUST-|UNIT-|EUR|PLN|JPY|\\d{10}/.test(document.body.innerText)")));
  check("The browser only talks to the shop, never to the ERP API", page.requests.length > 0 && page.requests.every((r) => r.url.startsWith(`${SHOP}/`) || r.url.startsWith("data:")), JSON.stringify(page.requests.map((r) => r.url).filter((u) => !u.startsWith(SHOP))));
  await page.screenshot("shop.png");
  const scripts = await evaluate("[...document.scripts].map(s => s.src).filter(Boolean)");

  await page.viewport(390, 844, true);
  await page.goto(`${SHOP}/`, "!!document.querySelector('[data-shop-shell]')");
  check("Mobile 390px: no horizontal scrolling, navigation visible", !(await evaluate("$overflow()")) && (await evaluate("[...document.querySelectorAll('[data-nav-item]')].every($vis)")));
  await page.screenshot("shop-mobile.png");
  await page.viewport(1440, 900);

  // ------------------------------------------------------------- headers
  section("Security headers");
  const home = await fetch(`${SHOP}/`);
  const csp = home.headers.get("content-security-policy") ?? "";
  check("CSP: no framing, no foreign scripts or connections, no eval in production", ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "form-action 'self'"].every((d) => csp.split("; ").includes(d)) && !csp.includes("unsafe-eval"), csp);
  check("nosniff, DENY framing, referrer policy, no X-Powered-By", home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("x-frame-options") === "DENY" && home.headers.get("referrer-policy") === "strict-origin-when-cross-origin" && home.headers.get("x-powered-by") === null);

  // ------------------------------------------------------------- health
  section("Health checks and the ERP shop API boundary");
  const health = await fetch(`${SHOP}/api/health`);
  const healthBody = await health.text();
  check("Shop health: ok, ERP shop API reachable, nothing else", health.status === 200 && healthBody === JSON.stringify({ status: "ok", erp: "ok" }) && health.headers.get("cache-control") === "no-store" && (health.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), `${health.status} ${healthBody}`);
  check("Shop health accepts GET only", (await fetch(`${SHOP}/api/health`, { method: "POST" })).status === 405);

  const erpHealth = (headers) => fetch(`${urls.api}/shop/v1/health`, { headers }).then(async (r) => `${r.status} ${await r.text()}`);
  const unauthorized = `401 ${JSON.stringify({ message: "Service authentication required.", error: "Unauthorized", statusCode: 401 })}`;
  check("ERP shop API with the service key: status ok only", (await erpHealth({ [SHOP_HEADER]: shopServiceKey })) === `200 ${JSON.stringify({ status: "ok" })}`);
  const rejected = [
    await erpHealth({}),
    await erpHealth({ [SHOP_HEADER]: "x".repeat(64) }),
    // The service key is no user credential: Authorization is not read
    await erpHealth({ Authorization: `Bearer ${shopServiceKey}` }),
  ];
  check("ERP shop API without, with a wrong key or the key as bearer token: 401, no details", rejected.every((r) => r === unauthorized), JSON.stringify(rejected));
  const notThere = await Promise.all(
    ["/api/erp/materials", "/api/erp/sales-orders", "/shop/v1/health", "/materials"].map((path) => fetch(`${SHOP}${path}`).then((r) => r.status)),
  );
  check("The shop forwards nothing to the ERP admin API (no proxy)", notThere.every((status) => status === 404), JSON.stringify(notThere));

  // ------------------------------------------------------------- secrets
  section("The service key stays on the server");
  const delivered = [await (await fetch(`${SHOP}/`)).text(), healthBody];
  for (const src of scripts) delivered.push(await (await fetch(src)).text());
  check(`The key is in no page, script (${scripts.length}) or answer of the shop`, scripts.length > 0 && delivered.every((text) => !text.includes(shopServiceKey)));
  check("The browser never sees the key header", !(await evaluate("document.documentElement.outerHTML.includes('X-Shop-Service-Key')")));

  // ------------------------------------------------------------- binding
  section("The ERP API refuses to listen outside this computer");
  const exposed = startErpApi("ERP API on all interfaces (must refuse)", { PORT: String(urls.unreachableApiPort), HOST: "0.0.0.0" });
  const exitCode = await Promise.race([exposed.exited, new Promise((resolve) => setTimeout(() => resolve("still running"), 30_000))]);
  const log = readFileSync(exposed.logFile, "utf8");
  check("HOST=0.0.0.0: the ERP API stops before it listens", exitCode !== 0 && exitCode !== "still running" && log.includes("Refusing to listen on \"0.0.0.0\"") && !(await isPortInUse(urls.unreachableApiPort)), `exit ${exitCode}`);

  // Every service log of this run: ERP API, Backoffice, Shop, browser
  const logs = readdirSync(runDir).filter((name) => name.endsWith(".log"));
  const leaking = logs.filter((name) => readFileSync(join(runDir, name), "utf8").includes(shopServiceKey));
  check(`The key is in no server log (${logs.length} logs)`, logs.length >= 5 && leaking.length === 0, leaking.join(", "));

  check("No uncaught page errors in the shop", page.pageErrors.length === errorsBefore, page.pageErrors.slice(errorsBefore).join(" | "));
}
