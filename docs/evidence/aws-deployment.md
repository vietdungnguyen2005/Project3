# AWS deployment evidence

## Result

V-Pulse was deployed and exercised on AWS on `2026-08-20T15:15:52Z` from Git commit `2ec5014f0cdad6a74b5f452d40f6a397bf15017d`. The environment was deliberately short-lived because the AWS Academy account does not expose Budgets or normal Free Tier account controls.

| Check | Recorded result |
|---|---|
| Terraform bootstrap | `43 added, 0 changed, 0 destroyed` |
| Verified teardown | `43 destroyed`; Terraform state contains `0` resources |
| Public readiness | `GET /actuator/health/readiness` → HTTP `200` through API Gateway HTTPS |
| Trust boundary | Business API without BFF credential → HTTP `401` |
| ECS | service `ACTIVE`, desired `1`, running `1`, pending `0` |
| PostgreSQL | RDS PostgreSQL `available`, `db.t4g.micro`, encrypted, non-public, single-AZ evidence mode |
| Redis | ElastiCache `available`, transit encryption on, at-rest encryption on |
| Container | ECR immutable tag equals the full Git SHA; pushed digest begins `sha256:ffcc34b9734a` |
| Observability | Container Insights, seven-day application logs, an operations dashboard, target 5xx and unhealthy-target alarms |

The endpoint was `https://i6r3kx0a3l.execute-api.us-east-1.amazonaws.com` during verification. It is historical evidence, not a permanent demo URL; the Cloudflare free-tier deployment remains the long-lived demo.

## Pain-point proof on AWS

The controlled test reproduced an ambiguous payment timeout and then performed an authorized recovery:

1. Set the CARD simulator to `TIMEOUT` through the operations-protected endpoint.
2. Submit one JPY payment; the API persisted it as `PARKED` with reason `TIMEOUT`.
3. Return the rail to `NORMAL` and replay payment `VP-79599EA7D1B0`.
4. The payment became `SUCCEEDED` with exactly two attempts: `TIMEOUT`, then `AUTHORIZED`.

This demonstrates that the same idempotent parking/replay design covered by the Testcontainers integration suite also works with managed RDS, managed Redis, ECS networking, SSM secrets, and the AWS HTTPS edge.

## Reproduction and limits

The reproducible infrastructure is in [`infra/terraform/aws`](../../infra/terraform/aws/README.md). Sensitive Terraform state, non-public AWS identifiers, ARNs, credentials, and secret values are intentionally excluded from evidence. CloudFront, cost budgets, and GitHub OIDC could not be applied in this Academy account; the reference deployment documents the intended replacement instead of claiming controls that were not verified.
