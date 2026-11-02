// Browser regression tests against a fully isolated, disposable environment:
//
//   PostgreSQL (container, tmpfs)  127.0.0.1:BROWSER_TEST_DB_PORT   (55450)
//   ERP API (apps/erp-api/dist)    127.0.0.1:BROWSER_TEST_API_PORT  (3300)
//   Backoffice (next start)        127.0.0.1:BROWSER_TEST_BO_PORT   (3301)
//   Backoffice without ERP API     127.0.0.1:BROWSER_TEST_DEAD_PORT (3302)
//   Shop (apps/shop, next start)   127.0.0.1:BROWSER_TEST_SHOP_PORT (3303)
//   Headless Edge/Chrome (CDP)     127.0.0.1:BROWSER_TEST_CDP_PORT  (9450)
//
// The development environment (API 3000, Backoffice 3001, Shop 3002,
// PostgreSQL 5432) is never used. Every resource is removed afterwards, also on failure or
// Ctrl+C, and only resources this run created are removed. See README.md.
//
// Usage: npm run test:browser [-- --skip-build] [--keep]

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, findBrowser } from "./lib/browser.mjs";
import { assertDockerAvailable, DisposableDatabase } from "./lib/database.mjs";
import { createFixtures } from "./lib/fixtures.mjs";
import { runToCompletion, startProcess, waitForHttp } from "./lib/processes.mjs";
import {
  assertPortsFree,
  assertTestApiUrl,
  assertTestPorts,
  serviceEnvironment,
} from "./lib/safety.mjs";
import salesOrderOverviewSuite, { emptyOverviewSuite } from "./suites/sales-order-overview.mjs";
import salesOrderSuite from "./suites/sales-orders.mjs";
import shopAdminSuite from "./suites/shop-admin.mjs";
import shopAuthSuite from "./suites/shop-auth.mjs";
import shopFoundationSuite from "./suites/shop-foundation.mjs";

// In this order: the empty overview needs a database without orders
const SUITES = [
  ["Sales order overview: no orders yet (Sprint 10D-B)", emptyOverviewSuite],
  ["Sales orders (Sprint 10C)", salesOrderSuite],
  ["Sales order overview (Sprint 10D-B)", salesOrderOverviewSuite],
  ["Shop foundation (Sprint 11)", shopFoundationSuite],
  // Before the sign-in suite: that one locks sign-ins without a trusted
  // client address for the rest of the run; this one removes its users
  ["Shop user administration (Sprint 12C)", shopAdminSuite],
  ["Shop sign-in (Sprint 12B)", shopAuthSuite],
];

const here = dirname(fileURLToPath(import.meta.url));
const BACKOFFICE = resolve(here, "../..");
const ERP_API = resolve(BACKOFFICE, "../erp-api");
const SHOP = resolve(BACKOFFICE, "../shop");

const port = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);
let ports;
try {
  ports = assertTestPorts({
    database: port("BROWSER_TEST_DB_PORT", 55450),
    api: port("BROWSER_TEST_API_PORT", 3300),
    backoffice: port("BROWSER_TEST_BO_PORT", 3301),
    deadBackoffice: port("BROWSER_TEST_DEAD_PORT", 3302),
    shop: port("BROWSER_TEST_SHOP_PORT", 3303),
    // Never listened on: the Backoffice on deadBackoffice points here
    unreachableApi: port("BROWSER_TEST_UNREACHABLE_API_PORT", 3399),
    browser: port("BROWSER_TEST_CDP_PORT", 9450),
  });
} catch (error) {
  console.error(`Browser tests could not run: ${error.message}`);
  process.exit(1);
}
const skipBuild = process.argv.includes("--skip-build");
// Keeps logs and screenshots also after a successful run
const keep = process.argv.includes("--keep");

/** Cleanup steps in creation order; run in reverse, every one of them */
const cleanups = [];
let cleaning = null;
function onCleanup(label, step) {
  cleanups.push([label, step]);
}
function cleanUp() {
  cleaning ??= (async () => {
    for (const [label, step] of cleanups.reverse()) {
      try {
        const result = await step();
        console.log(`  cleanup: ${label}${typeof result === "string" ? ` (${result})` : ""}`);
      } catch (error) {
        console.error(`  cleanup FAILED: ${label}: ${error.message}`);
      }
    }
  })();
  return cleaning;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.error(`\n${signal}: cleaning up...`);
    cleanUp().finally(() => process.exit(130));
  });
}

