// Pricing procedures (Sprint 13A): the read-only viewer in the Backoffice,
// and the new document pricing POST /pricing/calculate of the ERP API next
// to the released price determination, with the test data of this run.

const STUTTGART_ORDER = {
  salesOrganization: "1000",
  distributionChannel: "10",
  division: "00",
  unitId: "UNIT-STUTTGART",
  pricingDate: "2026-11-15",
  items: [
    { materialNumber: "MAT-001", quantity: 2 },
    { materialNumber: "MAT-002", quantity: 10 },
  ],
};

export default async function pricingProceduresSuite({ page, api, urls, check, section }) {
  const BO = urls.backoffice;
  const evaluate = (expression) => page.evaluate(expression);
  page.extraHelpers = "";
  page.diagnostics = "({ procedures: document.querySelectorAll('[data-procedure]').length })";
  const errorsBefore = page.pageErrors.length;

  section("Backoffice: pricing procedure viewer (read-only)");
  await page.viewport(1440, 900);
  await page.goto(`${BO}/pricing`, "!!document.querySelector('[data-procedure-detail]')");
  const tabs = await evaluate("JSON.stringify([...document.querySelectorAll('[data-procedure]')].map(e => e.dataset.procedure))");
  check("Three procedures, one per market: ZDE001, ZJP001, ZPL001", tabs === JSON.stringify(["ZDE001", "ZJP001", "ZPL001"]), tabs);
  check("Each names its sales area", (await evaluate("$text('[data-procedure=ZDE001]')")).includes("1000/10/00") && (await evaluate("$text('[data-procedure=ZJP001]')")).includes("3000/10/00"));
  const steps = await evaluate("JSON.stringify([...document.querySelectorAll('[data-procedure-detail=ZDE001] [data-step]')].map(e => e.dataset.step))");
  check("ZDE001: steps 5 list price, 10 base price, 100 net value", steps === JSON.stringify(["5", "10", "100"]), steps);
  check("Flags: base price mandatory, list price statistical", (await evaluate("$text('[data-step=\"10\"]')")).includes("Mandatory") && (await evaluate("$text('[data-step=\"5\"]')")).includes("Statistical"));
  await evaluate("document.querySelector('[data-step=\"10\"] details summary').click()");
  const accesses = await evaluate("$text('[data-accesses=ZBP1]')");
  check("ZBP1 accesses in the approved order", ["10 · ZP03", "20 · ZP02", "30 · ZP03", "40 · ZP02", "50 · ZP01"].every((part) => accesses.includes(part)) && accesses.indexOf("ZP03 Special Price · B2B Unit") < accesses.indexOf("ZP01"), accesses);
  await evaluate("document.querySelector('[data-procedure=ZJP001]').click()");
  await page.waitFor("!!document.querySelector('[data-procedure-detail=ZJP001]')", "ZJP001 detail");
  check("Selecting ZJP001 shows its steps", (await evaluate("document.querySelectorAll('[data-procedure-detail=ZJP001] [data-step]').length")) === 3);
  check("Nothing to edit: no inputs or buttons in the procedure detail", (await evaluate("document.querySelectorAll('[data-procedure-detail] input, [data-procedure-detail] button, [data-procedure-detail] select').length")) === 0);
  await page.screenshot("pricing-procedures.png");
  await page.viewport(390, 844, true);
  await page.goto(`${BO}/pricing`, "!!document.querySelector('[data-procedure-detail]')");
  check("The viewer fits 390px", !(await evaluate("$overflow()")));
  await page.screenshot("pricing-procedures-mobile.png");
  await page.viewport(1440, 900);

  section("ERP: POST /pricing/calculate next to the released price determination");
  const document = await api("POST", "/pricing/calculate", STUTTGART_ORDER);
  const simulation = await api("POST", "/sales-orders/simulate", STUTTGART_ORDER);
  check("The Stuttgart order: the same net value as the order simulation", document.status === 200 && document.body.status === "COMPLETE" && document.body.totals.netValue === simulation.body.totals.netValue, JSON.stringify(document.body?.totals));
  for (const item of STUTTGART_ORDER.items) {
    const price = await api("POST", "/pricing/price", { ...STUTTGART_ORDER, items: undefined, materialNumber: item.materialNumber, quantity: item.quantity });
    const line = document.body.items.find((i) => i.materialNumber === item.materialNumber).lines.find((l) => l.step === 10);
    check(`${item.materialNumber}: the same record and price as POST /pricing/price`, price.status === 200 && line.conditionId === price.body.conditionId && line.rate === price.body.unitPrice && line.value === price.body.netValue, `${line.conditionId}/${price.body.conditionId}`);
  }
  const japan = await api("POST", "/pricing/calculate", { salesOrganization: "3000", distributionChannel: "10", division: "00", unitId: "UNIT-OSAKA", pricingDate: "2026-11-15", items: [{ materialNumber: "MAT-001", quantity: 1 }] });
  check("Japan: ZJP001 in JPY without decimals", japan.body.procedure?.code === "ZJP001" && japan.body.totals.netValue === "700000");
  const poland = await api("POST", "/pricing/calculate", { salesOrganization: "2000", distributionChannel: "10", division: "00", unitId: "UNIT-WARSZAWA", pricingDate: "2026-11-15", items: [{ materialNumber: "MAT-002", quantity: 1 }] });
  // MAT-002 has no price in Poland (the sales order suite adds one for MAT-001)
  check("Poland without a price for MAT-002: 200 INCOMPLETE with a message, no conversion", poland.status === 200 && poland.body.status === "INCOMPLETE" && poland.body.messages[0]?.code === "MANDATORY_CONDITION_MISSING" && poland.body.totals.netValue === null);
  check("No uncaught page errors", page.pageErrors.length === errorsBefore, page.pageErrors.slice(errorsBefore).join(" | "));
}
