// Sales order creation and confirmation (Sprint 10C), including the
// navigation fix found in the manual acceptance test. Runs against the
// isolated environment of run.mjs: every order it creates is written into
// the disposable test database only.
//
// Network faults are simulated in the browser (CDP Fetch domain): a lost
// answer after the ERP API stored the order, a 504, a concurrent change.

import { jsonAnswer } from "../lib/browser.mjs";

const SUITE_HELPERS = `
  window.$items = () => [...document.querySelectorAll('li[data-item]')].filter($vis);
  window.$picker = (i) => $items()[i].querySelector('input[role=combobox]');
  window.$qty = (i) => $items()[i].querySelector('input[inputmode=numeric]');
  window.$options = () => [...document.querySelectorAll('[role=listbox] [role=option]')].map(o => o.dataset.material);
  window.$status = () => document.querySelector('[data-status]')?.dataset.status ?? null;
  window.$total = () => document.querySelector('[data-total]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null;
  window.$outdated = () => document.querySelector('[data-outdated]')?.dataset.outdated === 'true';
  window.$create = () => document.querySelector('[data-create-button]');
  window.$blocker = () => document.querySelector('[data-create-blocker]')?.textContent.trim() ?? null;
  window.$outcome = () => document.querySelector('[data-creation-outcome]')?.dataset.creationOutcome ?? null;
  window.$outcomeText = () => document.querySelector('[data-creation-outcome]')?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  window.$dialog = () => document.querySelector('[role=dialog]');
  window.$confirm = () => [...($dialog()?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim().startsWith('Create Sales Order'));
`;

/** The form state reported when a wait times out */
const FORM_STATE = `(() => {
  const select = (id) => {
    const el = document.getElementById(id);
    return el ? { value: el.value, disabled: el.disabled, options: [...el.options].map(o => o.value || o.text) } : null;
  };
  const create = document.querySelector('[data-create-button]');
  return {
    salesArea: select('salesArea'),
    unitId: select('unitId'),
    shipTo: select('shipToCustomerNumber'),
    orderDate: document.querySelector('[data-order-date]')?.textContent.trim() ?? null,
    items: [...document.querySelectorAll('li[data-item]')].map(li => li.querySelector('input[role=combobox]')?.value),
    status: document.querySelector('[data-status]')?.dataset.status ?? null,
    outdated: document.querySelector('[data-outdated]')?.dataset.outdated ?? null,
    create: create ? (create.disabled ? 'disabled' : 'enabled') : null,
    blocker: document.querySelector('[data-create-blocker]')?.textContent.trim() ?? null,
    outcome: document.querySelector('[data-creation-outcome]')?.dataset.creationOutcome ?? null,
  };
})()`;

