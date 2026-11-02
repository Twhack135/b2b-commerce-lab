// The sales order overview (Sprint 10D-B). Two parts:
// - emptyOverviewSuite runs first, while the test database has no orders
// - salesOrderOverviewSuite runs after the other suites and creates its own
//   orders through the ERP API of the test environment (München, Poland,
//   Japan), so its expectations do not depend on orders of other suites:
//   wherever all orders are counted, the expected values come from the API.

import { randomUUID } from "node:crypto";
import { jsonAnswer } from "../lib/browser.mjs";

const SUITE_HELPERS = `
  window.$state = () => document.querySelector('[data-overview-state]')?.dataset.overviewState ?? null;
  window.$rows = () => [...document.querySelectorAll('[data-order-row]')].filter($vis).map(r => r.dataset.orderRow);
  window.$cards = () => [...document.querySelectorAll('[data-order-card]')].filter($vis).map(c => c.dataset.orderCard);
  window.$row = (n) => document.querySelector('[data-order-row="' + n + '"]');
  window.$page = () => document.querySelector('[data-page]')?.dataset.page ?? null;
  window.$total = () => document.querySelector('[data-total]')?.dataset.total ?? null;
  window.$search = () => document.querySelector('input[type=search]');
  window.$pager = (name) => document.querySelector('[data-' + name + '-page]');
`;

const OVERVIEW_STATE = `({
  state: document.querySelector('[data-overview-state]')?.dataset.overviewState ?? null,
  search: location.search,
  rows: [...document.querySelectorAll('[data-order-row],[data-order-card]')].filter(e => !!e.offsetParent).length,
  page: document.querySelector('[data-page]')?.dataset.page ?? null,
  total: document.querySelector('[data-total]')?.dataset.total ?? null,
  ignored: document.querySelector('[data-ignored-parameters]')?.dataset.ignoredParameters ?? null,
})`;

function prepare(page) {
  page.extraHelpers = SUITE_HELPERS;
  page.diagnostics = OVERVIEW_STATE;
}

/** The overview of an empty database, and of filters in the URL */
export async function emptyOverviewSuite({ page, sql, urls, check, section }) {
  prepare(page);
  const BASE = urls.backoffice;
  check("Test database has no sales orders yet", sql("SELECT count(*) FROM sales_orders") === "0");

  section("Overview without any sales order");
  await page.goto(`${BASE}/sales-orders`, "$state() === 'no-orders'");
  check("'No sales orders yet' with a way to the simulation", (await page.evaluate("$text('[data-overview-state]')")).includes("No sales orders yet") && (await page.evaluate("!!document.querySelector('[data-overview-state] a[href=\"/sales-orders/simulation\"]')")));
  check("Heading 'Sales Orders' and action 'New Order Simulation'", (await page.evaluate("document.querySelector('h1').textContent")) === "Sales Orders" && (await page.evaluate("[...document.querySelectorAll('main a')].some(a => a.textContent.trim() === 'New Order Simulation' && a.getAttribute('href') === '/sales-orders/simulation')")));

  await page.goto(`${BASE}/sales-orders?q=nothing`, "$state() === 'no-matches'");
  check("With a search, 'no matches' instead of 'no orders'", (await page.evaluate("$text('[data-overview-state]')")).includes("No sales orders match your search and filters"));
  await page.evaluate("[...document.querySelectorAll('[data-overview-state] button')].find(b => b.textContent.trim() === 'Clear filters').click()");
  await page.waitFor("location.search === '' && $state() === 'no-orders'", "filters cleared");
  check("Clear filters returns to the plain overview", true);
}

