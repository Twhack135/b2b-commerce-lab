// Shop user administration and unit authorization (Sprint 12C) in a real
// browser: the Backoffice creates users, assigns units, issues activation
// links, ends sessions and disables users; the shop shows only authorized
// units and applies every change with the next request. All users exist
// only in the disposable test database; tokens and passwords are never
// printed. At the end the shop user data of this suite is removed again,
// so the next suite starts without shop users.

import http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ANNA = { email: "anna.weber@mueller.example", name: "Anna Weber", password: "Radiators hum softly in Stuttgart 2026" };
const BEN = { email: "ben.braun@mueller.example", name: "Ben Braun", password: "Munich warehouse keeps every valve 99" };
const PIOTR = { email: "piotr.nowak@warszawa.example", name: "Piotr Nowak", password: "Warszawa heating season starts early 7" };

export default async function shopAdminSuite({ page, api, urls, sql, shopServiceKey, runDir, check, section }) {
  const BO = urls.backoffice;
  const SHOP = urls.shop;
  const annaId = () => sql(`SELECT id FROM shop_users WHERE email = '${ANNA.email}'`);
  const evaluate = (expression) => page.evaluate(expression);
  page.extraHelpers = `
    window.$confirm = (label) => [...document.querySelector('[aria-labelledby=confirm-dialog-title]').querySelectorAll('button')].find(b => b.textContent.trim() === label).click();
    window.$action = (name) => document.querySelector('[data-action="' + name + '"]').click();
  `;
  page.diagnostics = "({ notice: document.querySelector('[data-notice],[data-detail-notice]')?.innerText ?? null })";
  const errorsBefore = page.pageErrors.length;
  const secrets = [ANNA.password, BEN.password, PIOTR.password];

  /** Waits for a page after a navigation (streamed content: visibility) */
  async function arrived(condition, label) {
    await page.waitFor(`document.readyState === 'complete' && (${condition})`, label, 15_000);
    await page.installHelpers();
  }
  async function signIn(user) {
    await page.goto(`${SHOP}/login`, "$vis(document.querySelector('[data-login-form]'))");
    await evaluate(`$setEl(document.getElementById('email'), ${JSON.stringify(user.email)}); $setEl(document.getElementById('password'), ${JSON.stringify(user.password)}); document.querySelector('[data-login-form]').requestSubmit()`);
  }
  const shopAccount = async () => {
    await page.goto(`${SHOP}/account`, "location.pathname === '/login' || !!document.querySelector('[data-display-name]')?.offsetParent");
    return evaluate("location.pathname");
  };
  const unitsShown = () => evaluate("JSON.stringify([...document.querySelectorAll('[data-unit]')].map(e => e.dataset.unit + (e.dataset.selected ? '*' : '') + (e.dataset.canOrder === 'false' ? ':view' : '')))");
  const cookieNamed = async (name) => (await page.send("Network.getCookies", { urls: [`${SHOP}/`] })).cookies.find((c) => c.name === name);
  const openUser = async (email) => {
    await page.goto(`${BO}/shop-users`, `!!document.querySelector('[data-shop-user="${email}"]')`);
    await evaluate(`document.querySelector('[data-shop-user="${email}"]').click()`);
    await page.waitFor(`!!document.querySelector('[data-shop-user-detail="${email}"]')`, `detail of ${email}`);
  };
  const detailNotice = (text) => page.waitFor(`document.querySelector('[data-detail-notice]')?.innerText.includes(${JSON.stringify(text)})`, text);
  /** A request to a local server with any Host header (fetch cannot set it) */
  const rawRequest = (url, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(url, { method, headers }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end(body);
    });
  const activate = (link, password) =>
    fetch(`${urls.api}/shop/v1/auth/activation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shop-Service-Key": shopServiceKey },
      body: JSON.stringify({ token: new URL(link).hash.slice("#token=".length), password }),
    }).then((r) => r.status);
  /** Signs in through the shop's own form route without a browser; returns the cookie */
  const shopLogin = async (user) => {
    const response = await fetch(`${SHOP}/api/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: SHOP, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: user.email, password: user.password }).toString(),
    });
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("shop_session=") && !c.startsWith("shop_session=;"));
    if (cookie) secrets.push(cookie.split(";")[0].slice("shop_session=".length));
    return cookie?.split(";")[0];
  };
  /** The ERP's own answer for the session in a cookie (200 or 401) */
  const erpAccount = (cookie) =>
    fetch(`${urls.api}/shop/v1/account`, { headers: { "X-Shop-Service-Key": shopServiceKey, "X-Shop-Session": cookie.slice("shop_session=".length) } }).then((r) => r.status);
  const shopPage = (cookie) => fetch(`${SHOP}/account`, { headers: { Cookie: cookie } }).then(async (r) => ({ status: r.status, text: await r.text() }));

  // ------------------------------------------------------------- Backoffice
  section("Backoffice: shop users, local administration");
  await page.viewport(1440, 900);
  await page.goto(`${BO}/shop-users`, "!!document.querySelector('[data-local-only-notice]') && document.body.innerText.includes('No shop users yet')");
  check("The page states that the Backoffice has no administrator sign-in and is local only", (await evaluate("$text('[data-local-only-notice]')")).includes("must never be made reachable from other computers"));
  check("Navigation has 'Shop Users'", (await evaluate("[...document.querySelectorAll('nav a')].some(a => a.getAttribute('href') === '/shop-users' && a.getAttribute('aria-current') === 'page')")));

  // Sprint 12C acceptance (UX-001): "Open Shop" with the configured shops only
  await evaluate("[...document.querySelectorAll('[data-shop-links] button')].find(b => b.textContent.includes('Open Shop')).click()");
  await page.waitFor("!!document.querySelector('[data-shop-link=test]')", "shop links loaded");
  const testShop = await evaluate("(() => { const a = document.querySelector('a[data-shop-link=test]'); return a && { href: a.getAttribute('href'), target: a.target, rel: a.rel }; })()");
  check("'Open Shop': the configured test shop opens in a new tab without opener or referrer", testShop?.href === SHOP && testShop.target === "_blank" && testShop.rel.split(" ").includes("noopener") && testShop.rel.split(" ").includes("noreferrer"), JSON.stringify(testShop));
  check("'Open Shop': an unconfigured environment is shown disabled, not as a link", (await evaluate("!document.querySelector('a[data-shop-link=production]') && document.querySelector('[data-shop-link=production]')?.getAttribute('aria-disabled') === 'true' && document.querySelector('[data-shop-link=production]').textContent.includes('Not configured')")));
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await page.waitFor("!document.querySelector('[data-shop-link]')", "menu closed");

  await evaluate("$btn('New Shop User').click()");
  await page.waitFor("!!document.querySelector('[data-shop-user-create]')", "create form");
  await evaluate("document.querySelector('[data-shop-user-create]').requestSubmit()");
  await page.waitFor("document.querySelectorAll('[data-shop-user-create] [role=alert]').length >= 3", "create form errors");
  check("Create form: account, e-mail address and name are required", (await evaluate("document.querySelectorAll('[data-shop-user-create] [role=alert]').length")) === 3 && sql("SELECT count(*) FROM shop_users") === "0");
  check("No password field: the person sets the password with a link", (await evaluate("document.querySelectorAll('[data-shop-user-create] input[type=password]').length")) === 0);
  await page.select("shop-user-account", "CUST-1000", "!!document.querySelector('[data-unit-option]')");
  const offered = await evaluate("JSON.stringify([...document.querySelectorAll('[data-unit-option]')].map(e => e.dataset.unitOption))");
  check("Only the account's own active units are offered", offered === JSON.stringify(["UNIT-MUENCHEN", "UNIT-STUTTGART"]), offered);
  await evaluate(`$setEl(document.getElementById('shop-user-email'), ' ${ANNA.email.toUpperCase()} '); $setEl(document.getElementById('shop-user-name'), ${JSON.stringify(ANNA.name)})`);
  await evaluate("document.querySelector('[data-unit-option=\"UNIT-STUTTGART\"]').click(); document.querySelector('[data-unit-option=\"UNIT-MUENCHEN\"]').click()");
  await evaluate("document.querySelector('[data-shop-user-create]').requestSubmit()");
  await page.waitFor(`!!document.querySelector('[data-shop-user-detail="${ANNA.email}"]')`, "Anna created");
  check("Created: the detail opens with the normalized address, both units and 'Not invited'", sql(`SELECT count(*) FROM shop_users WHERE email = '${ANNA.email}'`) === "1" && sql("SELECT count(*) FROM shop_user_units") === "2" && (await evaluate("document.querySelector('[data-activation]').dataset.activation")) === "NOT_INVITED" && (await evaluate("document.querySelectorAll('[data-assigned-unit]').length")) === 2);
  await page.screenshot("bo-shop-user-detail.png");

  // The other test users through the admin API (same rules)
  const ben = (await api("POST", "/shop-users", { accountCustomerNumber: "CUST-1000", email: BEN.email, displayName: BEN.name, unitIds: ["UNIT-MUENCHEN"] })).body;
  const piotr = (await api("POST", "/shop-users", { accountCustomerNumber: "PL-1000", email: PIOTR.email, displayName: PIOTR.name, unitIds: ["UNIT-WARSZAWA"] })).body;
  const crossAccount = await evaluate(`fetch('/api/erp/shop-users/${piotr.id}/units/UNIT-STUTTGART', { method: 'PUT' }).then(r => r.status)`);
  check("A unit of another account is refused (422), also through the Backoffice", crossAccount === 422 && sql(`SELECT count(*) FROM shop_user_units WHERE user_id = '${piotr.id}'`) === "1");

  section("Activation link: shown once, stored only as a hash");
  await openUser(ANNA.email);
  await evaluate("$action('activation')");
  await page.waitFor("!!document.querySelector('[aria-labelledby=confirm-dialog-title]')", "confirmation");
  await evaluate("$confirm('Create link')");
  await page.waitFor("!!document.querySelector('[data-activation-link]')?.value", "link shown");
  const annaLink = await evaluate("document.querySelector('[data-activation-link]').value");
  const annaToken = new URL(annaLink).hash.slice("#token=".length);
  secrets.push(annaToken);
  check("The link points to the shop with the token in its fragment", annaLink.startsWith(`${SHOP}/activate#token=`) && /^[A-Za-z0-9_-]{43}$/.test(annaToken));
  check("The database stores only the hash of the token", sql(`SELECT count(*) FROM shop_activation_tokens WHERE token_hash = encode(sha256('${annaToken}'), 'hex')`) === "1" && sql(`SELECT count(*) FROM shop_activation_tokens WHERE token_hash = '${annaToken}'`) === "0");
  check("The link is not in the address bar, cookies or browser storage", !(await evaluate(`location.href.includes(${JSON.stringify(annaToken)}) || document.cookie.includes(${JSON.stringify(annaToken)}) || JSON.stringify({ ...localStorage, ...sessionStorage }).includes(${JSON.stringify(annaToken)})`)));
  await page.screenshot("bo-activation-link.png");
  await evaluate("document.querySelector('[data-activation-link-done]').click()");
  await page.waitFor("!document.querySelector('[data-activation-link]') && document.querySelector('[data-activation]')?.dataset.activation === 'LINK_OPEN'", "link closed");
  check("After closing, the link is gone from the page; the state says 'Link sent'", !(await evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(annaToken)})`)));
  const answer = await evaluate(`fetch('/api/erp/shop-users/${ben.id}/activation-link', { method: 'POST' }).then(async r => ({ status: r.status, cache: r.headers.get('cache-control'), link: (await r.json()).activationLink }))`);
  secrets.push(new URL(answer.link).hash.slice(7));
  check("The link answer is never cached (no-store)", answer.status === 201 && answer.cache === "no-store");
  const piotrLink = (await api("POST", `/shop-users/${piotr.id}/activation-link`)).body.activationLink;
  secrets.push(new URL(piotrLink).hash.slice(7));

  // ------------------------------------------------------------- Shop
  section("Shop: activation, sign-in and unit selection");
  await page.goto(`${SHOP}/`, "!!document.querySelector('[data-shop-shell]')");
  await page.goto(annaLink, "!!document.querySelector('[data-activation-form]')?.offsetParent");
  await evaluate(`$setEl(document.getElementById('new-password'), ${JSON.stringify(ANNA.password)}); $setEl(document.getElementById('confirm-password'), ${JSON.stringify(ANNA.password)})`);
  await page.waitFor("!document.querySelector('[data-activation-form] button[type=submit]').disabled", "submit enabled");
  await evaluate("document.querySelector('[data-activation-form] button[type=submit]').click()");
  await page.waitFor("!!document.querySelector('[data-activation=done]')?.offsetParent", "activated");
  check("The link from the Backoffice activates the user", sql(`SELECT count(*) FROM shop_user_credentials c JOIN shop_users u ON u.id = c.user_id WHERE u.email = '${ANNA.email}'`) === "1");
  check("The link works only once", (await activate(annaLink, ANNA.password)) === 400);
  check("Ben and Piotr activate with their links", (await activate(answer.link, BEN.password)) === 204 && (await activate(piotrLink, PIOTR.password)) === 204);

  await signIn(ANNA);
  await arrived("location.pathname === '/account' && !!document.querySelector('[data-units]')?.offsetParent", "Anna signed in");
  check("Anna sees exactly her two units; with two units none is preselected", (await unitsShown()) === JSON.stringify(["UNIT-MUENCHEN", "UNIT-STUTTGART"]) && (await evaluate("$text('[data-working-for]')")).includes("No unit selected"));
  await evaluate("document.querySelector('[data-unit-select=\"UNIT-MUENCHEN\"] button').click()");
  await arrived("location.search === '?unit=selected' && !!document.querySelector('[data-unit][data-selected]')?.offsetParent", "unit selected");
  const unitCookie = await cookieNamed("shop_unit");
  check("Selected: marked on the page and in the header", (await unitsShown()) === JSON.stringify(["UNIT-MUENCHEN*", "UNIT-STUTTGART"]) && (await evaluate("$text('[data-header-unit]')")) === "Müller – München");
  check("The selection cookie is HttpOnly, SameSite=Lax and holds only the unit ID", unitCookie?.value === "UNIT-MUENCHEN" && unitCookie.httpOnly && unitCookie.sameSite === "Lax" && !(await evaluate("document.cookie.includes('shop_unit')")));
  const annaCookie = await cookieNamed("shop_session");
  secrets.push(annaCookie.value);

  section("The selected unit is checked by the ERP on every request");
  await page.send("Network.setCookie", { name: "shop_unit", value: "UNIT-WARSZAWA", url: `${SHOP}/`, httpOnly: true, sameSite: "Lax" });
  await shopAccount();
  check("A forged cookie with a unit of another account selects nothing and shows nothing of it", (await unitsShown()) === JSON.stringify(["UNIT-MUENCHEN", "UNIT-STUTTGART"]) && !(await evaluate("document.body.innerText.includes('Warszawa')")) && (await evaluate("$text('[data-notice=info]')")).includes("no longer available"));
  const selectForeign = await evaluate("fetch('/api/units/select', { method: 'POST', body: new URLSearchParams({ unitId: 'UNIT-WARSZAWA' }) }).then(r => new URL(r.url).search)");
  check("Choosing a unit of another account is refused", selectForeign === "?unit=unavailable" && (await cookieNamed("shop_unit")) === undefined);
  const csrf = await fetch(`${SHOP}/api/units/select`, { method: "POST", redirect: "manual", headers: { Origin: "http://evil.example", "Content-Type": "application/x-www-form-urlencoded", Cookie: `shop_session=${annaCookie.value}` }, body: "unitId=UNIT-STUTTGART" }).then((r) => ({ status: r.status, location: r.headers.get("location"), cookies: r.headers.getSetCookie().length }));
  check("Choosing a unit from another site is refused (CSRF): back to the account page, nothing remembered", csrf.status === 303 && csrf.location === "/account" && csrf.cookies === 0, JSON.stringify(csrf));

  section("Cross-account isolation");
  const piotrCookie = await shopLogin(PIOTR);
  const piotrPage = await shopPage(`${piotrCookie}; shop_unit=UNIT-STUTTGART`);
  check("Piotr (PL-1000) sees only his unit; a forged Müller unit is ignored", piotrPage.status === 200 && piotrPage.text.includes("UNIT-WARSZAWA") && !/UNIT-STUTTGART|UNIT-MUENCHEN|Müller/.test(piotrPage.text.replace(/data-unit-select="[^"]*"/g, "")) && piotrPage.text.includes("Warszawa"));
  const benCookie = await shopLogin(BEN);
  const benPage = await shopPage(benCookie);
  check("Ben has one unit: it is selected without choosing", benPage.text.includes('data-unit="UNIT-MUENCHEN" data-selected="true"') && !benPage.text.includes('data-unit="UNIT-STUTTGART"'));

  // ------------------------------------------------------------- changes
  section("Permission changes take effect with the next request");
  await openUser(ANNA.email);
  await evaluate("[...document.querySelectorAll('[data-assigned-unit=\"UNIT-MUENCHEN\"] button')].find(b => b.textContent.startsWith('Remove')).click()");
  await page.waitFor("!!document.querySelector('[aria-labelledby=confirm-dialog-title]')", "remove confirmation");
  await evaluate("$confirm('Remove unit')");
  await detailNotice("UNIT-MUENCHEN was removed");
  await page.send("Network.setCookie", { name: "shop_unit", value: "UNIT-MUENCHEN", url: `${SHOP}/`, httpOnly: true, sameSite: "Lax" });
  await shopAccount();
  check("A unit removed during the session is gone at once; the remaining unit is used", (await unitsShown()) === JSON.stringify(["UNIT-STUTTGART*"]) && (await evaluate("$text('[data-notice=info]')")).includes("no longer available"));
  sql("UPDATE b2b_units SET is_active = false WHERE unit_id = 'UNIT-STUTTGART'");
  await shopAccount();
  check("An inactive unit is view only: marked, with a notice that no orders are possible", (await unitsShown()) === JSON.stringify(["UNIT-STUTTGART*:view"]) && (await evaluate("$text('[data-view-only-notice]')")).includes("no new orders") && (await evaluate("$text('[data-header-unit]')")).includes("view only"));
  await page.screenshot("shop-account-view-only.png");
  await openUser(ANNA.email);
  check("The Backoffice shows the same: 'View only', and the unit cannot be assigned anew", (await evaluate("$text('[data-assigned-unit=\"UNIT-STUTTGART\"]')")).includes("View only"));
  sql("UPDATE b2b_units SET is_active = true WHERE unit_id = 'UNIT-STUTTGART'");
  // Sprint 12C acceptance (BUG-003): inactive units are not assignable (rule
  // unchanged); the selection shows them as disabled with the reason
  sql("UPDATE b2b_units SET is_active = false WHERE unit_id = 'UNIT-MUENCHEN'");
  await openUser(ANNA.email);
  await page.waitFor("!!document.querySelector('[data-inactive-option=\"UNIT-MUENCHEN\"]')", "inactive option");
  check("An inactive unit is listed as a disabled option with the reason", (await evaluate("document.querySelector('[data-inactive-option=\"UNIT-MUENCHEN\"]').disabled")) && (await evaluate("$text('[data-inactive-units-hint]')")).includes("Inactive units cannot be assigned"));
  const inactiveAssign = await evaluate(`fetch('/api/erp/shop-users/${annaId()}/units/UNIT-MUENCHEN', { method: 'PUT' }).then(r => r.status)`);
  check("The ERP still refuses to assign an inactive unit (422)", inactiveAssign === 422);
  sql("UPDATE b2b_units SET is_active = true WHERE unit_id = 'UNIT-MUENCHEN'");

  section("Sessions, disabling and enabling from the Backoffice");
  await openUser(ANNA.email);
  check("Anna's open session is listed, without any token", (await evaluate("document.querySelector('[data-sessions]')?.dataset.sessions")) === "1" && !(await evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(annaCookie.value)})`)));
  await evaluate("$action('revoke-session')");
  await detailNotice("The session has ended");
  check("Ended in the Backoffice: the shop asks Anna to sign in again", (await shopAccount()) === "/login");
  await signIn(ANNA);
  await arrived("location.pathname === '/account'", "Anna signed in again");
  secrets.push((await cookieNamed("shop_session")).value);
  await openUser(ANNA.email);
  await evaluate("$action('disable')");
  await page.waitFor("!!document.querySelector('[aria-labelledby=confirm-dialog-title]')", "disable confirmation");
  await evaluate("$confirm('Disable user')");
  await detailNotice("The user is disabled");
  check("Disabled: shown with 'Disabled', units kept", (await evaluate("document.querySelector('[data-access]').dataset.access")) === "USER_DISABLED" && sql(`SELECT count(*) FROM shop_user_units u JOIN shop_users s ON s.id = u.user_id WHERE s.email = '${ANNA.email}'`) === "1");
  check("Disabled: the open shop session ends at once", (await shopAccount()) === "/login");
  check("Disabled: signing in fails with the generic message", (await shopLogin(ANNA)) === undefined);
  await openUser(ANNA.email);
  await evaluate("$action('enable')");
  await page.waitFor("!!document.querySelector('[aria-labelledby=confirm-dialog-title]')", "enable confirmation");
  await evaluate("$confirm('Enable user')");
  await detailNotice("enabled again");
  check("Enabled again: signing in works with the existing password", (await shopLogin(ANNA)) !== undefined);

  section("Account deactivation and reactivation");
  sql("UPDATE customers SET is_active = false WHERE customer_number = 'CUST-1000'");
  check("Inactive account: Ben's open session ends at once", (await erpAccount(benCookie)) === 401);
  await page.goto(`${BO}/shop-users`, `!!document.querySelector('[data-shop-user="${BEN.email}"]')`);
  check("The Backoffice shows 'Account inactive' for both Müller users, Piotr keeps access", (await evaluate(`$text('[data-shop-user="${BEN.email}"]')`)).includes("Account inactive") && (await evaluate(`$text('[data-shop-user="${ANNA.email}"]')`)).includes("Account inactive") && (await evaluate(`$text('[data-shop-user="${PIOTR.email}"]')`)).includes("Access") && (await erpAccount(piotrCookie)) === 200);
  sql("UPDATE customers SET is_active = true WHERE customer_number = 'CUST-1000'");
  check("Reactivated: the old session stays ended; signing in again works", (await erpAccount(benCookie)) === 401 && (await shopLogin(BEN)) !== undefined);

  // ------------------------------------------------------------- boundary
  section("Local-only boundary of the Backoffice and the ERP admin API");
  const boRebinding = await rawRequest(`${BO}/api/erp/shop-users`, { headers: { Host: "attacker.example:3301" } });
  const erpRebinding = await rawRequest(`${urls.api}/shop-users`, { headers: { Host: "attacker.example:3300" } });
  check("Requests for another host name are refused (DNS rebinding): Backoffice and ERP 403", boRebinding === 403 && erpRebinding === 403, `${boRebinding} ${erpRebinding}`);
  const crossSite = await fetch(`${BO}/api/erp/shop-users/${ben.id}/sessions/revoke-all`, { method: "POST", headers: { Origin: "http://evil.example" } }).then((r) => r.status);
  const noOrigin = await fetch(`${BO}/api/erp/shop-users/${ben.id}/activation-link`, { method: "POST" }).then((r) => r.status);
  const formPost = await evaluate("fetch('/api/erp/shop-users', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }).then(r => r.status)");
  check("Changes from other sites or without Origin are refused (403); only JSON bodies (415)", crossSite === 403 && noOrigin === 403 && formPost === 415, `${crossSite} ${noOrigin} ${formPost}`);
  const headers = await fetch(`${BO}/shop-users`).then((r) => ({ frame: r.headers.get("x-frame-options"), csp: r.headers.get("content-security-policy"), powered: r.headers.get("x-powered-by") }));
  check("Backoffice pages cannot be framed by other sites (clickjacking)", headers.frame === "DENY" && headers.csp?.includes("frame-ancestors 'none'") && headers.powered === null, JSON.stringify(headers));
  const shopRoutes = await Promise.all(["/shop/v1/shop-users", "/shop-users"].map((path) => fetch(`${SHOP}${path}`, { redirect: "manual" }).then((r) => r.status)));
  check("The shop exposes no administration route", shopRoutes.every((status) => status === 404), JSON.stringify(shopRoutes));

  // ------------------------------------------------------------- mobile
  section("Mobile 390px");
  await page.viewport(390, 844, true);
  await page.goto(`${BO}/shop-users`, `!!document.querySelector('[data-shop-user="${ANNA.email}"]')`);
  check("Backoffice shop user list fits 390px", !(await evaluate("$overflow()")));
  await page.screenshot("bo-shop-users-mobile.png");
  await evaluate(`document.querySelector('[data-shop-user="${ANNA.email}"]').click()`);
  await page.waitFor(`!!document.querySelector('[data-shop-user-detail="${ANNA.email}"]')`, "detail on mobile");
  check("Shop user detail fits 390px", !(await evaluate("$overflow()")));
  await page.screenshot("bo-shop-user-detail-mobile.png");
  await signIn(ANNA);
  await arrived("location.pathname === '/account' && !!document.querySelector('[data-units]')?.offsetParent", "Anna on mobile");
  check("Shop account with units fits 390px", !(await evaluate("$overflow()")));
  await page.screenshot("shop-account-units-mobile.png");
  await page.viewport(1440, 900);
  await page.goto(`${BO}/shop-users`, "!!document.querySelector('[data-shop-user-figures]')");
  await page.screenshot("bo-shop-users.png");

  // ------------------------------------------------------------- secrets
  section("Secrets stay out of logs");
  const logs = readdirSync(runDir).filter((name) => name.endsWith(".log"));
  const leaking = logs.filter((name) => {
    const text = readFileSync(join(runDir, name), "utf8");
    return secrets.some((secret) => secret && text.includes(secret));
  });
  check(`No password, activation link or session token in any server log (${logs.length} logs)`, logs.length >= 5 && leaking.length === 0, leaking.join(", "));
  check("No uncaught page errors", page.pageErrors.length === errorsBefore, page.pageErrors.slice(errorsBefore).join(" | "));

  // The next suite starts without shop users, sessions or cookies
  await page.send("Network.deleteCookies", { name: "shop_session", url: `${SHOP}/` });
  await page.send("Network.deleteCookies", { name: "shop_unit", url: `${SHOP}/` });
  sql("DELETE FROM shop_sessions; DELETE FROM shop_activation_tokens; DELETE FROM shop_user_credentials; DELETE FROM shop_user_units; DELETE FROM shop_users");
}
