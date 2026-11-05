# Manual acceptance test: Sprint 12C

Shop user administration, B2B unit authorization and the end-to-end sign-in
of the customer shop.

This guide is written for someone who has not done this before. Follow the
steps in order; every step says what you should see. Mark each test case
**Pass** or **Fail** in the checklist at the end.

> **Safety first.** Run this test **only** in the disposable acceptance
> environment described below. Never test against the development
> database `b2b_erp` (port 5432) or the development apps (ports 3000, 3001,
> 3002): users, links and sessions created there would stay.

---

## 1. What you need

| Requirement | How to check |
| ----------- | ------------ |
| Docker Desktop is running | `docker info` prints a server version |
| Node.js 24.7 or later (tested with 26.13) | `node --version` |
| The dependencies are installed | once: `npm install` in `apps/erp-api`, `apps/backoffice` and `apps/shop` |
| Two browser windows that do **not** share cookies | a normal window and a private window (Edge: InPrivate, Chrome: Incognito) |
| Ports 55470, 3310, 3311 and 3313 are free | the start command checks this and stops if one is busy |

Why two windows? Browsers share cookies of `127.0.0.1` across all ports.
One window can show the Backoffice and one shop user at the same time; a
**second shop user** needs the private window.

## 2. Start the disposable environment

Open a terminal in the repository folder and run:

```bash
cd apps/backoffice
npm run acceptance:env
```

The first start builds the three apps (a few minutes). Later starts can skip
that with `npm run acceptance:env -- --skip-build` (only if you did not
change any code since the last build).

To only check that the environment works, run
`npm run acceptance:env -- --check`: it starts everything, prints
`Check: Backoffice 200, Shop 200, Shop health 200` and removes it all again.

When it is ready, the terminal shows:

```
The acceptance environment is ready (disposable, this computer only):

  Backoffice  http://127.0.0.1:3311/shop-users
  Shop        http://127.0.0.1:3313
  ERP API     http://127.0.0.1:3310
```

Keep this terminal open during the whole test. **Ctrl+C** stops everything
and removes it (section 7).

### What this command does for you

- **Disposable database:** a new PostgreSQL container named
  `b2b-browser-test-<random>` on port 55470. It lives only in memory and is
  deleted when you stop. All migrations are applied to it, so it has exactly
  the structure of `b2b_erp`, but none of its data.
- **Test data:** created through the ERP API, see section 3.
- **`SHOP_SERVICE_KEY`:** a new random key for this run only. It is handed
  to the ERP API and the shop directly and is **never shown or written to a
  file**. You do not need to create or copy any key.
- **Activation links** point to the shop of this environment
  (`http://127.0.0.1:3313`).

Optional check that you are not on the development database:

```bash
docker ps --format "{{.Names}} {{.Ports}}"
```

You see `b2b-browser-test-…` on `127.0.0.1:55470`. The development
container `b2b-commerce-lab-postgres-1` may also be listed; it is not used
and must **not** be stopped or removed.

> For the *development* environment, the shop service key is created as
> described in `docs/local-setup.md` ("Creating the shop service key"): it
> is written directly into `.env` and `apps/shop/.env.local` and never
> printed. You do not need it for this test.

## 3. Test data

Created automatically (no shop users yet):

| Customer account | Name | B2B units |
| ---------------- | ---- | --------- |
| `CUST-1000` | Müller Heiztechnik GmbH (Germany) | `UNIT-STUTTGART` "Müller – Stuttgart", `UNIT-MUENCHEN` "Müller – München" |
| `PL-1000` | Warszawa Ogrzewanie Sp. z o.o. (Poland) | `UNIT-WARSZAWA` "Warszawa" |
| `JP-1000` | Osaka Heating KK (Japan) | `UNIT-OSAKA` "Osaka" |

You create these three shop users in the test (test cases A3 and A4):

| Shop user | E-mail address | Account | Units | Password to set (example) |
| --------- | -------------- | ------- | ----- | ------------------------- |
| Anna Weber | `anna.weber@mueller.example` | CUST-1000 | Stuttgart **and** München | `Radiators hum softly in Stuttgart 2026` |
| Ben Braun | `ben.braun@mueller.example` | CUST-1000 | München only | `Munich warehouse keeps every valve 99` |
| Piotr Nowak | `piotr.nowak@warszawa.example` | PL-1000 | Warszawa only | `Warszawa heating season starts early 7` |