/** Search, filters, pagination, navigation and errors with stored orders */
export default async function salesOrderOverviewSuite({ page, api, urls, check, section }) {
  prepare(page);
  const BASE = urls.backoffice;
  const evaluate = (expression) => page.evaluate(expression);
  const waitFor = (condition, label, timeout) => page.waitFor(condition, label, timeout);
  const LIST_PATH = "/api/erp/sales-orders";
  await page.intercept(["*/api/erp/sales-orders", "*/api/erp/sales-orders?*"]);

  /** The list as the ERP API returns it (read-only), for expected values */
  const apiList = async (query) => {
    const response = await api("GET", `/sales-orders?${new URLSearchParams({ limit: "100", ...query })}`);
    if (response.status !== 200) throw new Error(`GET /sales-orders answered ${response.status}`);
    return response.body;
  };
  const place = async (body) => {
    const response = await api("POST", "/sales-orders", { requestId: randomUUID(), ...body });
    if (response.status !== 201) throw new Error(`Creating an order answered ${response.status}: ${JSON.stringify(response.body)}`);
    return response.body.salesOrderNumber;
  };
  /** Opens the overview with this URL query and waits for its rows */
  const open = (query = "") =>
    page.goto(`${BASE}/sales-orders${query ? `?${query}` : ""}`, "['orders','no-matches','no-orders','page-empty','error'].includes($state())");
  /** Waits until the overview shows a loaded result for the URL */
  const settled = (condition, label) => waitFor(`['orders','no-matches','no-orders','page-empty','error'].includes($state()) && (${condition})`, label, 15_000);

  // ------------------------------------------------------------- test data
  section("Overview test data (München, Poland, Japan)");
  const GERMANY = { salesOrganization: "1000", distributionChannel: "10", division: "00" };
  const muenchen = [];
  for (let i = 1; i <= 26; i++) {
    const ref = `OV-${String(i).padStart(2, "0")}`;
    muenchen.push(
      await place({
        ...GERMANY,
        unitId: "UNIT-MUENCHEN",
        customerReference: ref,
        // Every fifth order has a customer note, so it gets a delivery block
        ...(i % 5 === 0 ? { customerNote: "Please review the delivery address" } : {}),
        items: [{ materialNumber: "MAT-001", quantity: 1, expectedUnitPrice: "4400.00" }],
        expectedTotal: { netValue: "4400.00", currency: "EUR" },
      }),
    );
  }
  const polish = await place({
    salesOrganization: "2000", distributionChannel: "10", division: "00",
    unitId: "UNIT-WARSZAWA",
    customerReference: "OV-PL",
    items: [{ materialNumber: "MAT-101", quantity: 3, expectedUnitPrice: "45.50" }],
    expectedTotal: { netValue: "136.50", currency: "PLN" },
  });
  const japanese = await place({
    salesOrganization: "3000", distributionChannel: "10", division: "00",
    unitId: "UNIT-OSAKA",
    customerReference: "OV-JP",
    items: [{ materialNumber: "MAT-001", quantity: 1, expectedUnitPrice: "700000" }],
    expectedTotal: { netValue: "700000", currency: "JPY" },
  });
  check("28 orders created in the test database", muenchen.length === 26 && !!polish && !!japanese);
  // Master data changes after the orders: the overview shows the snapshots
  await api("PATCH", "/customers/CUST-1000", { name: "Renamed AG" });
  await api("PATCH", "/b2b-units/UNIT-MUENCHEN", { name: "Renamed Unit" });

  // ------------------------------------------------------------- list
  section("All orders, newest first, from the order snapshots");
  const everything = await apiList({});
  await open();
  check("Page 1 lists the newest 25 orders and the total", JSON.stringify(await evaluate("$rows()")) === JSON.stringify(everything.items.slice(0, 25).map((o) => o.salesOrderNumber)) && (await evaluate("$total()")) === String(everything.total) && (await evaluate("$page()")) === "1", await evaluate(`JSON.stringify(${OVERVIEW_STATE})`));
  const ov05 = muenchen[4];
  const row05 = await evaluate(`$row('${ov05}').innerText.replace(/\\s+/g, ' ')`);
  check("Row: number, reference, date, Sold-to and unit snapshots, sales area, value, block, status", row05.includes(ov05) && row05.includes("Ref. OV-05") && row05.includes("CUST-1000") && row05.includes("Müller Heiztechnik GmbH") && row05.includes("UNIT-MUENCHEN") && row05.includes("Müller – München") && row05.includes("1000/10/00") && row05.includes("4,400.00 EUR") && row05.includes("Sales review") && row05.includes("Open"), row05);
  const row04 = await evaluate(`$row('${muenchen[3]}').innerText.replace(/\\s+/g, ' ')`);
  check("Order without customer note: no delivery block", row04.includes("None") && !row04.includes("Sales review"), row04);
  check("Current master data is not shown (renamed customer and unit)", !(await evaluate("document.querySelector('[data-overview-state]').innerText.includes('Renamed')")));
  check("No internal data: request ID, customer note, addresses", !(await evaluate("/requestId|Please review the delivery address|Hafenstraße|Werkstraße|[0-9a-f]{8}-[0-9a-f]{4}-/.test(document.querySelector('[data-overview-state]').innerText)")));
  await page.screenshot("overview.png");
  check("The order number links to the stored order", (await evaluate(`$row('${ov05}').querySelector('a').getAttribute('href')`)) === `/sales-orders/${ov05}`);

  // ------------------------------------------------------------- search
  section("Search");
  await evaluate(`$setEl($search(), '${ov05}')`);
  await settled(`location.search === '?q=${ov05}' && $state() === 'orders'`, "search by number");
  check("A 10-digit number finds exactly that order", JSON.stringify(await evaluate("$rows()")) === JSON.stringify([ov05]));
  await evaluate("$setEl($search(), 'ov-pl')");
  await settled("location.search === '?q=ov-pl' && $state() === 'orders'", "search by reference");
  check("Customer reference, case-insensitive; PLN with 2 decimals", JSON.stringify(await evaluate("$rows()")) === JSON.stringify([polish]) && (await evaluate(`$row('${polish}').innerText`)).includes("136.50 PLN"));
  await evaluate("$setEl($search(), 'OV-JP')");
  await settled("location.search === '?q=OV-JP' && $state() === 'orders'", "search JPY order");
  check("JPY without decimals", (await evaluate(`$row('${japanese}').innerText`)).includes("700,000 JPY"));
  const osaka = await apiList({ q: "osaka" });
  await evaluate("$setEl($search(), 'osaka')");
  await settled("location.search === '?q=osaka' && $state() === 'orders'", "search Sold-to name");
  check("Sold-to name (snapshot) finds the same orders as the ERP API", JSON.stringify(await evaluate("$rows()")) === JSON.stringify(osaka.items.map((o) => o.salesOrderNumber)) && osaka.items.length >= 1);
  await evaluate("$setEl($search(), 'Renamed')");
  await settled("$state() === 'no-matches'", "search current name");
  check("The current (renamed) name finds nothing; 'no matches', not 'no orders'", (await evaluate("$text('[data-overview-state]')")).includes("No sales orders match"));
  // Typing fast: only the text after the pause is searched
  page.requests = [];
  await evaluate("const s = $search(); for (const t of ['O', 'OV', 'OV-', 'OV-0', 'OV-05']) $setEl(s, t)");
  await settled("location.search === '?q=OV-05' && $state() === 'orders'", "debounced search");
  const typed = page.requests.filter((r) => r.method === "GET" && r.url.includes(`${LIST_PATH}?`)).map((r) => new URL(r.url).search);
  check("Typing fast sends one request for the final text (debounce)", JSON.stringify(typed) === JSON.stringify(["?q=OV-05"]), JSON.stringify(typed));
  await evaluate("$setEl($search(), '')");
  await settled("location.search === '' && $state() === 'orders'", "search cleared");

  // ------------------------------------------------------------- filters
  section("Filters");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'More filters').click()");
  await waitFor("!!document.getElementById('unitIdFilter')", "more filters");
  await evaluate("$setEl(document.getElementById('unitIdFilter'), 'UNIT-MUENCHEN')");
  await settled("location.search === '?unitId=UNIT-MUENCHEN' && $total() === '26'", "unit filter");
  check("B2B unit filter: 26 München orders, 25 on page 1", (await evaluate("$rows().length")) === 25 && JSON.stringify(await evaluate("$rows()")) === JSON.stringify([...muenchen].reverse().slice(0, 25)));
  await page.select("deliveryBlockFilter", "SALES_REVIEW", "$total() === '5'");
  check("With delivery block SALES_REVIEW: the 5 orders with a note (AND)", JSON.stringify(await evaluate("$rows()")) === JSON.stringify([25, 20, 15, 10, 5].map((i) => muenchen[i - 1])) && (await evaluate("location.search")) === "?unitId=UNIT-MUENCHEN&deliveryBlock=SALES_REVIEW");
  await page.select("deliveryBlockFilter", "NONE", "$total() === '21'");
  check("'No delivery block': the other 21", (await evaluate("$total()")) === "21");
  await page.select("deliveryBlockFilter", "", "$total() === '26'");
  await evaluate("$setEl(document.getElementById('unitIdFilter'), '')");
  await settled("location.search === ''", "unit filter removed");
  const poland = await apiList({ salesOrganization: "2000" });
  await page.select("salesAreaFilter", "2000", `$total() === '${poland.total}'`);
  check("Sales organization 2000: the Polish orders", JSON.stringify(await evaluate("$rows()")) === JSON.stringify(poland.items.map((o) => o.salesOrderNumber)) && (await evaluate("location.search")) === "?salesOrganization=2000");
  await page.select("salesAreaFilter", "1000/10/00", `$total() === '${(await apiList(GERMANY)).total}'`);
  check("Complete sales area 1000/10/00 in the URL", (await evaluate("location.search")) === "?salesOrganization=1000&distributionChannel=10&division=00");
  await page.select("salesAreaFilter", "", `$total() === '${everything.total}'`);
  const today = everything.items[0].orderDate;
  const dayBefore = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  await evaluate(`$setEl(document.getElementById('orderDateTo'), '${dayBefore}')`);
  await settled(`location.search === '?orderDateTo=${dayBefore}' && $state() === 'no-matches'`, "date to yesterday");
  check("Order date to yesterday: no matches", true);
  await evaluate(`$setEl(document.getElementById('orderDateFrom'), '${today}')`);
  await page.becomes("document.querySelector('[role=alert]')?.textContent.includes('before the start date')", 3000);
  check("A range that ends before it starts is explained and not applied", (await evaluate("$text('[role=alert]')")) === "The end date is before the start date." && !(await evaluate("location.search.includes('orderDateFrom')")));
  await evaluate("$setEl(document.getElementById('orderDateTo'), '')");
  await settled(`location.search === '?orderDateFrom=${today}' && $total() === '${everything.total}'`, "date from today");
  check("Order date from today: all orders of the test run", true);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear filters').click()");
  await settled(`location.search === '' && $total() === '${everything.total}'`, "filters cleared");
  check("Clear filters removes all filters", (await evaluate("document.getElementById('orderDateFrom').value")) === "");

  // ------------------------------------------------------------- pagination
  section("Pagination forward and back");
  await open("unitId=UNIT-MUENCHEN");
  const page1 = await evaluate("$rows()");
  await evaluate("$pager('next').click()");
  await settled("$page() === '2' && $state() === 'orders'", "page 2");
  const page2 = await evaluate("$rows()");
  check("Next: page 2 with the 26th order, range 26–26 of 26", JSON.stringify(page2) === JSON.stringify([muenchen[0]]) && (await evaluate("$text('[data-range]')")).includes("26–26 of 26") && (await evaluate("$pager('next').disabled")));
  check("No order repeated or missing across the pages", new Set([...page1, ...page2]).size === 26 && JSON.stringify([...page1, ...page2]) === JSON.stringify([...muenchen].reverse()));
  check("The URL keeps filter and cursor", (await evaluate("location.search")) === `?unitId=UNIT-MUENCHEN&after=${page1.at(-1)}`);
  await evaluate("$pager('previous').click()");
  await settled("$page() === '1' && $state() === 'orders'", "back to page 1");
  check("Previous: page 1 again, the same orders", JSON.stringify(await evaluate("$rows()")) === JSON.stringify(page1) && (await evaluate("$pager('previous').disabled")));
  await evaluate("$pager('next').click()");
  await settled("$page() === '2' && $state() === 'orders'", "page 2 again");
  await page.select("deliveryBlockFilter", "NONE", "$page() === '1' && $total() === '21'");
  check("Changing a filter on page 2 starts again on page 1", !(await evaluate("location.search.includes('after')")));
  await page.select("deliveryBlockFilter", "", "$total() === '26'");
  await page.select("pageSize", "100", "$rows().length === 26");
  check("100 per page: all 26 on one page, no Next", (await evaluate("location.search")) === "?unitId=UNIT-MUENCHEN&limit=100" && (await evaluate("$pager('next').disabled")));

  // ------------------------------------------------------------- navigation
  section("Open an order and come back");
  await open("unitId=UNIT-MUENCHEN&deliveryBlock=NONE&limit=10");
  await evaluate("$pager('next').click()");
  await settled("$page() === '2' && $state() === 'orders'", "page 2 of 3");
  const listUrl = await evaluate("location.search");
  const opened = (await evaluate("$rows()"))[0];
  await evaluate("window.$sameLoad = true");
  await evaluate(`$row('${opened}').querySelector('a').click()`);
  await waitFor(`location.pathname === '/sales-orders/${opened}' && !!document.querySelector('[data-sales-order]')`, "order opened");
  check("The order opens without a reload", await evaluate("window.$sameLoad === true"));
  await evaluate("history.back()");
  await settled(`location.search === '${listUrl}' && $page() === '2' && $state() === 'orders'`, "back to the overview");
  await page.installHelpers();
  check("Browser back: same filters, page 2 and the same orders", (await evaluate("$rows()"))[0] === opened && (await evaluate("document.getElementById('deliveryBlockFilter').value")) === "NONE" && (await evaluate("document.getElementById('unitIdFilter').value")) === "UNIT-MUENCHEN");
  await evaluate(`$row('${opened}').querySelector('a').click()`);
  await waitFor("!!document.querySelector('[data-back-to-overview]')", "order with back link");
  await evaluate("document.querySelector('[data-back-to-overview]').click()");
  await settled(`location.search === '${listUrl}' && $page() === '2'`, "back link");
  check("'Back to Sales Orders' returns to the same page", true);

  // Page 3: the URL holds the page history (prev), the API never gets it
  await open("unitId=UNIT-MUENCHEN&deliveryBlock=NONE&limit=5");
  await evaluate("$pager('next').click()");
  await settled("$page() === '2' && $state() === 'orders'", "page 2 of 5");
  await evaluate("$pager('next').click()");
  await settled("$page() === '3' && $state() === 'orders'", "page 3 of 5");
  const page3Url = await evaluate("location.search");
  const page3Rows = await evaluate("$rows()");
  page.requests = [];
  await evaluate("location.reload()");
  await waitFor("document.readyState === 'complete'", "reloaded");
  await page.installHelpers();
  await settled("$page() === '3' && $state() === 'orders'", "page 3 after reload");
  const reloadSent = page.requests.filter((r) => r.method === "GET" && r.url.includes(`${LIST_PATH}?`)).map((r) => new URL(r.url).search);
  check("Reload of a filtered page 3: same URL, filters, page and orders", (await evaluate("location.search")) === page3Url && JSON.stringify(await evaluate("$rows()")) === JSON.stringify(page3Rows) && (await evaluate("document.getElementById('deliveryBlockFilter').value")) === "NONE" && page3Url.includes("&prev="), page3Url);
  check("The page history (prev) is never sent to the ERP API", reloadSent.length === 1 && !reloadSent[0].includes("prev") && reloadSent[0] === page3Url.replace(/&prev=[^&]*/, ""), JSON.stringify(reloadSent));

  // ------------------------------------------------------------- new orders between pages
  section("Orders created while paging");
  await open("unitId=UNIT-MUENCHEN&limit=10");
  await evaluate("$pager('next').click()");
  await settled("$page() === '2'", "page 2");
  const before = await evaluate("$rows()");
  const newest = await place({
    ...GERMANY,
    unitId: "UNIT-MUENCHEN",
    customerReference: "OV-NEW",
    items: [{ materialNumber: "MAT-001", quantity: 1, expectedUnitPrice: "4400.00" }],
    expectedTotal: { netValue: "4400.00", currency: "EUR" },
  });
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Refresh').click()");
  await settled("$total() === '27'", "refreshed");
  check("Refresh on page 2: same orders (no shift), new total 27", JSON.stringify(await evaluate("$rows()")) === JSON.stringify(before));
  await evaluate("$pager('previous').click()");
  await settled("$page() === '1' && $state() === 'orders'", "page 1");
  check("The new order is at the top of page 1", (await evaluate("$rows()"))[0] === newest);

  // ------------------------------------------------------------- stale answers
  section("A late answer never replaces newer results");
  await open("unitId=UNIT-MUENCHEN");
  // The answer for "OV-0" (9 orders) is held back until the answer for
  // "OV-0" with delivery block SALES_REVIEW (only OV-05) is shown
  let releaseOld;
  const oldHeld = new Promise((resolve) => (releaseOld = resolve));
  page.once("response", (p) => oldHeld.then(() => page.send("Fetch.continueRequest", { requestId: p.requestId })), "GET");
  const finishedBefore = page.finishedCount(LIST_PATH);
  await evaluate("$setEl($search(), 'OV-0')");
  await waitFor("location.search.includes('q=OV-0')", "first query sent");
  await page.select("deliveryBlockFilter", "SALES_REVIEW", `$state() === 'orders' && JSON.stringify($rows()) === '${JSON.stringify([ov05])}'`);
  check("The answer of the newer filter is shown (OV-05 only)", true);
  releaseOld();
  await waitFor(async () => page.finishedCount(LIST_PATH) >= finishedBefore + 2, "old answer arrived");
  await page.becomes("$rows().length !== 1", 1000);
  check("After the old answer arrived, the newer result is still shown", JSON.stringify(await evaluate("$rows()")) === JSON.stringify([ov05]) && (await evaluate("$total()")) === "1", JSON.stringify(await evaluate("$rows()")));

  // ------------------------------------------------------------- errors
  section("ERP API unavailable, retry and invalid parameters");
  await open("unitId=UNIT-MUENCHEN");
  page.once("request", (p) => page.send("Fetch.fulfillRequest", { requestId: p.requestId, ...jsonAnswer(502, { statusCode: 502, message: "The ERP API is not reachable. Please check that it is running." }) }), "GET");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Refresh').click()");
  await settled("$state() === 'error'", "error state");
  check("API failure: message and Retry", (await evaluate("$text('[data-overview-state]')")).includes("Sales orders could not be loaded") && (await evaluate("!!$btn('Retry')")));
  await evaluate("$btn('Retry').click()");
  await settled("$state() === 'orders' && $total() === '27'", "retried");
  check("Retry loads the list again", true);
  await page.goto(`${urls.deadBackoffice}/sales-orders`, "$state() === 'error'");
  check("Backoffice without ERP API: error with Retry, no empty list", (await evaluate("$text('[data-overview-state]')")).includes("not reachable") && (await evaluate("!!$btn('Retry')")));

  page.requests = [];
  await open("limit=0&page=2&q=a&q=b&after=xyz&unitId=UNIT-OSAKA");
  const sent = page.requests.filter((r) => r.method === "GET" && r.url.includes(LIST_PATH)).map((r) => new URL(r.url).search);
  check("Invalid URL values are named and not sent; valid ones stay", (await evaluate("document.querySelector('[data-ignored-parameters]').dataset.ignoredParameters")) === "page (unknown parameter) | q (given more than once) | limit (must be a whole number from 1 to 100) | after (not a page of the list)" && JSON.stringify(sent) === JSON.stringify(["?unitId=UNIT-OSAKA"]), JSON.stringify(sent));
  await evaluate("[...document.querySelectorAll('[data-ignored-parameters] button')][0].click()");
  await settled("location.search === '?unitId=UNIT-OSAKA' && !document.querySelector('[data-ignored-parameters]')", "address cleaned");
  check("'Remove them' cleans the address", true);
  const proxy = await evaluate(`Promise.all([
    fetch('/api/erp/sales-orders?unitId=UNIT-OSAKA&limit=1').then(r => String(r.status)),
    fetch('/api/erp/sales-orders?foo=1').then(r => String(r.status)),
    fetch('/api/erp/sales-orders?limit=1&limit=2').then(r => String(r.status)),
    fetch('/api/erp/sales-orders?limit=500').then(r => String(r.status)),
    fetch('/api/erp/sales-orders', { method: 'DELETE' }).then(r => r.status + ' ' + r.headers.get('Allow')),
  ]).then(a => a.join(' | '))`);
  check("Proxy: documented parameters only, each once, nothing else", proxy === "200 | 400 | 400 | 400 | 405 POST, GET", proxy);

  // ------------------------------------------------------------- mobile
  section("Mobile 390px");
  await page.viewport(390, 844, true);
  await open("unitId=UNIT-MUENCHEN&limit=10");
  await page.screenshot("overview-mobile.png");
  check("Cards instead of the table, no horizontal scrolling", (await evaluate("$cards().length")) === 10 && (await evaluate("$rows().length")) === 0 && !(await evaluate("$overflow()")), String(await evaluate("document.documentElement.scrollWidth")));
  // OV-NEW was created after the customer and unit were renamed, OV-26
  // before: each card shows the names as they were when its order was created
  const cardText = (number) => evaluate(`document.querySelector('[data-order-card="${number}"]')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  const card = await cardText(newest);
  check("Card content: number, reference, value, Sold-to, unit, sales area, status", card.includes(newest) && card.includes("Ref. OV-NEW") && card.includes("4,400.00 EUR") && card.includes("CUST-1000") && card.includes("UNIT-MUENCHEN") && card.includes("1000/10/00") && card.includes("Open") && card.includes("None"), card);
  const older = await cardText(muenchen[25]);
  check("Snapshots: the newer order has the new names, the older one the old names", card.includes("Renamed AG") && card.includes("Renamed Unit") && older.includes("Müller Heiztechnik GmbH") && older.includes("Müller – München"), `${card} || ${older}`);
  await evaluate("$pager('next').click()");
  await settled("$page() === '2' && $cards().length === 10", "mobile page 2");
  check("Pagination works on mobile", !(await evaluate("$overflow()")));
  await page.viewport(1440, 900);

  // Master data back as before
  await api("PATCH", "/customers/CUST-1000", { name: "Müller Heiztechnik GmbH" });
  await api("PATCH", "/b2b-units/UNIT-MUENCHEN", { name: "Müller – München" });
  check("No uncaught page errors", page.pageErrors.length === 0, page.pageErrors.join(" | "));
}
