// A disposable environment for the MANUAL acceptance test of Sprint 12C
// (docs/testing/sprint-12c-manual-acceptance.md). It starts everything the
// browser test runner starts, but keeps it running for a person to test,
// until Ctrl+C:
//
//   PostgreSQL (container, in memory)  127.0.0.1:55470
//   ERP API                            http://127.0.0.1:3310
//   Backoffice                         http://127.0.0.1:3311
//   Shop                               http://127.0.0.1:3313
//
// The development environment (3000, 3001, 3002, 5432) and the database
// b2b_erp are never used. The shop service key is random for this run and
// never shown. All data, users and sessions are gone after Ctrl+C.
//
// Usage (apps/backoffice): npm run acceptance:env [-- --skip-build] [--check]
// --check starts everything, checks that the apps answer, and removes it
// all again at once (a quick test that the environment works).

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDockerAvailable, DisposableDatabase } from "./lib/database.mjs";
import { createFixtures } from "./lib/fixtures.mjs";
import { runToCompletion, startProcess, waitForHttp } from "./lib/processes.mjs";
import { assertPortsFree, assertTestApiUrl, assertTestPorts, serviceEnvironment } from "./lib/safety.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BACKOFFICE = resolve(here, "../..");
const ERP_API = resolve(BACKOFFICE, "../erp-api");
const SHOP = resolve(BACKOFFICE, "../shop");
const ports = assertTestPorts({ database: 55470, api: 3310, backoffice: 3311, shop: 3313 });
const urls = {
  api: `http://127.0.0.1:${ports.api}`,
  backoffice: `http://127.0.0.1:${ports.backoffice}`,
  shop: `http://127.0.0.1:${ports.shop}`,
};

const cleanups = [];
let cleaning = null;
function cleanUp() {
  cleaning ??= (async () => {
    for (const [label, step] of cleanups.reverse()) {
      try {
        await step();
        console.log(`  removed: ${label}`);
      } catch (error) {
        console.error(`  cleanup FAILED: ${label}: ${error.message}`);
      }
    }
  })();
  return cleaning;
}

async function main() {
  await assertPortsFree(ports);
  assertDockerAvailable();
  const logDir = mkdtempSync(join(tmpdir(), "b2b-acceptance-"));
  cleanups.push(["log folder", () => rmSync(logDir, { recursive: true, force: true })]);

  if (!process.argv.includes("--skip-build")) {
    console.log("Building the ERP API, the Backoffice and the Shop (a few minutes)...");
    runToCompletion(process.execPath, [join(ERP_API, "node_modules/@nestjs/cli/bin/nest.js"), "build"], { cwd: ERP_API, env: process.env, label: "ERP API build" });
    runToCompletion(process.execPath, [join(BACKOFFICE, "node_modules/next/dist/bin/next"), "build"], { cwd: BACKOFFICE, env: process.env, label: "Backoffice build" });
    runToCompletion(process.execPath, [join(SHOP, "node_modules/next/dist/bin/next"), "build"], { cwd: SHOP, env: serviceEnvironment(process.env, {}), label: "Shop build" });
  }
  const shopServiceKey = randomBytes(32).toString("hex");

  const database = new DisposableDatabase({ runId: randomBytes(4).toString("hex"), port: ports.database });
  cleanups.push([`test database ${database.container}`, () => database.stop()]);
  console.log("Starting the disposable database...");
  await database.start();
  runToCompletion(process.execPath, [join(ERP_API, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: ERP_API,
    env: serviceEnvironment(process.env, { DATABASE_URL: database.url }),
    label: "Migrations",
  });

  const start = (name, command, args, cwd, settings) => {
    const owned = startProcess(name, command, args, { cwd, env: serviceEnvironment(process.env, settings), logFile: join(logDir, `${name.toLowerCase().replace(/\W+/g, "-")}.log`) });
    cleanups.push([name, () => owned.stop()]);
    return owned;
  };
  const api = start("ERP API", process.execPath, [join(ERP_API, "dist/main.js")], ERP_API, {
    DATABASE_URL: database.url,
    SHOP_SERVICE_KEY: shopServiceKey,
    SHOP_PUBLIC_URL: urls.shop,
    PORT: String(ports.api),
    HOST: "127.0.0.1",
  });
  await waitForHttp(`${urls.api}/sales-areas`, api);
  await createFixtures((method, path, body) =>
    fetch(urls.api + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
  );

  const next = (dir) => join(dir, "node_modules/next/dist/bin/next");
  const backoffice = start("Backoffice", process.execPath, [next(BACKOFFICE), "start", "--port", String(ports.backoffice), "--hostname", "127.0.0.1"], BACKOFFICE, { ERP_API_URL: assertTestApiUrl(urls.api, ports.api) });
  const shop = start("Shop", process.execPath, [next(SHOP), "start", "--port", String(ports.shop), "--hostname", "127.0.0.1"], SHOP, { ERP_API_URL: assertTestApiUrl(urls.api, ports.api), SHOP_SERVICE_KEY: shopServiceKey });
  await waitForHttp(`${urls.backoffice}/`, backoffice);
  await waitForHttp(`${urls.shop}/`, shop);

  console.log(`
The acceptance environment is ready (disposable, this computer only):

  Backoffice  ${urls.backoffice}/shop-users
  Shop        ${urls.shop}
  ERP API     ${urls.api}

Test data: accounts CUST-1000 (Müller, units UNIT-STUTTGART and UNIT-MUENCHEN),
PL-1000 (Warszawa, UNIT-WARSZAWA) and JP-1000 (Osaka, UNIT-OSAKA). No shop users yet.

Press Ctrl+C to stop. Everything is removed then; nothing is kept.`);
  if (process.argv.includes("--check")) {
    const statuses = await Promise.all(
      [`${urls.backoffice}/shop-users`, `${urls.shop}/login`, `${urls.shop}/api/health`].map((url) => fetch(url).then((r) => r.status)),
    );
    console.log(`
Check: Backoffice ${statuses[0]}, Shop ${statuses[1]}, Shop health ${statuses[2]} (expected 200 200 200)`);
    if (statuses.some((status) => status !== 200)) throw new Error("The acceptance environment does not answer as expected.");
    return;
  }
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error(`\nThe acceptance environment could not start: ${error.message}`);
  exitCode = 1;
} finally {
  console.log("\nStopping and removing everything:");
  await cleanUp();
}
process.exit(exitCode);