Passwords need at least 15 characters. They exist only in this disposable
environment; still, do not reuse real passwords.

---

## 4. Test cases

Each test case lists the steps and the **expected result**. "BO" means the
Backoffice (`http://127.0.0.1:3311`), "Shop" means `http://127.0.0.1:3313`.

### A. Backoffice: shop user administration

**A1 – Page and local-only notice**
1. Open BO `/shop-users`.
2. Expected: "Shop Users" is marked in the left navigation; an amber notice
   "Local administration without sign-in" says the Backoffice must never be
   reachable from other computers; the list says "No shop users yet".

**A2 – Required fields**
1. Click **New Shop User**, then **Create Shop User** without entering anything.
2. Expected: red messages at account, e-mail address and display name;
   nothing is saved. There is **no password field**.

**A3 – Create Anna with two units**
1. Account: `CUST-1000 · Müller Heiztechnik GmbH`.
2. Expected: under "B2B units" only `UNIT-MUENCHEN` and `UNIT-STUTTGART`
   are offered (no Warszawa, no Osaka).
3. E-mail `anna.weber@mueller.example`, display name `Anna Weber`, tick both
   units, click **Create Shop User**.
4. Expected: the panel of Anna opens: badges "Access" and "Not invited", two
   units each marked "Can order", "No open session".

**A4 – Create Ben and Piotr**
1. Create Ben (CUST-1000, only München) and Piotr (PL-1000, only Warszawa)
   the same way.
2. Expected: the list shows three users; the key figures show
   "Shop users 3", "Not yet activated 3".
3. Try to create another user with `ANNA.WEBER@mueller.example`.
4. Expected: "A shop user with this e-mail address already exists."

**A5 – Search and filter**
1. Type `warszawa` into the search.
2. Expected: only Piotr. Clear the search; filter "No access" shows nobody yet.

### B. Activation links

**A6 – "Open Shop" menu**
1. In the BO header, click **Open Shop**.
2. Expected: "Test shop" with the address `http://127.0.0.1:3313` and an
   arrow; "Production shop" greyed out with "Not configured" (this
   environment has no production shop).
3. Click "Test shop". Expected: the shop opens in a **new tab**; the
   Backoffice tab stays as it was.
4. The addresses come from the configuration of the Backoffice
   (`SHOP_LINK_TEST_URL`, `SHOP_LINK_PRODUCTION_URL`, see
   `docs/local-setup.md`); the acceptance environment sets the test shop.

**B1 – The link is shown once**
1. Open Anna, section "Activation", click **Create activation link**,
   confirm with **Create link**.
2. Expected: a dialog "Activation link for Anna Weber" with a warning
   "Shown only this once" and a link starting with
   `http://127.0.0.1:3313/activate#token=`.
3. Click **Copy link** (expected: "Copied to the clipboard"), paste the
   link into a text editor for the next step, then click **Done**.
4. Expected: the dialog is closed; the state says "Link sent" with the
   expiry time. There is no way to show the link again.

**B2 – A new link replaces the old one**
1. Create a link for Ben, copy it, click Done. Create a **second** link for
   Ben (confirm). Copy the second one too.
2. Expected: the confirmation said the earlier link stops working.
   Keep both; you test them in B4.

**B3 – Activate Anna**
1. In the **normal** window, open Anna's link.
2. Expected: the page "Activate your access"; the address bar shows only
   `http://127.0.0.1:3313/activate` (the token was removed).
3. Before typing, **Set password** is greyed out and the text below it
   says "Enter at least 15 characters (0 so far)." The mouse pointer over
   the button is a "not allowed" sign, not a waiting cursor.
4. Press **F5** (reload). Expected: "Please open the link from your
   invitation again" (not "expired"): the page removed the code from the
   address bar, so a reload cannot continue. The link is still valid.
5. Paste Anna's link into the address bar of **the same tab** and press
   Enter. Expected: the form appears again and the address bar shows only
   `/activate`.
6. Enter Anna's password twice (the hint below the button disappears),
   click **Set password**.
7. Expected: "Your password is set" with a link to sign in.

**B4 – Links work only once**
1. Open Anna's link again (paste it into the address bar) and try to set a
   password.
