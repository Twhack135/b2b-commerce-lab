# ERP Backoffice

Browser-based administration interface for the B2B Commerce Lab ERP.
Built with Next.js (App Router), React, TypeScript and Tailwind CSS.

## Getting Started

The backoffice needs the ERP API (`apps/erp-api`) running on port 3000.

```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

> **Local development only.** The Backoffice has no administrator sign-in.
> It manages master data, prices, orders and, since Sprint 12C, shop users
> and their activation links. It must only run on this computer and must
> never be made reachable from other computers (docs/adr/0006, 0007). Its
> ERP proxy refuses foreign host names (DNS rebinding) and state-changing
> requests from other sites (CSRF); this is no substitute for a sign-in.

## Scripts

| Command             | Purpose                                 |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Development server on port 3001         |
| `npm run build`     | Production build                        |
| `npm run start`     | Run the production build on port 3001   |
| `npm run lint`      | ESLint                                  |
| `npm run typecheck` | TypeScript check                        |
| `npm run acceptance:env` | Disposable environment for manual acceptance tests (docs/testing) |

## How it talks to the ERP API

The browser only calls this app. The route handler
`src/app/api/erp/[...path]/route.ts` forwards `/api/erp/*` to the ERP API,
so the ERP API needs no CORS configuration.

The ERP API address comes from `ERP_API_URL` (default `http://localhost:3000`).
To change it, copy `.env.example` to `.env.local`.

To make a new ERP module reachable, add its resource name to
`ALLOWED_RESOURCES` in the route handler.
