import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const backendConfigured = Boolean(process.env.BACKEND_ORIGIN && process.env.BFF_SHARED_SECRET);

  return NextResponse.json({
    ok: true,
    app: "v-pulse",
    backendConfigured,
    timestamp: new Date().toISOString(),
  });
}
