# B2B Shop

The customer-facing shop of the B2B Commerce Lab (development preview).
Next.js (App Router), React, TypeScript and Tailwind CSS, like the
backoffice. Architecture and security rules: `docs/adr/` in the repository.

Current state (Sprint 12B): shop frame, start page, technical health check,
and the sign-in: activation with a one-time link (`/activate`), sign-in
(`/login`), the signed-in state (`/account`) and sign-out. There is no
self-registration, no catalog, no prices and no ordering yet.

## Getting started

The shop needs the ERP API (`apps/erp-api`) on this computer, with the same
`SHOP_SERVICE_KEY` in the root `.env` (ERP API) and in `.env.local` here.
Variables, key generation and startup behavior: `docs/local-setup.md`.

```bash
npm ci
# create .env.local with ERP_API_URL and SHOP_SERVICE_KEY: docs/local-setup.md
npm run dev
```

Open [http://127.0.0.1:3002](http://127.0.0.1:3002). The shop only listens
on 127.0.0.1 and must not be exposed to a network (docs/adr/0006).

## How the shop talks to the ERP

- The browser only talks to the shop. It never calls the ERP API.
- The shop server calls only the ERP shop API `/shop/v1`, never the admin
  endpoints, with the header `X-Shop-Service-Key`.
- The service key identifies the shop server, not a user. It does not
  authorize any customer data: customer calls also carry the user's session
  token, which the shop keeps in an HttpOnly cookie and sends to the ERP in
  `X-Shop-Session` (docs/adr/0003).
- The sign-in route handlers (`/api/auth/login|logout|activate`) accept
  POST requests from pages of this shop only (Origin check against CSRF).
- Without a valid configuration the shop fails closed: `GET /api/health`
  answers 503 and the reason is only written to the server log.

## Scripts

| Command             | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Development server on 127.0.0.1:3002            |
| `npm run build`     | Production build                                |
| `npm run start`     | Production server on 127.0.0.1:3002             |
| `npm run lint`      | ESLint                                          |
| `npm run typecheck` | TypeScript check                                |
| `npm test`          | Unit tests (`node --test`)                      |

Browser regression tests of the shop run with the backoffice runner:
`npm run test:browser` in `apps/backoffice` (see its `test/browser/README.md`).
