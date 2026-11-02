# Local setup

Everything runs on this computer only (docs/adr/0006). No secret belongs in
Git: `.env` and `.env.local` files are ignored; only the `.env.example`
files without values are committed.

## Environment variables

| Variable | File | Used by | Purpose |
| -------- | ---- | ------- | ------- |
| `POSTGRES_PASSWORD` | `.env` (repository root) | Docker Compose | Password of the development database |
| `DATABASE_URL` | `.env` (repository root) | ERP API, Prisma | Connection to the development database (same password) |
| `SHOP_SERVICE_KEY` | `.env` (repository root) | ERP API | Key the ERP shop API `/shop/v1` expects from the shop |
| `ERP_API_URL` | `apps/backoffice/.env.local` (optional) | Backoffice server | ERP address; default `http://localhost:3000` |
| `ERP_API_URL` | `apps/shop/.env.local` | Shop server | ERP address, e.g. `http://127.0.0.1:3000` |
| `SHOP_SERVICE_KEY` | `apps/shop/.env.local` | Shop server | The same value as in the root `.env` |

`HOST` and `PORT` of the ERP API are optional; `HOST` must be `127.0.0.1`,
`::1` or `localhost`.

`SHOP_TRUSTED_PROXY_HOPS` (shop, optional) stays unset for local
development: the shop then trusts no `X-Forwarded-For` header. Set it only
behind reverse proxies that append to that header (number of proxies).

**Node.js:** 24.7 or later is required by the ERP API (built-in Argon2id
for shop passwords; it refuses to start otherwise). The lab is tested with
Node.js 26.13 for all apps and the browser test runner.

Both shop variables are read by server code only and have no
`NEXT_PUBLIC_` prefix, so Next.js never sends them to the browser. The
service key identifies the shop server, not a user: it authorizes no
customer data (docs/adr/0002).

## Creating the shop service key

1. Generate a random key of 32 bytes (64 hex characters) **directly into
   the files**, so it never appears on screen or in the shell history:

   ```bash
   key=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
   printf '\nSHOP_SERVICE_KEY=%s\n' "$key" >> .env
   printf 'ERP_API_URL=http://127.0.0.1:3000\nSHOP_SERVICE_KEY=%s\n' "$key" >> apps/shop/.env.local
   unset key
   ```

   Run this once from the repository root. If `.env` already contains a
   `SHOP_SERVICE_KEY=` line (from `.env.example`), remove the empty line
   first, so the variable is set only once.
2. Use a different key on every computer; never reuse it elsewhere, never
   paste it into chats, tickets or commits.
3. To change the key, replace it in both files and restart the ERP API and
   the shop.
4. Before committing, `git status` must not list any `.env` or `.env.local`
   file.

## Shop users for local testing

There is no self-registration. Until the Backoffice manages shop users
(Sprint 12C), a local command-line tool creates them and issues the
one-time activation link (after `npm run build` in `apps/erp-api`):

```bash
cd apps/erp-api
npm run shop:user -- create --account CUST-1000 --email anna@example.com --name "Anna Weber" --unit UNIT-STUTTGART
npm run shop:user -- activation --email anna@example.com
```

The database needs the sign-in migration
`20261103090000_add_shop_authentication` first (apply it only with a backup,
like the runbook in `docs/runbooks/` describes for the previous migration).

The link is printed once (`http://127.0.0.1:3002/activate#token=...`),
works once and for 24 hours. Treat it like a password. The tool writes
into the database of the root `.env` and refuses databases that are not on
this computer.

Sign-in: `http://127.0.0.1:3002/login`. The session cookie is HttpOnly and
SameSite=Lax; on plain-HTTP localhost it is called `shop_session` (without
the `__Host-` prefix, which needs HTTPS). Sessions end after 30 minutes
without activity and at the latest after 10 hours.

## Startup behavior

| Situation | ERP API | Shop |
| --------- | ------- | ---- |
| Key set in both files (at least 32 characters) | starts; `/shop/v1/health` answers 200 with the key | `/api/health` answers `{"status":"ok","erp":"ok"}` |
| Key missing or shorter than 32 characters in `.env` | starts, logs a warning; every `/shop/v1` request answers 503; admin API and Backoffice work as before | `/api/health` answers 503 `degraded` |
| Key missing in `apps/shop/.env.local`, or `ERP_API_URL` not on this computer | – | never calls the ERP; `/api/health` answers 503; the reason is only in the shop's server log |
| Different keys in the two files | `/shop/v1` answers 401 | `/api/health` answers 503 |
| `HOST` other than loopback, e.g. `0.0.0.0` | refuses to start | – |

## Starting

```bash
docker compose up -d                       # PostgreSQL on 127.0.0.1:5432
cd apps/erp-api && npm run start           # 127.0.0.1:3000
cd apps/backoffice && npm run dev          # 127.0.0.1:3001
cd apps/shop && npm run dev                # 127.0.0.1:3002
```
