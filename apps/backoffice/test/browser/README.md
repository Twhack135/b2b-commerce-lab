# Browser regression tests

End-to-end tests of the Backoffice in a real headless browser, against a
fully isolated, disposable environment. The development environment and its
database `b2b_erp` are never used.

```
npm run test:browser                  # build the apps, then test
npm run test:browser -- --skip-build  # reuse the existing builds
npm run test:browser -- --keep        # keep logs and screenshots after success
npm run test:browser:safety           # unit tests of the safety rules
```

Run from `apps/backoffice`. The exit code is 0 only when every check passed.

## Prerequisites

- Node.js 24 (built-in `fetch` and `WebSocket`; no extra test dependency)
- Installed dependencies in `apps/erp-api` and `apps/backoffice`
- Docker Desktop running; image `postgres:18` (pulled on first use)
- Microsoft Edge or Google Chrome. Other locations: set `BROWSER_PATH` to a
  Chromium-based browser executable.

## What one run does

| Step | Resource | Address |
| ---- | -------- | ------- |
| 1 | Checks: ports valid and free, Docker available, browser found | |
| 2 | `nest build` (ERP API), `next build` (Backoffice, Shop), one after the other, unless `--skip-build` | |
| 3 | PostgreSQL container `b2b-browser-test-<runId>`, memory only (tmpfs), all migrations via `prisma migrate deploy` | `127.0.0.1:55450` |
| 4 | ERP API (`node dist/main.js`) with the test database | `127.0.0.1:3300` |
| 5 | Test data created through the ERP API (`lib/fixtures.mjs`) | |
| 6 | Backoffice (`next start`) with the test API | `127.0.0.1:3301` |
| 6 | Second Backoffice whose ERP API is unreachable (error pages) | `127.0.0.1:3302` → `3399` |
| 6 | Shop (`apps/shop`, `next start`) with the test API and a random service key of the run | `127.0.0.1:3303` |
| 7 | Headless browser with a temporary profile (CDP) | `127.0.0.1:9450` |
| 8 | Suites (`suites/*.mjs`), then cleanup | |

Each port can be changed: `BROWSER_TEST_DB_PORT`, `BROWSER_TEST_API_PORT`,
`BROWSER_TEST_BO_PORT`, `BROWSER_TEST_DEAD_PORT`, `BROWSER_TEST_SHOP_PORT`,
`BROWSER_TEST_UNREACHABLE_API_PORT`, `BROWSER_TEST_CDP_PORT`.

The test data is deterministic: Germany 1000/10/00 (EUR) with the account
CUST-1000 and units UNIT-STUTTGART / UNIT-MUENCHEN, Poland 2000/10/00 (PLN,
only MAT-101 priced) with UNIT-WARSZAWA, Japan 3000/10/00 (JPY) with UNIT-OSAKA.
The suites read condition IDs from the fixtures, never fixed numbers.

## Safety guarantees

- **Never the development database.** The test database URL must point to
  `127.0.0.1`, the test port, and a database named `*_test` (never
  `b2b_erp`). `DATABASE_URL`, `PG*`, `ERP_API_URL`, `SHOP_SERVICE_KEY`,
  `PORT`, `HOST` and `HOSTNAME` are removed from the inherited environment and set explicitly,
  so the root `.env` cannot redirect a service. After the fixtures, the runner
  checks inside the container that the API wrote there.
- **Protected ports.** 3000, 3001, 3002 and 5432 are rejected for every test
  service, as are duplicate ports and ports below 1024.
- **Busy ports are never freed.** If a test port is in use, the run stops
  before changing anything. The runner never kills a process it did not
  start; it only stops the child processes it spawned itself (by their own
  handle and process tree).
- **Only its own container.** The container name is
  `b2b-browser-test-<hex runId>` and carries the label
  `b2b-commerce-lab.browser-test-run=<runId>`. Before stopping, the runner
  checks this label; a container of another run or any other container is
  never touched. The container is started with `--rm` and tmpfs, so stopping
  it removes every test data. `docker compose` is never used.
- **Localhost only.** Every service binds to `127.0.0.1`.
- **Shop service key.** Each run generates its own random key for the ERP
  shop API and the shop; it is never printed. The shop is built without any
  key in its environment.
