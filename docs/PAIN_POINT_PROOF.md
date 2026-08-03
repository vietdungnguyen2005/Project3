# V-Pulse Pain Point Proof

## Pain Point 5: DOM Flooding Via Large Datasets

Implementation evidence:

- `lib/ledger.ts` generates and caps the verified historical ledger size at `100_000`.
- `app/api/ledger/route.ts` returns bounded ledger windows with `offset`, `limit`, `query`, and `status` parameters.
- `components/use-ledger-data.ts` requests 600-row server windows and keeps a sparse `rowsByIndex` cache instead of storing 100,000 records in component state.
- `components/ledger-grid.tsx` uses TanStack Table for headless column architecture and `useVirtualizer` from `@tanstack/react-virtual` for the render window.
- The grid maps `virtualRows.map(...)`, not `tableRows.map(...)`, so DOM nodes are recycled.
- Runtime rows expose `data-ledger-row` so Playwright can count actual mounted rows.

Verification:

```bash
npm run proof
npm run test
npm run test:e2e
```

Expected proof:

- `npm run proof` confirms a bounded server window over 100,000 records and source-level virtualization.
- `npm run test:e2e` loads the dashboard, waits for `100,000 records`, and asserts mounted ledger rows stay below `70` before and after scrolling near the end of the dataset.

## Pain Point 6: Frontend Security And Reverse Proxy Brokerage

Implementation evidence:

- Browser code calls only `/api/ledger` and `/api/ledger/stream`.
- `app/api/ledger/route.ts` and `app/api/ledger/stream/route.ts` broker upstream requests server-side.
- `lib/ledger-proxy.ts` imports `server-only`, injects the private bearer token server-side, and forwards only `x-request-id` and `x-correlation-id`.
- When a real upstream is configured, `/api/ledger/stream` fails closed with `502` instead of silently substituting synthetic events.
- API responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- `middleware.ts` issues a request nonce and a strict CSP; `next.config.ts` disables `X-Powered-By`, applies baseline security headers, and removes console calls in production.

Verification:

```bash
npm run test
npm run test:e2e
npm run build
npm audit --omit=dev
```

Expected proof:

- Unit tests confirm browser authorization/cookie/api-key headers are not forwarded upstream.
- Source security tests confirm private token names do not appear in client components.
- E2E tests confirm browser requests to `/api/ledger` are server-windowed, do not carry private credentials, and API responses are no-store/nosniff with a strict CSP.
- Production build confirms Next.js App Router and route handlers compile for deployment.