export default async function salesOrderSuite({ page, api, sql, urls, fixtures, check, section }) {
  const { evaluate, waitFor, goto } = {
    evaluate: (e) => page.evaluate(e),
    waitFor: (e, label, t) => page.waitFor(e, label, t),
    goto: (u, r) => page.goto(u, r),
  };
  const BASE = urls.backoffice;
  const SIM = `${BASE}/sales-orders/simulation`;
  const SIMULATE_PATH = "/api/erp/sales-orders/simulate";
  // The simulation form loads sales areas, B2B units and the order date
  // independently in the browser (after hydration). It is ready for input
  // only when all of them are shown; the units alone are not enough.
  const simReady = `(() => {
    const area = document.getElementById('salesArea');
    const unit = document.getElementById('unitId');
    return !!area && !area.disabled && area.options.length > 1
      && !!unit && !unit.disabled
      && /^\\d{4}-\\d{2}-\\d{2}$/.test(document.querySelector('[data-order-date]')?.textContent.trim() ?? '')
      && !!$picker(0);
  })()`;
  const orderReady = "!!document.querySelector('[data-sales-order]') || !!document.querySelector('[data-problem]')";
  const ids = fixtures.conditions;
  const orderCount = () => Number(sql("SELECT count(*) FROM sales_orders"));

  page.extraHelpers = SUITE_HELPERS;
  page.diagnostics = FORM_STATE;
  page.record(/^\/api\/erp\/sales-orders$/);
  await page.intercept(["*/api/erp/sales-orders", "*/api/erp/sales-areas"]);
  const created = () => page.recorded;
  const formState = () => evaluate(`JSON.stringify(${FORM_STATE})`);

  const pick = async (index, query, materialNumber) => {
    await evaluate(`$picker(${index}).focus(); $setEl($picker(${index}), ${JSON.stringify(query)})`);
    await waitFor(`$options().includes('${materialNumber}')`, `option ${materialNumber}`);
    await evaluate(`document.querySelector('[role=option][data-material="${materialNumber}"]').click()`);
    await waitFor(`!document.querySelector('[role=listbox]') && $picker(${index}).value.startsWith('${materialNumber}')`, `picked ${materialNumber}`);
  };
  const setQty = (index, value) => evaluate(`$setEl($qty(${index}), '${value}')`);
  /** Enters an order (on the simulation page, opened unless navigate is false) */
  const enterOrder = async ({
    salesArea = "1000/10/00",
    unit = "UNIT-STUTTGART",
    items = [["heat", "MAT-001", "2"], ["thermo", "MAT-002", "10"]],
    note = "",
    navigate = true,
  } = {}) => {
    if (navigate) await goto(SIM, simReady);
    await waitFor(simReady, "simulation form ready");
    await page.select("salesArea", salesArea, `[...document.getElementById('unitId').options].some(o => o.value === '${unit}')`);
    await page.select("unitId", unit, "document.getElementById('shipToCustomerNumber').value !== ''");
    await evaluate("$setEl(document.getElementById('customerReference'), 'PO-STR-2026-118')");
    if (note) await evaluate(`$setEl(document.getElementById('customerNote'), ${JSON.stringify(note)})`);
    for (const [index, [query, material, qty]] of items.entries()) {
      if (index > 0) {
        await evaluate("$btn('Add item').click()");
        await waitFor(`$items().length === ${index + 1}`, "next row");
      }
      await pick(index, query, material);
      await setQty(index, qty);
    }
  };
  /**
   * Simulates and waits for the result of THIS click: its request has
   * finished and the form shows a current result again. (A repeated
   * simulation of the same input looks current before its answer arrives.)
   */
  const simulate = async () => {
    const before = page.finishedCount(SIMULATE_PATH);
    await evaluate("$btn('Simulate Order').click()");
    await waitFor(
      async () =>
        page.finishedCount(SIMULATE_PATH) > before &&
        (await evaluate("!!$status() && !$outdated() && !!$btn('Simulate Order') && !$btn('Simulate Order').disabled && !!$create()")),
      "simulation result of this click",
      20_000,
    );
  };
  /** Clicks Create Sales Order and confirms in the dialog */
  const createAndConfirm = async () => {
    await waitFor("!!$create() && !$create().disabled", "create enabled");
    await evaluate("$create().click()");
    await waitFor("!!$confirm()", "confirmation dialog");
    await evaluate("$confirm().click()");
  };
  const waitForOrderPage = async () => {
    await waitFor("location.pathname.startsWith('/sales-orders/1') && !!document.querySelector('[data-sales-order]')", "order page", 20_000);
    await page.installHelpers();
    return evaluate("location.pathname.split('/').pop()");
  };

  check("Test database starts without sales orders", orderCount() === 0, String(orderCount()));

  // ---------------------------------------------------------------- readiness
  section("Form readiness: the sales areas arrive after the B2B units");
  // Reproduces the cause of a former flaky failure: the units were already
  // listed, the sales areas not yet, and a selection was lost
  let releaseSalesAreas;
  const salesAreasHeld = new Promise((resolve) => (releaseSalesAreas = resolve));
  page.once("request", (p) => salesAreasHeld.then(() => page.send("Fetch.continueRequest", { requestId: p.requestId })), "GET");
  await goto(SIM, "document.getElementById('unitId')?.options.length > 1");
  check("While the sales areas load, their selector is disabled and the form is not ready", await evaluate(`document.getElementById('salesArea').disabled && !(${simReady})`), await formState());
  releaseSalesAreas();
  await enterOrder({ navigate: false });
  check("Sales area and B2B unit stay selected once the sales areas arrive", await evaluate("document.getElementById('salesArea').value === '1000/10/00' && document.getElementById('unitId').value === 'UNIT-STUTTGART'"), await formState());

  // ---------------------------------------------------------------- create
  section("Create a sales order and confirm it");
  await enterOrder();
  check("Create is not offered before a simulation", !(await evaluate("!!$create()")));
  await simulate();
  check("Simulation VALID, 10,695.00 EUR", (await evaluate("$status()")) === "VALID" && (await evaluate("$total()")).includes("10,695.00 EUR"), await evaluate("$total()"));
  check("Create Sales Order enabled for the current simulation", await evaluate("!$create().disabled"));
  check("Simulating alone stored nothing", orderCount() === 0);
  await evaluate("$create().click()");
  await waitFor("!!$confirm()", "dialog");
  const summary = await evaluate("$text('[data-confirm-summary]')");
  check("Confirmation step shows positions, prices and net total", summary.includes("MAT-001") && summary.includes("4,400.00 EUR") && summary.includes("189.50 EUR") && summary.includes("10,695.00 EUR") && summary.includes("excl. VAT and freight"), summary);
  check("Confirmation warns that the order is permanent", (await evaluate("$text('[data-confirm-warning]')")).includes("cannot be changed or deleted"));
  check("The focus is on Cancel (safe choice)", await evaluate("document.activeElement?.textContent.trim() === 'Cancel'"));
  await page.screenshot("confirm-dialog.png");
  await evaluate("[...$dialog().querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel').click()");
  await waitFor("!$dialog()", "dialog closed");
  check("Cancel sends nothing", created().length === 0 && orderCount() === 0);
  await createAndConfirm();
  const n1 = await waitForOrderPage();
  const body1 = created()[0];
  check("Order 1000000001 created and confirmation opened", n1 === "1000000001" && (await evaluate("location.search")) === "?created=new", `${n1} ${await evaluate("location.search")}`);
  check("Request uses the exact backend contract", JSON.stringify(Object.keys(body1)) === JSON.stringify(["requestId", "salesOrganization", "distributionChannel", "division", "unitId", "shipToCustomerNumber", "requestedDeliveryDate", "requestedShippingMethod", "customerReference", "customerNote", "items", "expectedTotal"]) && /^[0-9a-f-]{36}$/.test(body1.requestId), JSON.stringify(body1));
  check("Prices copied as text from the simulation, item order and quantities kept", JSON.stringify(body1.items) === JSON.stringify([{ materialNumber: "MAT-001", quantity: 2, expectedUnitPrice: "4400.00" }, { materialNumber: "MAT-002", quantity: 10, expectedUnitPrice: "189.50" }]) && JSON.stringify(body1.expectedTotal) === JSON.stringify({ netValue: "10695.00", currency: "EUR" }), JSON.stringify(body1.items));
  check("No pricing date sent (server order date)", !("pricingDate" in body1));
  check("Success notice", (await evaluate("$text('[data-created-notice]')")).includes("Sales order 1000000001 was created."));
  const header1 = await evaluate("$text('section[aria-label=\"Order header\"]')");
  check("Header: number, OPEN, sales area, currency, unit, reference, time zone", header1.includes("1000000001") && header1.includes("Open") && header1.includes("1000/10/00") && header1.includes("EUR") && header1.includes("UNIT-STUTTGART") && header1.includes("PO-STR-2026-118") && header1.includes("Europe/Berlin"), header1);
  const partners1 = await evaluate("[...document.querySelectorAll('[data-order-partner]')].map(p => p.dataset.orderPartner + ':' + p.textContent.replace(/\\s+/g,' ').trim()).join(' | ')");
  check("Partners Sold-to/Ship-to/Bill-to/Payer with address snapshots", partners1.includes("soldTo:Sold-to (SP)CUST-1000Müller Heiztechnik GmbH") && partners1.includes("shipTo:Ship-to (SH)CUST-1100Müller Heiztechnik – Lager Stuttgart") && partners1.includes("Hafenstraße 25") && partners1.includes("payer:"), partners1);
  const items1 = await evaluate("[...document.querySelectorAll('[data-order-item]')].map(r => r.textContent.replace(/\\s+/g,' ').trim())");
  check("Items with descriptions, quantities, unit prices, conditions and net values", items1[0].includes("MAT-001") && items1[0].includes("Heat Pump") && items1[0].includes("ZP03") && items1[0].includes(`condition ${ids.specialMat001}`) && items1[0].includes("8,800.00 EUR") && items1[1].includes("ZP02") && items1[1].includes(`condition ${ids.soldToMat002}`) && items1[1].includes("1,895.00 EUR"), JSON.stringify(items1));
  check("Total 10,695.00 EUR net excl. VAT and freight", (await evaluate("$text('[data-order-total]')")) === "Net value 10,695.00 EUR excl. VAT and freight", await evaluate("$text('[data-order-total]')"));
  check("Order information lists net values and unchecked topics", (await evaluate("$text('[data-order-notes]')")).includes("excluding tax and freight"));
  check("No delivery block without note", !(await evaluate("!!document.querySelector('[data-delivery-block]')")));
  await page.screenshot("confirmation.png");
  check("Exactly one order in the test database", orderCount() === 1);

  // ---------------------------------------------------------------- back to the simulation
  section("Back to the simulation after a created order, without reload");
  await evaluate("window.$noReload = 'same page load'");
  /** The simulation is usable for a new order: nothing locked */
  const usable = () =>
    evaluate("!document.querySelector('fieldset[data-locked]') && !document.querySelector('form fieldset').disabled && !$btn('Simulate Order').disabled && !$btn('Reset').disabled && !document.querySelector('[data-creation-state]')");
  await evaluate("[...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'New Order Simulation').click()");
  await waitFor("location.pathname === '/sales-orders/simulation' && !!document.getElementById('unitId')", "simulation via link");
  await page.installHelpers();
  check("Link 'New Order Simulation': no reload (client-side navigation)", (await evaluate("window.$noReload")) === "same page load");
  check("Form usable, not locked, Simulate and Reset enabled", await usable(), await evaluate("JSON.stringify({ locked: !!document.querySelector('fieldset[data-locked]'), simulate: $btn('Simulate Order')?.disabled, state: document.querySelector('[data-creation-state]')?.dataset.creationState ?? null })"));
  check("A new, empty order: no unit, one empty item, no old result", (await evaluate("document.getElementById('unitId').value")) === "" && (await evaluate("$items().length")) === 1 && (await evaluate("$picker(0).value")) === "" && !(await evaluate("!!$status()")));
  check("Notice about the created order with a link to it", (await evaluate("document.querySelector('[data-creation-created]')?.dataset.creationCreated")) === "1000000001" && (await evaluate("!!document.querySelector('[data-creation-created] a[href=\"/sales-orders/1000000001\"]')")));
  page.recorded = [];
  const beforeSecond = orderCount();
  await enterOrder({ navigate: false, note: "Second order without reload" });
  check("Changing the form removes the notice", !(await evaluate("!!document.querySelector('[data-creation-created]')")));
  await simulate();
  check("Second simulation works: VALID_WITH_WARNINGS, 10,695.00 EUR", (await evaluate("$status()")) === "VALID_WITH_WARNINGS" && (await evaluate("$total()")).includes("10,695.00 EUR"));
  await createAndConfirm();
  const nSecond = await waitForOrderPage();
  check("Second order created without reload, exactly one request and one order", (await evaluate("window.$noReload")) === "same page load" && created().length === 1 && orderCount() === beforeSecond + 1 && nSecond === "1000000002", `${nSecond}, ${created().length} requests`);
  await evaluate("history.back()");
  await waitFor("location.pathname === '/sales-orders/simulation' && !!document.getElementById('unitId')", "simulation via browser back");
  await page.installHelpers();
  check("Browser back: no reload, form usable and empty", (await evaluate("window.$noReload")) === "same page load" && (await usable()) && (await evaluate("document.getElementById('unitId').value")) === "");
  await enterOrder({ navigate: false });
  await simulate();
  check("Browser back: a new simulation can be created", (await evaluate("$status()")) === "VALID" && (await evaluate("!$create().disabled")));
  await evaluate("[...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Pricing').click()");
  await waitFor("location.pathname === '/pricing'", "pricing via sidebar");
  await evaluate("[...document.querySelectorAll('nav a')].find(a => a.textContent.includes('Sales Orders')).click()");
  await waitFor("location.pathname === '/sales-orders/simulation' && !!document.getElementById('unitId')", "simulation via sidebar");
  await page.installHelpers();
  check("Sidebar 'Sales Orders': no reload, form usable", (await evaluate("window.$noReload")) === "same page load" && (await usable()));

  // ---------------------------------------------------------------- confirmation page
  section("Confirmation page by URL and snapshots");
  await goto(`${BASE}/sales-orders/1000000001`, orderReady);
  check("Direct URL renders the order (no notice)", (await evaluate("!!document.querySelector('[data-sales-order=\"1000000001\"]')")) && !(await evaluate("!!document.querySelector('[data-created-notice]')")));
  await api("PATCH", "/customers/CUST-1000", { name: "Renamed AG", street: "Neue Straße 1" });
  await api("PATCH", "/materials/MAT-001", { description: "Renamed Pump" });
  await api("PATCH", `/price-conditions/${ids.specialMat001}`, { amount: "3999.00" });
  await goto(`${BASE}/sales-orders/1000000001`, orderReady);
  const snapshot = await evaluate("document.querySelector('[data-sales-order]').textContent");
  check("Snapshots: later master data and price changes do not change the confirmation", snapshot.includes("Müller Heiztechnik GmbH") && snapshot.includes("Heat Pump") && snapshot.includes("8,800.00 EUR") && !snapshot.includes("Renamed") && !snapshot.includes("3,999.00"));
  await api("PATCH", "/customers/CUST-1000", { name: "Müller Heiztechnik GmbH", street: "Industriestraße 10" });
  await api("PATCH", "/materials/MAT-001", { description: "Heat Pump" });
  await api("PATCH", `/price-conditions/${ids.specialMat001}`, { amount: "4400.00" });
  await goto(`${BASE}/sales-orders/abc`, orderReady);
  check("Invalid number: clear message, no request", (await evaluate("document.querySelector('[data-problem]')?.dataset.problem")) === "invalid");
  await goto(`${BASE}/sales-orders/1000009999`, orderReady);
  check("Unknown number: not found", (await evaluate("document.querySelector('[data-problem]')?.dataset.problem")) === "not-found");
  await goto(`${urls.deadBackoffice}/sales-orders/1000000001`, "document.body.textContent.includes('could not be loaded')");
  check("ERP API down: error with retry", await evaluate("!!$btn('Retry')"));
  await goto(`${BASE}/sales-orders/1000000001`, orderReady);
  await page.send("Emulation.setEmulatedMedia", { media: "print" });
  check("Print: sidebar, header and actions hidden, document visible", await evaluate("getComputedStyle(document.querySelector('aside')).display === 'none' && getComputedStyle(document.querySelector('header')).display === 'none' && !$vis(document.querySelector('[data-print]')) && $vis(document.querySelector('[data-order-total]'))"));
  await page.screenshot("print.png");
  await page.send("Emulation.setEmulatedMedia", { media: "" });
  check("Print Confirmation button present", await evaluate("!!document.querySelector('[data-print]')"));

  // ---------------------------------------------------------------- customer note
  section("Customer note: VALID_WITH_WARNINGS and SALES_REVIEW");
  page.recorded = [];
  await enterOrder({ note: "Please deliver to Gate 3." });
  await simulate();
  check("Simulation VALID_WITH_WARNINGS", (await evaluate("$status()")) === "VALID_WITH_WARNINGS");
  await evaluate("$create().click()");
  await waitFor("!!$confirm()", "dialog");
  check("Dialog announces delivery block SALES_REVIEW", (await evaluate("$text('[data-confirm-summary]')")).includes("SALES_REVIEW"));
  await evaluate("$confirm().click()");
  const nNote = await waitForOrderPage();
  check("Order created with delivery block SALES_REVIEW and the note", (await evaluate("document.querySelector('[data-delivery-block]')?.dataset.deliveryBlock")) === "SALES_REVIEW" && (await evaluate("$text('[data-customer-note]')")).includes("Gate 3"), nNote);

  // ---------------------------------------------------------------- duplicate clicks
  section("Duplicate clicks");
  page.recorded = [];
  await enterOrder();
  await simulate();
  await evaluate("$create().click(); $create().click()");
  await waitFor("!!$confirm()", "dialog");
  check("Double click on Create opens one dialog", (await evaluate("document.querySelectorAll('[role=dialog]').length")) === 1);
  const beforeDouble = orderCount();
  await evaluate("const b = $confirm(); b.click(); b.click(); b.click();");
  await waitForOrderPage();
  check("Triple click on confirm: one request, exactly one order", created().length === 1 && orderCount() === beforeDouble + 1, `${created().length} requests, ${orderCount() - beforeDouble} orders`);

  // ---------------------------------------------------------------- idempotent retry
  section("Lost answer and 504: retry with the same request");
  page.recorded = [];
  await enterOrder();
  await simulate();
  const beforeLost = orderCount();
  // The ERP API stores the order, but the answer never reaches the browser
  page.once("response", (p) => page.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "ConnectionReset" }));
  await createAndConfirm();
  await waitFor("$outcome() === 'retry-UNCERTAIN'", "uncertain result");
  check("Unknown result is explained, the order exists in the test database", (await evaluate("$outcomeText()")).includes("Result unknown") && orderCount() === beforeLost + 1, await evaluate("$outcomeText()"));
  check("Input, Simulate and Create are locked", await evaluate("document.querySelector('fieldset[data-locked]')?.disabled === true && $btn('Simulate Order').disabled && $create().disabled"));
  check("The request ID is shown", (await evaluate("$text('[data-request-id]')")) === created()[0].requestId);
  await evaluate("document.querySelector('[data-retry]').click()");
  await waitForOrderPage();
  check("Retry sent the identical request (same requestId, same body)", created().length === 2 && JSON.stringify(created()[0]) === JSON.stringify(created()[1]));
  check("Repeated request answered 200: existing order, no second one", (await evaluate("location.search")) === "?created=existing" && orderCount() === beforeLost + 1 && (await evaluate("$text('[data-created-notice]')")).includes("no second order was created"));

  page.recorded = [];
  await enterOrder();
  await simulate();
  const before504 = orderCount();
  // The order is stored, but the proxy answers 504 (did not answer in time)
  page.once("response", (p) => page.send("Fetch.fulfillRequest", { requestId: p.requestId, ...jsonAnswer(504, { statusCode: 504, message: "The ERP API did not answer in time. The request may still have been processed." }) }));
  await createAndConfirm();
  await waitFor("$outcome() === 'retry-UNCERTAIN'", "504 uncertain");
  check("504 is treated as an unknown result", orderCount() === before504 + 1);
  // A reload must not lose the pending request
  await goto(SIM, "$outcome() === 'retry-UNCERTAIN'");
  check("After a reload the pending request is still offered for retry", (await evaluate("$text('[data-request-id]')")) === created()[0].requestId && (await evaluate("document.querySelector('fieldset[data-locked]')?.disabled === true")));
  await evaluate("document.querySelector('[data-retry]').click()");
  await waitForOrderPage();
  check("Retry after reload: same request, existing order, exactly one", JSON.stringify(created()[0]) === JSON.stringify(created()[1]) && orderCount() === before504 + 1 && (await evaluate("location.search")) === "?created=existing");
  await goto(SIM, simReady);
  check("After success the pending request is gone", !(await evaluate("!!$outcome()")) && !(await evaluate("!!document.querySelector('fieldset[data-locked]')")));

  // ---------------------------------------------------------------- price change
  section("Price change: PRICE_CHANGED and reconfirmation");
  page.recorded = [];
  await enterOrder();
  await simulate();
  await api("PATCH", `/price-conditions/${ids.soldToMat002}`, { amount: "190.00" });
  const beforePrice = orderCount();
  await createAndConfirm();
  await waitFor("$outcome() === 'price-changed'", "price changed");
  const changedText = await evaluate("$outcomeText()");
  check("PRICE_CHANGED explained: item 20 confirmed 189.50, now 190.00", changedText.includes("Prices have changed") && (await evaluate("$text('[data-changed-item=\"20\"]')")).includes("189.50 EUR") && (await evaluate("$text('[data-changed-item=\"20\"]')")).includes("190.00 EUR"), changedText);
  check("The changed item is highlighted in the current result", await evaluate("document.querySelector('tr[data-result-item=\"20\"]').dataset.priceChanged === 'true' && !document.querySelector('tr[data-result-item=\"10\"]').dataset.priceChanged"));
  check("Result shows the new total 10,700.00 EUR; nothing stored", (await evaluate("$total()")).includes("10,700.00 EUR") && orderCount() === beforePrice, await evaluate("$total()"));
  const inView = "(() => { const r = document.querySelector('[data-creation-outcome]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()";
  check("The PRICE_CHANGED answer is scrolled into view", await page.becomes(inView, 2500));
  check("No automatic resubmission", created().length === 1);
  await evaluate("$create().click()");
  await waitFor("!!$confirm()", "reconfirmation dialog");
  check("Reconfirmation dialog shows the new prices", (await evaluate("$text('[data-confirm-summary]')")).includes("10,700.00 EUR"));
  await evaluate("$confirm().click()");
  await waitForOrderPage();
  check("New attempt with a new requestId and the new prices", created().length === 2 && created()[1].requestId !== created()[0].requestId && created()[1].items[1].expectedUnitPrice === "190.00" && created()[1].expectedTotal.netValue === "10700.00");
  check("Order stored with 190.00", (await evaluate("$text('[data-order-total]')")).includes("10,700.00 EUR") && orderCount() === beforePrice + 1);
  await api("PATCH", `/price-conditions/${ids.soldToMat002}`, { amount: "189.50" });

  // ---------------------------------------------------------------- stale simulation
  section("Form changes invalidate the simulation");
  page.recorded = [];
  await enterOrder();
  await simulate();
  await setQty(1, "11");
  check("Changed quantity: result outdated, Create disabled with reason", await page.becomes("$outdated() && $create().disabled && ($blocker() ?? '').includes('input has changed')", 5000), await formState());
  await setQty(1, "10");
  check("The simulated quantity again: the result is current again", await page.becomes("!$outdated() && !$create().disabled", 5000), await formState());
  await evaluate("$setEl(document.getElementById('customerReference'), 'PO-OTHER')");
  check("Changed header field also blocks creation", await page.becomes("$outdated() && $create().disabled", 5000), await formState());
  await simulate();
  check("A fresh simulation enables Create again", await evaluate("!$create().disabled && $blocker() === null"));
  check("Nothing was sent meanwhile", created().length === 0);

  // ---------------------------------------------------------------- ORDER_INVALID
  section("ORDER_INVALID: unit deactivated after the simulation");
  page.recorded = [];
  await enterOrder();
  await simulate();
  await api("PATCH", "/b2b-units/UNIT-STUTTGART", { isActive: false });
  const beforeInvalid = orderCount();
  await createAndConfirm();
  await waitFor("$outcome() === 'invalid'", "invalid");
  check("422 shown, result now INVALID with the error at the unit", (await evaluate("$status()")) === "INVALID" && (await evaluate("document.body.textContent.includes('B2B unit UNIT-STUTTGART is inactive.')")) && orderCount() === beforeInvalid);
  check("Create disabled for the invalid result", await evaluate("$create().disabled"));
  await api("PATCH", "/b2b-units/UNIT-STUTTGART", { isActive: true });

  // ---------------------------------------------------------------- IDEMPOTENCY_KEY_REUSED
  section("IDEMPOTENCY_KEY_REUSED");
  page.recorded = [];
  const firstRequestId = (await api("GET", "/sales-orders/1000000001")).body.requestId;
  await enterOrder({ items: [["heat", "MAT-001", "3"]] });
  await simulate();
  const beforeReused = orderCount();
  // The request ID of order 1000000001 with other data (as if an ID were reused)
  page.once("request", (p) =>
    page.send("Fetch.continueRequest", {
      requestId: p.requestId,
      postData: Buffer.from(JSON.stringify({ ...JSON.parse(p.request.postData), requestId: firstRequestId })).toString("base64"),
    }),
  );
  await createAndConfirm();
  await waitFor("$outcome() === 'reused'", "reused");
  check("Reused request ID: explained, link to the existing order, nothing created", (await evaluate("$outcomeText()")).includes("already used") && (await evaluate("!!document.querySelector('[data-creation-outcome] a[href=\"/sales-orders/1000000001\"]')")) && orderCount() === beforeReused);
  check("No new request is sent silently", created().length === 1);

  // ---------------------------------------------------------------- CONCURRENT_UPDATE
  section("CONCURRENT_UPDATE: automatic retry with the same request");
  page.recorded = [];
  await enterOrder();
  await simulate();
  const beforeConcurrent = orderCount();
  page.once("request", (p) =>
    page.send("Fetch.fulfillRequest", {
      requestId: p.requestId,
      ...jsonAnswer(409, { statusCode: 409, code: "CONCURRENT_UPDATE", message: ["The order data was changed at the same time. Nothing was stored; send the same request again."] }),
    }),
  );
  await createAndConfirm();
  await waitForOrderPage();
  check("Retried automatically with the identical request; one order", created().length === 2 && JSON.stringify(created()[0]) === JSON.stringify(created()[1]) && orderCount() === beforeConcurrent + 1 && (await evaluate("location.search")) === "?created=new");

  // ---------------------------------------------------------------- markets
  section("Poland (no prices) and Japan (JPY)");
  await enterOrder({ salesArea: "2000/10/00", unit: "UNIT-WARSZAWA", items: [["heat", "MAT-001", "2"]] });
  await simulate();
  check("Poland without prices: INVALID, no invented price, Create disabled", (await evaluate("$status()")) === "INVALID" && (await evaluate("document.body.textContent.includes('No price found for material MAT-001 in sales area 2000/10/00')")) && (await evaluate("$create().disabled")));
  await api("POST", "/price-conditions", { conditionTypeCode: "ZP01", salesOrganization: "2000", distributionChannel: "10", division: "00", materialNumber: "MAT-001", scope: "SALES_AREA", amount: "4400.00", validFrom: "2026-01-01" });
  await simulate();
  check("Poland with a PLN list price: 8,800.00 PLN", (await evaluate("$total()")).includes("8,800.00 PLN"), await evaluate("$total()"));
  await createAndConfirm();
  await waitForOrderPage();
  check("PLN order: 4,400.00 PLN each, 8,800.00 PLN total, Europe/Warsaw", (await evaluate("$text('[data-order-item=\"10\"]')")).includes("4,400.00 PLN") && (await evaluate("$text('[data-order-total]')")).includes("8,800.00 PLN") && (await evaluate("$text('section[aria-label=\"Order header\"]')")).includes("Europe/Warsaw"));
  page.recorded = [];
  await enterOrder({ salesArea: "3000/10/00", unit: "UNIT-OSAKA", items: [["heat", "MAT-001", "2"]] });
  await simulate();
  check("Japan: 1,400,000 JPY without decimals", (await evaluate("$total()")).includes("1,400,000 JPY"), await evaluate("$total()"));
  await createAndConfirm();
  await waitForOrderPage();
  check("JPY request sends whole amounts as text", created()[0].items[0].expectedUnitPrice === "700000" && created()[0].expectedTotal.netValue === "1400000" && created()[0].expectedTotal.currency === "JPY");
  check("JPY order: 700,000 JPY each, 1,400,000 JPY total, Asia/Tokyo", (await evaluate("$text('[data-order-item=\"10\"]')")).includes("700,000 JPY") && (await evaluate("$text('[data-order-total]')")).includes("1,400,000 JPY") && (await evaluate("$text('section[aria-label=\"Order header\"]')")).includes("Asia/Tokyo"));

  // ---------------------------------------------------------------- proxy
  section("Proxy security restrictions");
  const proxy = await evaluate(`Promise.all([
    fetch('/api/erp/sales-orders').then(r => r.status + ' ' + r.headers.get('Allow')),
    fetch('/api/erp/sales-orders', { method: 'PUT', body: '{}' }).then(r => r.status + ' ' + r.headers.get('Allow')),
    fetch('/api/erp/sales-orders/1000000001', { method: 'DELETE' }).then(r => r.status + ' ' + r.headers.get('Allow')),
    fetch('/api/erp/sales-orders/1000000001', { method: 'PATCH', body: '{}' }).then(r => r.status + ' ' + r.headers.get('Allow')),
    fetch('/api/erp/sales-orders/1000000001/delivery-block/release', { method: 'POST' }).then(r => String(r.status)),
    fetch('/api/erp/sales-orders/abc').then(r => String(r.status)),
    fetch('/api/erp/sales-orders/simulate').then(r => r.status + ' ' + r.headers.get('Allow')),
  ]).then(a => a.join(' | '))`);
  check("No list, no change, no delete, no release, only 10-digit numbers", proxy === "405 POST | 405 POST | 405 GET | 405 GET | 404 | 404 | 405 POST", proxy);
  check("Nothing was changed by the blocked requests", orderCount() === 10);
  await goto(`${BASE}/pricing`, "document.querySelectorAll('tr[data-condition]').length >= 8");
  check("Pricing still loads", true);
  await goto(`${BASE}/sales-orders`, "location.pathname === '/sales-orders/simulation'");
  check("/sales-orders still opens the simulation", true);

  // ---------------------------------------------------------------- mobile
  section("Mobile 390px");
  await page.viewport(390, 844, true);
  await enterOrder();
  await simulate();
  check("Simulation with create panel fits 390px", !(await evaluate("$overflow()")), String(await evaluate("document.documentElement.scrollWidth")));
  await evaluate("$create().click()");
  await waitFor("!!$confirm()", "mobile dialog");
  check("Confirmation dialog fits 390px", await evaluate("$dialog().getBoundingClientRect().width <= 390 && !$overflow()"));
  await evaluate("[...$dialog().querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel').click()");
  await goto(`${BASE}/sales-orders/1000000001`, orderReady);
  check("Confirmation page fits 390px", !(await evaluate("$overflow()")), String(await evaluate("document.documentElement.scrollWidth")));
  await page.viewport(1440, 900);

  check("Orders in the test database: exactly one per successful creation", orderCount() === 10, String(orderCount()));
  check("No uncaught page errors in the whole run", page.pageErrors.length === 0, page.pageErrors.join(" | "));
}
