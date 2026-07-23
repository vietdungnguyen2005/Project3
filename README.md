# V-Pulse

Enterprise fintech transaction ledger dashboard built with Next.js App Router, strict TypeScript, Tailwind CSS v4, TanStack Table, and TanStack Virtual.

## What Is Complete

- 100,000-row historical ledger with severe row virtualization.
- Server-side Next.js API brokerage for sensitive ledger endpoints.
- Realtime transaction feed through `/api/ledger/stream` with upstream SSE passthrough or synthetic fallback.
- Security headers, production console removal, and no exposed backend tokens in client code.
- Cloudflare Workers deployment config using the current OpenNext adapter path.
- Automated proof suite for the two required fintech pain points.

## Commands

```bash
npm install
npm run dev
npm run verify
npm run test:e2e
npm run cf:check
npm run deploy
```

## Environment

Runtime ledger backend variables:

```bash
FINTECH_LEDGER_SERVICE_URL=https://ledger-service.example.com
FINTECH_SERVICE_TOKEN=server-side-token-only
```

Cloudflare deployment variables can be supplied as either Wrangler standard names or the aliases already present in `../.env`:

```bash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...

# accepted aliases
ACCOUNT_ID=...
API_TOKEN=...
```

See [docs/PAIN_POINT_PROOF.md](D:/Project_Frontend3/Project3/docs/PAIN_POINT_PROOF.md) and [docs/CLOUDFLARE_DEPLOYMENT.md](D:/Project_Frontend3/Project3/docs/CLOUDFLARE_DEPLOYMENT.md).
