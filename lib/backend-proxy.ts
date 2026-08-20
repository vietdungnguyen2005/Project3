import "server-only";

const allowedTargets = [
  /^reliability\/overview(?:\?.*)?$/,
  /^payments(?:\?.*)?$/,
  /^payments\/[A-Z0-9-]+$/,
  /^parking(?:\?.*)?$/,
  /^parking\/[A-Z0-9-]+\/replay$/,
  /^rails(?:\?.*)?$/,
  /^demo\/rails\/(?:ZENGIN|CARD|SWIFT)\/fault-profile$/,
];

const operationsTargets = [/^parking\/.+\/replay$/, /^demo\/rails\/.+\/fault-profile$/];

function jsonError(code: string, message: string, status: number) {
  return Response.json({ code, message }, { status });
}

export async function proxyBackend(target: string, request: Request) {
  if (!allowedTargets.some((pattern) => pattern.test(target))) {
    return jsonError("ROUTE_NOT_ALLOWED", "This backend route is not exposed by the BFF.", 404);
  }

  const origin = process.env.BACKEND_ORIGIN?.replace(/\/$/, "");
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
  if (operationsTargets.some((pattern) => pattern.test(target))) {
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
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return jsonError("BACKEND_UNAVAILABLE", "The payment service is temporarily unreachable.", 503);
  }
}