2. Expected: "The activation link is invalid or has expired."
3. Open Ben's **first** link: also invalid. Open Ben's **second** link and
   set Ben's password: works.
4. Create a link for Piotr in BO and activate it in the **private** window.
5. Expected in BO (click **Refresh**): all three users show "Activated";
   "Create new link" is disabled with "The user has already set a password".

**B5 – Password reset for an activated user (GAP-001)**
1. Sign in as Anna in the normal window (she must have set a password).
2. BO: open Anna → section "Password reset" → **Create password reset link**,
   confirm with **Create reset link**.
3. Expected: a dialog "Password reset link for Anna Weber" with "Shown only
   this once", the request to share it only through a **verified, secure
   channel**, the expiry time (4 hours from now) and a link starting with
   `http://127.0.0.1:3313/reset-password#token=`. Copy it, click **Done**.
   The state shows "Reset link created …, valid until …".
4. Until the link is used, Anna stays signed in and her current password
   works.
5. Open the reset link (any window). Expected: "Choose a new password"; the
   address bar shows only `/reset-password`. Set a new password.
6. Expected: "Your new password is set … signed out everywhere". In the
   normal window, reload: Anna is on the sign-in page.
7. Sign in with the **old** password: "Incorrect email or password. Please
   try again." With the **new** password: "My account" opens.
8. Open the reset link again and try to set a password. Expected: "This
   password reset link is invalid or has expired."
9. For a user who has not set a password yet, there is no reset section;
   use the activation link instead. There is no "forgot password" in the
   shop (on purpose).
10. Note: the reset table needs the migration
   `20261105090000_add_shop_password_resets`. The acceptance environment
   applies all migrations to its disposable database; the development
   database `b2b_erp` only gets it after approval
   (`docs/runbooks/shop-password-resets-migration.md`).

### C. Sign-in and sign-out

**C1 – Generic failure**
1. Shop `/login` (normal window): Anna's address with a wrong password.
2. Expected: "Incorrect email or password. Please try again." The same message for an
   unknown address such as `nobody@mueller.example`.

**C1a – The e-mail address stays after a failed attempt**
1. Shop `/login`: Anna's address with a wrong password, **Sign in**.
2. Expected: the error message; the e-mail field still contains Anna's
   address, the password field is empty and has the cursor. The address
   bar shows `/login?error=invalid`, never the e-mail address.
3. Enter the right password, **Sign in**: "My account" opens.

**C2 – Sign in**
1. Sign in as Anna.
2. Expected: "My account" with "Welcome, Anna Weber", "Müller Heiztechnik
   GmbH", customer number CUST-1000, role Buyer; the header shows Anna's
   name and **Sign out**.

**C3 – Sign out**
1. Click **Sign out**.
2. Expected: "You have been signed out." Open Shop `/account`: you are sent
   to the sign-in page. The browser's Back button does not show the account
   again after a reload.

### D. Units and unit selection

**D1 – Anna chooses a unit**
1. Sign in as Anna again.
2. Expected: two unit cards (München, Stuttgart), both "Ordering possible";
   the banner says "Working for: No unit selected".
3. Click **Work for this unit** on München.
4. Expected: green notice "You are now working for the selected unit";
   München is marked "✓ Selected"; the banner and the header show
   "Müller – München".

**D2 – Switch the unit**
1. Click **Work for this unit** on Stuttgart.
2. Expected: Stuttgart is selected, header shows "Müller – Stuttgart".
   Reload the page: the selection stays.

**D3 – A single unit is selected automatically**
1. In the private window: sign out Piotr if signed in, sign in as **Ben**.
2. Expected: one unit (München), already "✓ Selected" without choosing.

### E. Cross-account authorization

**E1 – Piotr sees only his account**
1. In the private window: sign out, sign in as Piotr.
2. Expected: "Warszawa Ogrzewanie", one unit `UNIT-WARSZAWA`, nothing of
   Müller (no Stuttgart, no München) anywhere on the page.