const step = (text) => console.log(`- ${text}`);

/** Folder of this run for logs and screenshots (kept when something fails) */
let runDir = null;

async function main() {
  // 1. Preconditions: nothing is created before all of them hold
  await assertPortsFree(ports);
  assertDockerAvailable();
  const browserExecutable = findBrowser();

  const runId = randomBytes(4).toString("hex");
  runDir = mkdtempSync(join(tmpdir(), `b2b-browser-test-${runId}-`));
  mkdirSync(join(runDir, "screenshots"));
  console.log(`Browser tests, run ${runId}; logs and screenshots: ${runDir}`);
  step(`ports ${JSON.stringify(ports)} are valid and free`);

  // 2. Current builds of the applications (production builds), one after
  // the other; every app has its own output folder (dist, .next)
  if (!skipBuild) {
    step("building the ERP API, the Backoffice and the Shop");
    runToCompletion(process.execPath, [join(ERP_API, "node_modules/@nestjs/cli/bin/nest.js"), "build"], { cwd: ERP_API, env: process.env, label: "ERP API build" });
    runToCompletion(process.execPath, [join(BACKOFFICE, "node_modules/next/dist/bin/next"), "build"], { cwd: BACKOFFICE, env: process.env, label: "Backoffice build" });
    // Without any service key in the environment: none can end up in the build
    runToCompletion(process.execPath, [join(SHOP, "node_modules/next/dist/bin/next"), "build"], { cwd: SHOP, env: serviceEnvironment(process.env, {}), label: "Shop build" });
  }
  // The shop service key of this run only; never printed
  const shopServiceKey = randomBytes(32).toString("hex");

  // 3. Disposable database with all migrations
  const database = new DisposableDatabase({ runId, port: ports.database });
  onCleanup(`test database ${database.container}`, () => database.stop());
  step(`starting the test database ${database.container} on 127.0.0.1:${ports.database}`);
  await database.start();
  // DATABASE_URL is set explicitly; it takes precedence over the root .env
  const dbEnv = serviceEnvironment(process.env, { DATABASE_URL: database.url });
  runToCompletion(process.execPath, [join(ERP_API, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: ERP_API, env: dbEnv, label: "Migrations" });
  const migrated = database.sql("SELECT current_database() || ':' || (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL)");
  step(`migrations applied in ${migrated.split(":")[0]} (${migrated.split(":")[1]})`);

  // 4. ERP API, only on 127.0.0.1, only with the test database; its
  // activation links point to the test shop
  const apiUrl = `http://127.0.0.1:${ports.api}`;
  const shopUrl = `http://127.0.0.1:${ports.shop}`;
  /** An ERP API process of this run (cleaned up like every other) */
  const startErpApi = (name, settings) => {
    const owned = startProcess(name, process.execPath, [join(ERP_API, "dist/main.js")], {
      cwd: ERP_API,
      env: serviceEnvironment(process.env, { DATABASE_URL: database.url, SHOP_SERVICE_KEY: shopServiceKey, SHOP_PUBLIC_URL: shopUrl, ...settings }),
      logFile: join(runDir, `${name.replace(/W+/g, "-").toLowerCase()}.log`),
    });
    onCleanup(name, () => owned.stop());
    return owned;
  };
  const api = startErpApi("ERP API", { PORT: String(ports.api), HOST: "127.0.0.1" });
  await waitForHttp(`${apiUrl}/sales-areas`, api);
  step(`ERP API ready on ${apiUrl}`);

  // 5. Test data through the API; proves the API writes into the test database
  const callApi = (method, path, body) =>
    fetch(apiUrl + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const fixtures = await createFixtures(callApi);
  const seeded = database.sql("SELECT count(*) FROM b2b_units WHERE unit_id IN ('UNIT-STUTTGART','UNIT-MUENCHEN','UNIT-WARSZAWA','UNIT-OSAKA')");
  if (seeded !== "4") throw new Error("The ERP API did not write the test data into the test database.");
  step("test data created (in the test database)");

  // 6. Backoffice instances, only on 127.0.0.1, only with the test API
  const nextBin = join(BACKOFFICE, "node_modules/next/dist/bin/next");
  const startBackoffice = (name, boPort, erpApiUrl) => {
    const owned = startProcess(name, process.execPath, [nextBin, "start", "--port", String(boPort), "--hostname", "127.0.0.1"], {
      cwd: BACKOFFICE,
      env: serviceEnvironment(process.env, { ERP_API_URL: erpApiUrl }),
      logFile: join(runDir, `${name.replace(/\W+/g, "-").toLowerCase()}.log`),
    });
    onCleanup(name, () => owned.stop());
    return owned;
  };
  const backoffice = startBackoffice("Backoffice", ports.backoffice, assertTestApiUrl(apiUrl, ports.api));
  // Its API port is checked free above and never opened
  const deadBackoffice = startBackoffice("Backoffice without ERP API", ports.deadBackoffice, `http://127.0.0.1:${ports.unreachableApi}`);
  const boUrl = `http://127.0.0.1:${ports.backoffice}`;
  const deadUrl = `http://127.0.0.1:${ports.deadBackoffice}`;
  await waitForHttp(`${boUrl}/`, backoffice);
  await waitForHttp(`${deadUrl}/`, deadBackoffice);
  step(`Backoffice ready on ${boUrl} (and ${deadUrl} without ERP API)`);

  // 7. Shop, only on 127.0.0.1, with the test API and this run's service key
  const shop = startProcess("Shop", process.execPath, [join(SHOP, "node_modules/next/dist/bin/next"), "start", "--port", String(ports.shop), "--hostname", "127.0.0.1"], {
    cwd: SHOP,
    env: serviceEnvironment(process.env, { ERP_API_URL: assertTestApiUrl(apiUrl, ports.api), SHOP_SERVICE_KEY: shopServiceKey }),
    logFile: join(runDir, "shop.log"),
  });
  onCleanup("Shop", () => shop.stop());
  await waitForHttp(`${shopUrl}/`, shop);
  step(`Shop ready on ${shopUrl}`);

  // 8. Browser
  const { browser, page } = await launchBrowser({
    executable: browserExecutable,
    port: ports.browser,
    profileDir: mkdtempSync(join(runDir, "profile-")),
    logFile: join(runDir, "browser.log"),
    screenshotDir: join(runDir, "screenshots"),
  });
  onCleanup("browser", async () => {
    page.close();
    await browser.stop();
  });
  step(`browser ready (${browserExecutable})`);

  // 9. Suites
  const results = [];
  const context = {
    page,
    api: callApi,
    sql: (query) => database.sql(query),
    urls: { backoffice: boUrl, deadBackoffice: deadUrl, api: apiUrl, shop: shopUrl, unreachableApiPort: ports.unreachableApi },
    fixtures,
    shopServiceKey,
    startErpApi,
    /**
     * The ERP's local shop user tool against the test database. Its output
     * (e.g. an activation link) is returned, never printed.
     */
    shopUser: (...args) => {
      const result = spawnSync(process.execPath, [join(ERP_API, "dist/shop/cli/shop-user.cli.js"), ...args, "--shop-url", shopUrl, "--json"], {
        cwd: ERP_API,
        env: serviceEnvironment(process.env, { DATABASE_URL: database.url }),
        encoding: "utf8",
      });
      if (result.status !== 0) throw new Error(`shop:user ${args[0]} failed (exit ${result.status})`);
      return JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
    },
    // Folder of the service logs, e.g. to prove that no secret is logged
    runDir,
    check: (name, ok, detail = "") => {
      results.push({ name, ok: Boolean(ok), detail });
      console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok || !detail ? "" : `  -> ${detail}`}`);
    },
    section: (name) => console.log(`\n## ${name}`),
  };
  let crashed = null;
  for (const [name, suite] of SUITES) {
    console.log(`\n=== ${name}`);
    try {
      await suite(context);
    } catch (error) {
      crashed = error;
      console.error(`\nSuite "${name}" stopped: ${error.message}`);
      break;
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${crashed ? ", suite stopped early" : ""}`);
  for (const result of failed) console.log(`  FAILED: ${result.name}${result.detail ? ` -> ${result.detail}` : ""}`);
  return failed.length === 0 && !crashed;
}

let ok = false;
try {
  ok = await main();
} catch (error) {
  console.error(`\nBrowser tests could not run: ${error.message}`);
} finally {
  console.log("\nCleaning up:");
  await cleanUp();
}
if (runDir && ok && !keep) {
  rmSync(runDir, { recursive: true, force: true });
} else if (runDir) {
  console.log(`Logs and screenshots kept for analysis: ${runDir}`);
}
process.exit(ok ? 0 : 1);
