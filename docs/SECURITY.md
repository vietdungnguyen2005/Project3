# Security model

- The public browser calls only `/api/control/*`; `lib/backend-proxy.ts` has a strict allow-list and imports `server-only`.
- `BFF_SHARED_SECRET` and `VPULSE_OPS_SECRET` are injected only on server-to-server requests and must be distinct strong values in production.
- Spring compares shared secrets with constant-time `MessageDigest.isEqual`; production startup rejects defaults and values shorter than 32 characters.
- Mutating fault-profile and replay endpoints require the operations secret in addition to BFF trust.
- CSP uses a per-request nonce. Responses deny framing, MIME sniffing, camera, microphone, geolocation, and browser payment APIs.
- Containers and Kubernetes pods run non-root with privilege escalation disabled; the Helm workload uses a read-only root filesystem and drops all Linux capabilities.
- `.env*`, `.dev.vars`, build output, test reports, and backend targets are ignored. Run `npm audit` and `./mvnw verify` before release.

This demo uses shared service credentials because there is no end-user identity provider. A production control plane should add SSO, role-based replay authorization, secret rotation, immutable centralized audit storage, and CSRF protection appropriate to its authentication mechanism.