**E2 – The Backoffice offers only units of the user's own account**
1. BO: open Piotr. In "Authorized B2B units", open the unit selection.
2. Expected: no Müller or Osaka unit is offered ("No further active unit of
   this account").
3. Rule (confirmed after the acceptance test, BUG-003): **inactive units
   cannot be assigned**. Deactivate `UNIT-MUENCHEN` (BO → B2B Units), open a
   user of CUST-1000 who does not have it: it is listed greyed out as
   "(inactive, cannot be assigned)", with a note below the selection.
   Units assigned before they became inactive stay view only (F2).
   Reactivate `UNIT-MUENCHEN` afterwards.

**E3 (optional, needs browser developer tools) – A manipulated unit cookie grants nothing**
1. In the private window (Piotr), open the developer tools (F12) →
   Application → Cookies → `http://127.0.0.1:3313`. Change the value of
   `shop_unit` (create it if missing) to `UNIT-STUTTGART`. Reload `/account`.
2. Expected: still only Warszawa; a notice says the unit you worked for
   before is no longer available. Nothing of Stuttgart is shown.

### F. Permission changes during a signed-in session

**F1 – Remove a unit while Anna is signed in**
1. Normal window: Anna works for Stuttgart (D2).
2. BO (in a new tab of the same window): open Anna, **Remove** at
   `UNIT-STUTTGART`, confirm.
3. Shop tab: reload `/account`.
4. Expected: only München is listed and selected; a notice says the unit
   you worked for before is no longer available. In BO Anna shows 1 unit.

**F2 – An inactive unit is view only**
1. BO → **B2B Units** → open `UNIT-MUENCHEN` → untick **Active** → save.
2. Shop (Anna) reload: München shows "View only"; an amber notice says
   "Müller – München is view only … no new orders can be placed"; the
   header shows "· view only".
3. BO → Shop Users → Anna: München is marked "View only" and "(unit
   inactive)". In the unit selection of Ben or Anna, an inactive unit is not
   offered for new assignments.
4. Reactivate `UNIT-MUENCHEN` (tick **Active**, save). Expected: "Ordering
   possible" again after a reload.

**F3 – Give the unit back**
1. BO: Anna → select `UNIT-STUTTGART` → **Assign**.
2. Expected: the shop shows both units again after a reload.

### G. Sessions

**G1 – Open sessions are listed**
1. BO: open Anna. Expected: "Signed-in sessions" lists one session with
   sign-in time, last activity and end time, but no token or code.

**G2 – End one session**
1. Click **End session**. Shop (Anna): reload.
2. Expected: Anna is on the sign-in page. She can sign in again.

**G3 – End all sessions**
1. Sign Anna in again in the normal window. Optionally sign her in a second
   time in another browser (e.g. a second browser program).
2. BO: Anna → **End all sessions**, confirm.
3. Expected: every Anna window is signed out at the next reload; signing in
   again works (ending sessions is no lock-out).

### H. Disable and enable a user

**H1 – Disable while signed in**
1. Sign in as Anna. BO: Anna → **Disable user**, confirm.
2. Expected: BO shows "Disabled"; units stay listed with "No access".
   Shop: reload → sign-in page.
3. Try to sign in as Anna: "Incorrect email or password. Please try again." (no hint
   that the user is disabled).
4. BO list, filter **No access**: Anna is listed.

**H2 – Enable again**
1. BO: Anna → **Enable user**, confirm.
2. Expected: "Access" again. Anna signs in with her existing password. An
   old session does not come back (she had to sign in).

### I. Deactivate and reactivate the customer account

**I1 – Account inactive**
1. Sign in as Ben (private window).
2. BO → **Customers** → open `CUST-1000` → untick **Active** → save.
3. Expected: Ben's next reload in the shop shows the sign-in page; signing
   in fails with the generic message. BO → Shop Users: Anna and Ben show
   "Account inactive"; Piotr still has "Access" (other account).
4. Creating a new activation link for a CUST-1000 user is refused with
   "The customer account of the shop user is inactive."

**I2 – Account active again**
1. BO → Customers → `CUST-1000` → tick **Active** → save.
2. Expected: Anna and Ben show "Access" again. Ben must sign in again (his
   old session stays ended); then it works.

### J. Boundary and privacy checks

**J1 – No administration in the shop**
1. Open Shop `/shop-users` and `/shop/v1/shop-users`.
2. Expected: the "404 – This page could not be found" page. The shop has no administration.

**J2 – The activation link is not kept by the browser**
1. After B1, look at the browser history of the BO window.
2. Expected: no entry contains `#token=`.

