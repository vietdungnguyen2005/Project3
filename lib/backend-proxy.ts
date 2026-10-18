import "server-only";

const readTargets = [
  /^reliability\/overview$/,
  /^payments$/,
  /^payments\/[A-Z0-9-]+$/,
  /^parking$/,
  /^rails$/,
  /^auth\/session$/,
];
const writeTargets = [
  /^payments$/,
  /^parking\/[A-Z0-9-]+\/replay$/,
  /^demo\/rails\/(?:ZENGIN|CARD|SWIFT)\/fault-profile$/,
  /^auth\/(?:login|logout)$/,
];

const operationsTargets = [/^parking\/.+\/replay$/, /^demo\/rails\/.+\/fault-profile$/];

function jsonError(code: string, message: string, status: number) {
  return Response.json({ code, message }, { status });
}

export async function proxyBackend(target: string, request: Request) {
  const pathname = target.split("?")[0];
  if (![...readTargets, ...writeTargets].some((pattern) => pattern.test(pathname))) {
    return jsonError("ROUTE_NOT_ALLOWED", "This backend route is not exposed by the BFF.", 404);
  }
  const allowed = request.method === "GET" ? readTargets : request.method === "POST" ? writeTargets : [];
  if (!allowed.some((pattern) => pattern.test(pathname))) {
    const methods = [readTargets.some((p) => p.test(pathname)) ? "GET" : "", writeTargets.some((p) => p.test(pathname)) ? "POST" : ""].filter(Boolean).join(", ");
    return Response.json({ code: "METHOD_NOT_ALLOWED", message: "This method is not exposed." }, { status: 405, headers: { Allow: methods } });
  }

  const origin = process.env.BACKEND_ORIGIN?.replace(/\/$/, "");
  if (request.method === "POST") {
    const publicUrl = new URL(request.url);
    const host = request.headers.get("host");
    if (host) publicUrl.host = host;
    const incomingOrigin = request.headers.get("origin");
    if ((incomingOrigin && incomingOrigin !== publicUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return jsonError("ORIGIN_REJECTED", "Cross-origin mutations are not allowed.", 403);
    }
  }
  const bffSecret = process.env.BFF_SHARED_SECRET;
  if (!origin || !bffSecret) {
    return jsonError("BACKEND_NOT_CONFIGURED", "The live backend is not configured for this deployment.", 503);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-V-Pulse-BFF-Secret": bffSecret,
  };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  const cookie = request.headers.get("cookie");
  const csrf = request.headers.get("x-csrf-token");
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-TOKEN"] = csrf;
  const operationKey = request.headers.get("idempotency-key");
  if (pathname === "payments" && request.method === "POST" && operationKey) headers["Idempotency-Key"] = operationKey;
  if (operationsTargets.some((pattern) => pattern.test(pathname))) {
    const opsSecret = process.env.VPULSE_OPS_SECRET;
    if (!opsSecret) return jsonError("OPS_NOT_CONFIGURED", "Operations controls are disabled.", 503);
    headers["X-V-Pulse-Ops-Secret"] = opsSecret;
  }

  try {
    const response = await fetch(`${origin}/api/${target}`, {
      body: request.body ? await request.text() : undefined,
      cache: "no-store",
      headers,
      method: request.method,
    });
    const responseHeaders = new Headers({
      "Content-Type": response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    });
    for (const cookie of response.headers.getSetCookie()) responseHeaders.append("Set-Cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonError("BACKEND_UNAVAILABLE", "The payment service is temporarily unreachable.", 503);
  }
}
