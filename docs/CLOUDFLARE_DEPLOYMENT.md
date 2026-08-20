# Free-tier deployment split

The Next.js BFF is prepared for Cloudflare Workers through OpenNext. The Java backend is a portable non-root Docker image and can run on a free container host while PostgreSQL and Redis use free managed services. This is one repository and one system, not two duplicate projects.

## Backend host

Build `backend/Dockerfile`, expose port `8080`, and configure all Spring variables from `.env.example`. Set `DEPLOYMENT_ENVIRONMENT=production`, use distinct random secrets of at least 32 characters, and enable `VPULSE_DEMO_DATA_ENABLED=true` only for the public portfolio demo.

## Cloudflare Worker

Set the backend origin as a Worker variable and both credentials as Worker secrets:

```bash
npx wrangler secret put BFF_SHARED_SECRET
npx wrangler secret put VPULSE_OPS_SECRET
npm run cf:build
npm run deploy
```

`BACKEND_ORIGIN` must point to the public HTTPS backend URL. The browser cannot read Worker secrets. If the backend sleeps or is unavailable, the UI shows a truthful degraded state; it never substitutes synthetic payment data.
