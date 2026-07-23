# Cloudflare Deployment

Cloudflare's current Next.js guidance recommends Cloudflare Workers with the OpenNext adapter for full-stack App Router apps with Route Handlers.

## Local Credential Check

This repo accepts either standard Wrangler names or the aliases in the parent workspace `.env`:

```bash
npm run cf:check
```

Accepted aliases:

- `ACCOUNT_ID` -> `CLOUDFLARE_ACCOUNT_ID`
- `API_TOKEN` -> `CLOUDFLARE_API_TOKEN`

## Build For Workers

```bash
npm run cf:build
```

This runs `opennextjs-cloudflare build` and writes the Worker bundle to `.open-next/`.

## Deploy

```bash
npm run deploy
```

The deploy script loads `../.env` and `.env.local`, maps the aliases above, builds with OpenNext, and deploys `v-pulse-ledger-dashboard` through Wrangler.

## Backend Secrets

For a real ledger backend, configure these as Cloudflare Worker secrets or environment variables:

```bash
FINTECH_LEDGER_SERVICE_URL=https://ledger-service.example.com
wrangler secret put FINTECH_SERVICE_TOKEN
```

Without these variables, V-Pulse runs in synthetic secure-proxy mode so virtualization and proxy behavior remain demonstrable.
