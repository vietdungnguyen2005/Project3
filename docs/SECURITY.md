# Security Notes

V-Pulse keeps sensitive financial connectivity behind server-side Next.js route handlers.

## Server-Side Brokerage

- Client code never calls `FINTECH_LEDGER_SERVICE_URL` directly.
- `FINTECH_SERVICE_TOKEN` is read only inside server-only proxy utilities.
- Incoming browser `authorization`, `cookie`, and arbitrary secret-like headers are not forwarded.
- Upstream requests receive a server-issued `Authorization: Bearer ...` header only when `FINTECH_SERVICE_TOKEN` is configured.
- Production upstream URLs must use HTTPS.

## Response Hardening

- `Cache-Control: no-store` on financial API responses.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- Content Security Policy restricts scripts, styles, images, fonts, connect targets, frame ancestors, base URI, and forms.
- Permissions Policy disables camera, microphone, geolocation, and payment APIs.
- `poweredByHeader: false` hides framework fingerprinting.
- `compiler.removeConsole` strips console calls from production output.

## Deployment Secrets

Do not commit `.env`, `.env.local`, or `.dev.vars`. Use Cloudflare Worker secrets for real backend tokens:

```bash
wrangler secret put FINTECH_SERVICE_TOKEN
```