**J3 – Sensitive pages are not cached**
1. Sign out in the shop, press the browser's Back button, then reload.
2. Expected: the account page is not shown again without signing in.

### K. Desktop and mobile layout

**K1 – Desktop (wide window)**
1. BO `/shop-users`, a user panel, the "New Shop User" panel, the link
   dialog; Shop `/login`, `/activate`, `/account`.
2. Expected: tidy layout, nothing overlaps, active/disabled/view-only states
   are clearly different (green, red, amber).

**K2 – Mobile (390 px)**
1. Developer tools (F12) → device toolbar (Ctrl+Shift+M) → width 390.
2. Check the same pages as K1.
3. Expected: no sideways scrolling; the list shows name, e-mail and account
   number; the user panel fills the screen and scrolls; buttons are
   reachable; the shop unit cards stack.

**K3 – Keyboard**
1. In BO `/shop-users` use only Tab, Enter and Escape: open a user with the
   **Manage** button, move through the panel, close it with Escape.
2. Expected: the focus is always visible; the confirmation dialog starts on
   **Cancel**.

---

## 5. Expected results at a glance

| Area | Must hold |
| ---- | --------- |
| Administration | Only units of the user's own account can be assigned; no passwords in the Backoffice |
| Activation links | Shown once; work once; a new link replaces an unused one |
| Sign-in | One generic failure message for every reason |
| Units | The shop shows only assigned units; inactive units are view only |
| Changes | Removed units, disabled users and inactive accounts take effect with the next request |
| Sessions | Ending sessions signs out; disabling blocks sign-in; reactivation restores no old session |

## 5a. Results of the first acceptance run and follow-up

| Finding | Outcome | Retest |
| ------- | ------- | ------ |
| Activation form (button looked like loading, reload message) | fixed | B3 |
| Technical error page after a wrong password following activation | fixed | C1, C1a |
| BUG-003 inactive units missing in the selection | rule confirmed (not assignable); now shown greyed out with the reason | E2 step 3 |
| UX-001 "Open Shop" in the Backoffice | added | A6 |
| UX-002 keep the e-mail address after a failed sign-in | added | C1a |
| GAP-001 password reset for activated users | added: administrator-issued reset link, 4 hours, ends all sessions (no public "forgot password") | B5 (replaces the skipped test 10) |
| 24-hour expiry of activation links (not tested manually) | automated: valid until the last millisecond of the 24 hours, refused from then on (`apps/erp-api/test/integration/shop-auth-api.int-spec.ts`) | – |

### Manual follow-up acceptance (commits `62b93d0`, `fe9e702`)

Executed in the disposable acceptance environment. The numbering A1–A6 is
the one of the follow-up run, not the test case IDs of section 4.

| Follow-up | Test case | Manual result |
| --------- | --------- | ------------- |
| A1 "Open Shop" | A6 | **Passed** |
| A2 Keep the e-mail address after a failed sign-in | C1a | **Passed** |
| A3 Inactive B2B unit shown as not assignable | E2 step 3 | **Passed** |
| A4 Creating a password reset link (shown once) | B5 steps 1–3 | **Passed** |
| A5 Password reset and the end of all sessions | B5 steps 4–7 | **Not explicitly confirmed** – open |
| A6 Replaying a used reset link | B5 step 8 | **Not executed manually** – open |

A5 and A6 are covered by automated tests only (not a substitute for the
manual acceptance): `apps/erp-api/test/integration/shop-password-reset.int-spec.ts`
(new password, old password refused, every session ended, single use, 4-hour
expiry, activation and reset links kept apart, concurrent sign-in during a
reset) and the browser suite "Password reset from the Backoffice" in
`apps/backoffice/test/browser/suites/shop-admin.mjs`. To close them, run B5
steps 4–8 again and record the result here.

## 6. Pass/Fail checklist