- **Cleanup always runs**: after success, after a failure, after an
  exception and on Ctrl+C (SIGINT/SIGTERM). The order is browser, Backoffice
  instances, ERP API, database.
- **Configuration unchanged.** The production and development scripts and
  configuration of both apps are not modified; the runner only passes
  command-line arguments and environment variables to its own processes.

## Run one test run at a time

Runs must be sequential. Concurrent runs are not supported:

- **Shared ports.** All runs use the same default ports. A run started while
  another is running stops at the port check before creating anything. If
  two runs start at the same moment, both can pass the check; the later
  service then cannot bind, and its readiness check may reach the other
  run's service. The runner then fails (test data cannot be created, or the
  check that the data is in its own database fails). Only disposable test
  databases are involved, never `b2b_erp`, but both runs may fail.
- **Shared build output.** `next build` writes `apps/backoffice/.next` and
  `apps/shop/.next`, `nest build` writes `apps/erp-api/dist`. Within one run
  the builds run one after the other. A build of one run replaces the
  files that the services of another run (or a running `npm run start` of
  the Backoffice) are using. Other ports via the variables above do not
  avoid this, not even with `--skip-build` on one side.

Unaffected: container names, run labels, browser profiles and run folders
are unique per run, and cleanup only removes the run's own resources. The
ERP API integration and E2E tests use their own ports (55433, 55435).

## Files

- `run.mjs` – the runner (environment, suites, summary, cleanup)
- `lib/safety.mjs` – port, URL, container and environment rules
  (`lib/safety.test.mjs` tests them)
- `lib/database.mjs` – disposable PostgreSQL container
- `lib/processes.mjs` – owned child processes, logs, HTTP readiness
- `lib/browser.mjs` – browser start and the CDP page helper
  (`evaluate`, `waitFor`, request recording and interception)
- `lib/fixtures.mjs` – test data
- `suites/sales-orders.mjs` – Sprint 10C: create and confirm sales orders
- `suites/sales-order-overview.mjs` – Sprint 10D-B: the sales order overview
  (an empty part runs first, the main part later; see `SUITES` in `run.mjs`)
- `suites/shop-foundation.mjs` – Sprint 11: shop frame, security headers,
  health checks, the shop/ERP boundary, the service key and the refused
  non-local binding of the ERP API (runs last)

A new suite is a module whose default export receives
`{ page, api, sql, urls, fixtures, check, section }`; add it to `SUITES` in
`run.mjs`. Suites run in order in the same environment, so a suite must
not rely on data another suite changes.

## Waiting for the application

Interactions must wait for what a user would see, never for a fixed time:

- A form is ready when all of its data is shown. The simulation loads
  sales areas, B2B units and the order date independently; `simReady`
  requires all of them (a list that is still loading is a disabled select).
- Choose options with `page.select(id, value, settled)`: it waits until the
  option is offered and enabled, selects it, and then waits until the
  selection has persisted and its effect (`settled`) is visible.
- Wait for the answer of the action itself: `simulate()` waits until its own
  request has finished (`page.finishedCount(path)`), because a repeated
  simulation of the same input looks current before its answer arrives.
- Timeouts report the URL, alerts, the form state (`page.diagnostics`) and
  save `screenshots/timeout.png`.

## Troubleshooting

- **"Port … is already in use"**: another program (or a test run that is
  still running) uses the port. Stop it yourself, or choose other ports
  with the variables above. The runner does not free ports.
- **"Docker is not available"**: start Docker Desktop.
- **"Container … already exists"**: practically impossible (random run ID);
  check `docker ps -a --filter label=b2b-commerce-lab.browser-test-run`.
- **A leftover container after a hard kill** (e.g. the terminal was closed):
  it is listed by the filter above and can be removed with
  `docker stop <name>`; it holds only test data in memory.
- **A failed check or timeout**: the run folder in the system temp directory
  (`b2b-browser-test-<runId>-…`) is kept and printed at the end. It
  contains the logs of every service (`erp-api.log`, `backoffice.log`, …) and
  screenshots (`screenshots/timeout.png` on a timeout). After a successful
  run the folder is removed, unless `--keep` is given.
- **Build notes**: `next build` writes the production build to `.next`; a
  running `next dev` uses `.next/dev` and keeps working. `nest build` writes
  `apps/erp-api/dist`, which `npm run start` of the ERP API also uses; a
  running API has its code loaded already.
