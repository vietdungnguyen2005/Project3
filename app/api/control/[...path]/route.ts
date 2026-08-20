import { proxyBackend } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const query = new URL(request.url).search;
  return proxyBackend(`${path.join("/")}${query}`, request);
}

export const GET = forward;
export const POST = forward;
