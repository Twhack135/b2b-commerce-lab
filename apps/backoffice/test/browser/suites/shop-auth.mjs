// Shop sign-in (Sprint 12B) in a real browser: activation with a one-time
// link, sign-in, the session cookie, CSRF and request checks, rate limits,
// sign-out, a disabled user and secrets in logs. The test user only exists
// in the disposable test database; tokens and passwords are never printed.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EMAIL = "anna.weber@mueller.example";
const PASSWORD = "Heat pumps keep Stuttgart warm 2026";

export default async function shopAuthSuite({ page, urls, shopUser, shopServiceKey, sql, runDir, check, section }) {
  const SHOP = urls.shop;
  const evaluate = (expression) => page.evaluate(expression);
  page.extraHelpers = "";
  page.diagnostics = "({ notice: document.querySelector('[data-notice]')?.innerText ?? null })";
  const errorsBefore = page.pageErrors.length;
  const secrets = [PASSWORD];

  /** The sign-in form, filled in and sent like a user would */
  async function signIn(email, password) {
    await page.goto(`${SHOP}/login`, "$vis(document.querySelector('[data-login-form]'))");
    await evaluate(`$setEl(document.getElementById('email'), ${JSON.stringify(email)}); $setEl(document.getElementById('password'), ${JSON.stringify(password)}); document.querySelector('[data-login-form]').requestSubmit()`);
  }
  /**
   * Waits for a page after a navigation and installs the helpers again.
   * Conditions check visibility: streamed content is first rendered into a
   * hidden container (Suspense) and only then revealed.
   */
  async function arrived(condition, label) {
    await page.waitFor(`document.readyState === 'complete' && (${condition})`, label, 15_000);
    await page.installHelpers();
  }
  const sessionCookie = async () =>
    (await page.send("Network.getCookies", { urls: [`${SHOP}/`] })).cookies.find((c) => c.name === "shop_session");
  const erpSession = (token) =>
    fetch(`${urls.api}/shop/v1/auth/session`, { headers: { "X-Shop-Service-Key": shopServiceKey, "X-Shop-Session": token } }).then((r) => r.status);

  // ------------------------------------------------------------- activation
  section("Activation with a one-time link");
  const created = shopUser("create", "--account", "CUST-1000", "--email", EMAIL, "--name", "Anna Weber", "--unit", "UNIT-STUTTGART", "--unit", "UNIT-MUENCHEN");
  check("Test user created with the ERP tool, in the test database only", created.email === EMAIL && sql("SELECT count(*) FROM shop_users") === "1");
  const { link } = shopUser("activation", "--email", EMAIL);
  const token = new URL(link).hash.slice("#token=".length);
  secrets.push(token);
  check("The link has the token in its fragment; the database stores only its hash", link.startsWith(`${SHOP}/activate#token=`) && /^[A-Za-z0-9_-]{43}$/.test(token) && sql(`SELECT count(*) FROM shop_activation_tokens WHERE token_hash = encode(sha256('${token}'), 'hex')`) === "1" && sql(`SELECT count(*) FROM shop_activation_tokens WHERE token_hash = '${token}'`) === "0");

  page.requests = [];
  await page.goto(link, "!!document.querySelector('[data-activation-form]')?.offsetParent");
  check("The token is removed from the address bar at once", (await evaluate("location.href")) === `${SHOP}/activate`);
  check("The token is never sent to a server in a URL", page.requests.length > 0 && page.requests.every((r) => !r.url.includes(token)));

  // Found in the Sprint 12C acceptance test: the disabled button looked like
  // "loading", a reload claimed the link had expired, and opening the link
  // again in the same tab kept that state and the token in the address bar
  const button = "document.querySelector('[data-activation-form] button[type=submit]')";
  check("An empty form says what is missing; the disabled button does not look like loading", (await evaluate(`${button}.disabled && getComputedStyle(${button}).cursor !== 'wait'`)) && (await evaluate("$text('[data-submit-hint]')")) === "Enter at least 15 characters (0 so far).");
  await page.send("Page.reload", {});
  await page.waitFor("document.readyState === 'complete' && !!document.querySelector('[data-activation=missing]')?.offsetParent", "reload: link missing", 15_000);
  await page.installHelpers();
  check("Reloaded: asks to open the link again instead of claiming it expired; the link stays valid", (await evaluate("$text('[data-activation=missing]')")).includes("open the link from your invitation again") && !(await evaluate("document.body.innerText.includes('expired')")) && sql("SELECT count(*) FROM shop_activation_tokens WHERE used_at IS NULL") === "1");
  page.requests = [];
  await page.send("Page.navigate", { url: link });
  await page.waitFor("!!document.querySelector('[data-activation-form]')?.offsetParent", "same tab: form", 15_000);
  await page.installHelpers();
  check("Opened again in the same tab: the form appears, the token leaves the address bar and no server", (await evaluate("location.href")) === `${SHOP}/activate` && page.requests.every((r) => !r.url.includes(token)));

  const submit = "document.querySelector('[data-activation-form] button[type=submit]')";
  await evaluate("$setEl(document.getElementById('new-password'), 'too short')");
  check("Too short: 'Set password' stays disabled, the rule is explained", (await evaluate(`${submit}.disabled`)) && (await evaluate("$text('#password-rules')")).includes("At least 15 characters"));
  await evaluate("$setEl(document.getElementById('new-password'), 'passwordpassword'); $setEl(document.getElementById('confirm-password'), 'passwordpassword')");
  await page.waitFor(`!${submit}.disabled`, "submit enabled");
  await evaluate(`${submit}.click()`);
  await page.waitFor("document.querySelector('[data-notice=error]')?.innerText.includes('too common')", "password rule message");
  check("The ERP password rules are applied (a common password is refused)", sql("SELECT count(*) FROM shop_user_credentials") === "0");
  await evaluate(`$setEl(document.getElementById('new-password'), ${JSON.stringify(PASSWORD)}); $setEl(document.getElementById('confirm-password'), ${JSON.stringify(`${PASSWORD}!`)})`);
  check("Different repetition: explained, not sent", (await page.becomes("document.getElementById('confirm-error')?.innerText === 'The passwords do not match.'", 2000)) && (await evaluate(`${submit}.disabled`)));
  await evaluate(`$setEl(document.getElementById('confirm-password'), ${JSON.stringify(PASSWORD)})`);
  await page.waitFor(`!${submit}.disabled`, "submit enabled");
  await evaluate(`${submit}.click()`);
  await page.waitFor("!!document.querySelector('[data-activation=done]')?.offsetParent", "activated");
  check("Password set: confirmation and the way to sign in", (await evaluate("$text('[data-activation=done]')")).includes("Your password is set") && (await evaluate("document.querySelector('[data-activation=done] a').getAttribute('href')")) === "/login?activated=1");
  check("Only an Argon2id hash is stored", sql("SELECT password_hash LIKE '$argon2id$v=19$m=19456,t=2,p=1$%' FROM shop_user_credentials") === "t" && !sql("SELECT password_hash FROM shop_user_credentials").includes(PASSWORD));

  // Found in the Sprint 12C acceptance test: after "Continue to sign in" (a
  // link within the same document) the activation page's referrer policy
  // made the browser send "Origin: null"; a wrong password then showed the
  // raw JSON refusal of the origin check instead of the sign-in page
  await evaluate("document.querySelector('[data-activation=done] a').click()");
  await page.waitFor("location.pathname === '/login' && !!document.querySelector('[data-login-form]')?.offsetParent", "sign-in page after activation");
  check("After activation the sign-in page says the access is ready (message from the URL)", (await evaluate("$text('[data-notice]')")) === "Your access is ready. Sign in with your new password.");
  await evaluate(`$setEl(document.getElementById('email'), ${JSON.stringify(EMAIL)}); $setEl(document.getElementById('password'), 'wrong password 7654321'); document.querySelector('[data-login-form]').requestSubmit()`);
  await arrived("location.search === '?error=invalid' && !!document.querySelector('[data-notice=error]')?.offsetParent", "wrong password after activation");
  check("Right after activation, a wrong password stays on the sign-in page with a friendly message", (await evaluate("location.pathname")) === "/login" && (await evaluate("$text('[data-notice=error]')")) === "Incorrect email or password. Please try again." && !(await evaluate("document.body.innerText.includes('statusCode')")));

  // Opened again like from the e-mail: a new page load (from the same path,
  // a link that only differs in its fragment would not reload the page)
  await page.goto(`${SHOP}/`, "!!document.querySelector('[data-shop-shell]')");
  await page.goto(link, "!!document.querySelector('[data-activation-form]')?.offsetParent");
  await evaluate(`$setEl(document.getElementById('new-password'), ${JSON.stringify(PASSWORD)}); $setEl(document.getElementById('confirm-password'), ${JSON.stringify(PASSWORD)})`);
  await page.waitFor(`!${submit}.disabled`, "submit enabled");
  await evaluate(`${submit}.click()`);
  await page.waitFor("!!document.querySelector('[data-activation=invalid]')?.offsetParent", "link used");
  check("The link works only once", (await evaluate("$text('[data-activation=invalid]')")).includes("invalid or has expired"));

  // ------------------------------------------------------------- sign-in
  section("Sign-in");
  await page.goto(`${SHOP}/account`, "location.pathname === '/login' && $vis(document.querySelector('[data-login-form]'))");
  check("Signed out: 'My account' leads to the sign-in page", true);
  const failureText = "Incorrect email or password. Please try again.";
  await signIn(EMAIL, "wrong password 1234567");
  await arrived("location.search === '?error=invalid'", "wrong password");
  // Sprint 12C acceptance (UX-002): the address stays, only the password is cleared
  check("After a failed attempt the e-mail address stays, the password is cleared and focused", (await evaluate("document.getElementById('email').value")) === EMAIL && (await evaluate("document.getElementById('password').value")) === "" && (await evaluate("document.activeElement?.id")) === "password" && !(await evaluate(`location.href.includes(${JSON.stringify(encodeURIComponent(EMAIL))}) || location.href.includes(${JSON.stringify(EMAIL)}) || JSON.stringify({ ...localStorage, ...sessionStorage }).includes(${JSON.stringify(EMAIL)}) || document.cookie.includes('mueller')`)));
  const wrongPassword = await evaluate("$text('[data-notice=error]')");
  await signIn("nobody@mueller.example", PASSWORD);
  await arrived("location.search === '?error=invalid'", "unknown user");
  check("Wrong password and unknown e-mail address: the same generic message", wrongPassword === failureText && (await evaluate("$text('[data-notice=error]')")) === failureText);

  await signIn(EMAIL, PASSWORD);
  await arrived("location.pathname === '/account' && !!document.querySelector('[data-display-name]')?.offsetParent", "signed in");
  check("Signed in: welcome, company and customer number", (await evaluate("$text('[data-display-name]')")) === "Welcome, Anna Weber" && (await evaluate("document.body.innerText")).includes("Müller Heiztechnik GmbH") && (await evaluate("$text('[data-signed-in-email]')")) === EMAIL);
  check("The units assigned to the user, with their state", (await evaluate("document.querySelector('[data-units]').dataset.units")) === "2" && (await evaluate("$text('[data-unit=\"UNIT-STUTTGART\"]')")).includes("Ordering possible"));
  check("The header shows the person and 'Sign out'", (await evaluate("$text('[data-account-menu]')")).includes("Anna Weber") && (await evaluate("!!document.querySelector('[data-sign-out]')")));
  await page.goto(`${SHOP}/login`, "location.pathname === '/account'");
  check("Signed in: the sign-in page leads to 'My account'", true);

  // ------------------------------------------------------------- cookie
  section("Session cookie");
  const cookie = await sessionCookie();
  secrets.push(cookie?.value ?? "missing");
  const nowSeconds = Date.now() / 1000;
  check("HttpOnly, SameSite=Lax, Path=/, not Secure only on plain-HTTP 127.0.0.1", cookie?.httpOnly === true && cookie.sameSite === "Lax" && cookie.path === "/" && cookie.secure === false, JSON.stringify(cookie && { ...cookie, value: "<hidden>" }));
  check("Expires with the session, about 10 hours", cookie && cookie.expires > nowSeconds + 9.9 * 3600 && cookie.expires < nowSeconds + 10.1 * 3600);
  check("Scripts and the page cannot see the session", !(await evaluate("document.cookie.includes('shop_session')")) && !(await evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(cookie.value)}) || JSON.stringify({ ...localStorage, ...sessionStorage }).includes(${JSON.stringify(cookie.value)})`)));
  check("The database stores only the hash of the session", sql(`SELECT count(*) FROM shop_sessions WHERE token_hash = encode(sha256('${cookie.value}'), 'hex') AND revoked_at IS NULL`) === "1");

  // ------------------------------------------------------------- CSRF
  section("CSRF and request checks");
  const send = (path, { origin, site, type = "application/x-www-form-urlencoded", body = "email=a%40b.de&password=x" } = {}) =>
    fetch(`${SHOP}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: { ...(origin ? { Origin: origin } : {}), ...(site ? { "Sec-Fetch-Site": site } : {}), "Content-Type": type, Cookie: `shop_session=${cookie.value}` },
      body,
    }).then((r) => `${r.status} ${r.headers.get("location") ?? ""}`.trim());
  const sessionsBefore = sql("SELECT count(*) FROM shop_sessions");
  const statuses = {
    "logout from another site": await send("/api/auth/logout", { origin: "http://evil.example" }),
    "logout without Origin": await send("/api/auth/logout"),
    "logout, fetch metadata cross-site": await send("/api/auth/logout", { origin: SHOP, site: "cross-site" }),
    "login from another site": await send("/api/auth/login", { origin: "http://evil.example" }),
    "activation from another site": await send("/api/auth/activate", { origin: "http://evil.example", type: "application/json", body: "{}" }),
    "login with another content type": await send("/api/auth/login", { origin: SHOP, type: "text/plain" }),
  };
  // Browser forms are sent back to a shop page (never a raw JSON page); the
  // script route of the activation answers 403
  check("Requests from other sites are refused: forms back to the shop (303), script requests 403; wrong content type 415", JSON.stringify(Object.values(statuses)) === JSON.stringify(["303 /account", "303 /account", "303 /account", "303 /login?error=request", "403", "415"]), JSON.stringify(statuses));
  check("The refused requests changed nothing (no new or ended session)", sql("SELECT count(*) FROM shop_sessions") === sessionsBefore);
  check("GET on the sign-in routes is not allowed (405)", (await fetch(`${SHOP}/api/auth/login`)).status === 405 && (await fetch(`${SHOP}/api/auth/logout`)).status === 405);
  check("The refused sign-out did not end the session", (await erpSession(cookie.value)) === 200);

  // ------------------------------------------------------------- limits
  section("Rate limiting of the sign-in");
  const attempt = () =>
    fetch(`${SHOP}/api/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: SHOP, "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=guess%40mueller.example&password=wrong+password+12345",
    }).then((r) => new URL(r.headers.get("location") ?? "", SHOP).search);
  const answers = [];
  for (let i = 0; i < 6; i++) answers.push(await attempt());
  check("After 5 failures for an address: 'Too many attempts'", JSON.stringify(answers) === JSON.stringify([...Array(5).fill("?error=invalid"), "?error=locked"]), JSON.stringify(answers));

  // ------------------------------------------------------------- mobile
  section("Mobile 390px");
  await page.viewport(390, 844, true);
  await page.goto(`${SHOP}/account`, "!!document.querySelector('[data-display-name]')?.offsetParent");
  check("'My account' fits 390px", !(await evaluate("$overflow()")));
  await page.screenshot("shop-account-mobile.png");
  await page.viewport(1440, 900);
  await page.goto(`${SHOP}/account`, "!!document.querySelector('[data-display-name]')?.offsetParent");
  await page.screenshot("shop-account.png");

  // ------------------------------------------------------------- sign-out
  section("Sign-out and replay");
  await evaluate("document.querySelector('[data-sign-out]').click()");
  await arrived("location.pathname === '/login' && location.search === '?signedOut=1'", "signed out");
  check("Signed out: message, cookie removed", (await evaluate("$text('[data-notice]')")) === "You have been signed out." && (await sessionCookie()) === undefined);
  check("The old session token is useless at the ERP (replay)", (await erpSession(cookie.value)) === 401);
  await page.send("Network.setCookie", { name: "shop_session", value: cookie.value, url: `${SHOP}/`, httpOnly: true, sameSite: "Lax" });
  await page.goto(`${SHOP}/account`, "location.pathname === '/login'");
  check("A replayed cookie gives no access to 'My account'", (await evaluate("location.pathname")) === "/login");
  await page.send("Network.deleteCookies", { name: "shop_session", url: `${SHOP}/` });
  await page.goto(`${SHOP}/login`, "$vis(document.querySelector('[data-login-form]'))");
  await page.screenshot("shop-login.png");

  // ------------------------------------------------------------- disabled
  section("A disabled user loses access at once");
  await signIn(EMAIL, PASSWORD);
  await arrived("location.pathname === '/account'", "signed in again");
  const second = await sessionCookie();
  secrets.push(second?.value ?? "missing");
  sql(`UPDATE shop_users SET status = 'DISABLED' WHERE email = '${EMAIL}'`);
  await page.goto(`${SHOP}/account`, "location.pathname === '/login'");
  check("Disabled while signed in: the next request is signed out", (await erpSession(second.value)) === 401);
  await signIn(EMAIL, PASSWORD);
  await arrived("location.search === '?error=invalid'", "disabled sign-in");
  check("A disabled user gets the same generic sign-in failure", (await evaluate("$text('[data-notice=error]')")) === failureText);

  // ------------------------------------------------------------- spoofing
  // Last: it locks sign-ins without a trusted address for this run
  section("Forged X-Forwarded-For headers do not bypass the limits");
  const spoofed = (i, email, password) =>
    fetch(`${SHOP}/api/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: SHOP, "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": `203.0.${Math.floor(i / 250)}.${i % 250}` },
      body: new URLSearchParams({ email, password }).toString(),
    }).then((r) => new URL(r.headers.get("location") ?? "", SHOP).search);
  const before = [];
  // Earlier sections already used some of the shared 50 attempts
  for (let i = 0; i < 60 && !before.includes("?error=locked"); i++) {
    before.push(await spoofed(i, `stuffing${i}@mueller.example`, "wrong password 12345"));
  }
  sql(`UPDATE shop_users SET status = 'ACTIVE' WHERE email = '${EMAIL}'`);
  const afterLock = await spoofed(999, EMAIL, PASSWORD);
  check("A new forged address per request still counts into one shared limit: locked after 50 failures", before.at(-1) === "?error=locked" && before.length <= 51 && afterLock === "?error=locked", `${before.length} attempts, then ${afterLock}`);

  // ------------------------------------------------------------- secrets
  section("Secrets stay out of logs");
  const logs = readdirSync(runDir).filter((name) => name.endsWith(".log"));
  const leaking = logs.filter((name) => {
    const text = readFileSync(join(runDir, name), "utf8");
    return secrets.some((secret) => text.includes(secret));
  });
  check(`No password, activation or session token in any server log (${logs.length} logs)`, logs.length >= 5 && leaking.length === 0, leaking.join(", "));
  check("No uncaught page errors", page.pageErrors.length === errorsBefore, page.pageErrors.slice(errorsBefore).join(" | "));
}