| ID | Test case | Pass | Fail | Note |
| -- | --------- | :--: | :--: | ---- |
| A1 | Page and local-only notice | ☐ | ☐ | |
| A2 | Required fields, no password field | ☐ | ☐ | |
| A3 | Create Anna with two units (own units only) | ☐ | ☐ | |
| A4 | Create Ben and Piotr, duplicate e-mail refused | ☐ | ☐ | |
| A5 | Search and filter | ☐ | ☐ | |
| A6 | "Open Shop" menu (configured test shop, unconfigured production shop) | ☐ | ☐ | |
| B1 | Link shown once | ☐ | ☐ | |
| B2 | New link replaces the old one | ☐ | ☐ | |
| B3 | Activation of Anna | ☐ | ☐ | |
| B4 | Links work only once | ☐ | ☐ | |
| B5 | Password reset: link once, 4 h, sessions ended, old password refused, link single-use | ☐ | ☐ | |
| C1 | Generic sign-in failure | ☐ | ☐ | |
| C1a | E-mail address kept after a failed attempt | ☐ | ☐ | |
| C2 | Sign in | ☐ | ☐ | |
| C3 | Sign out | ☐ | ☐ | |
| D1 | Choose a unit | ☐ | ☐ | |
| D2 | Switch the unit | ☐ | ☐ | |
| D3 | Single unit selected automatically | ☐ | ☐ | |
| E1 | Piotr sees only his account | ☐ | ☐ | |
| E2 | Only own units offered in BO | ☐ | ☐ | |
| E3 | Manipulated cookie grants nothing (optional) | ☐ | ☐ | |
| F1 | Unit removed during session | ☐ | ☐ | |
| F2 | Inactive unit view only | ☐ | ☐ | |
| F3 | Unit assigned again | ☐ | ☐ | |
| G1 | Sessions listed without tokens | ☐ | ☐ | |
| G2 | End one session | ☐ | ☐ | |
| G3 | End all sessions | ☐ | ☐ | |
| H1 | Disable while signed in | ☐ | ☐ | |
| H2 | Enable again | ☐ | ☐ | |
| I1 | Account inactive | ☐ | ☐ | |
| I2 | Account active again | ☐ | ☐ | |
| J1 | No administration in the shop | ☐ | ☐ | |
| J2 | Link not in browser history | ☐ | ☐ | |
| J3 | Sensitive pages not cached | ☐ | ☐ | |
| K1 | Desktop layout | ☐ | ☐ | |
| K2 | Mobile layout 390 px | ☐ | ☐ | |
| K3 | Keyboard | ☐ | ☐ | |

Tester: ____________________ Date: ____________ Result: ☐ accepted ☐ not accepted

When a case fails, note what you did, what you saw and what you expected,
and take a screenshot. **Never** put an activation link or a password into
a ticket, chat or screenshot.

## 7. Cleanup

1. Close the two browser windows (the private window forgets its cookies).
2. In the terminal of the acceptance environment, press **Ctrl+C**.
3. Expected: lines "removed: Shop", "removed: Backoffice", "removed: ERP
   API", "removed: test database b2b-browser-test-…", "removed: log folder".
4. Check that nothing is left:

   ```bash
   docker ps -a --format "{{.Names}}" | grep b2b-browser-test
   ```

   Expected: no output. (The development container
   `b2b-commerce-lab-postgres-1` stays; never stop or remove it.)
5. Optional: in the normal browser, delete the cookies of `127.0.0.1`
   (developer tools → Application → Cookies), so no `shop_session` or
   `shop_unit` cookie of this test remains.

If the terminal was closed without Ctrl+C, a container may be left over.
Remove **only** containers whose name starts with `b2b-browser-test-`:
`docker rm -f <name>`.

## 8. Troubleshooting

| Symptom | Cause and solution |
| ------- | ------------------ |
| "port … is already in use" | Another program, or an earlier acceptance run, uses the port. Stop that program yourself; the command never stops anything it did not start. |
| "Docker is not available" | Start Docker Desktop and wait until it says "running". |
| The shop says "Sign-in is not available" | The ERP API in the terminal has stopped. Look at the terminal; restart the environment. |
| After a reload the activation page says "Please open the link from your invitation again" | Expected: the code is removed from the address bar once read. Open the link again (also in the same tab); it still works until a password is set. |
| **Set password** stays greyed out | The text below the button says what is missing: at least 15 characters, the repetition, or matching passwords. |
| A link says "invalid or has expired" at the first use | A newer link was created for the same user, or 24 hours have passed. Create a new link in the Backoffice. |
| "Too many attempts" | Five wrong passwords for one address within 15 minutes. Wait 15 minutes or restart the environment. |
