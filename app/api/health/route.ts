import { NextResponse } from "next/server";
import { resolveLedgerServiceUrl, secureJsonHeaders } from "@/lib/ledger-proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  let ledgerMode: "brokered" | "synthetic" | "misconfigured" = "synthetic";

  try {
    ledgerMode = resolveLedgerServiceUrl() ? "brokered" : "synthetic";
  } catch {
    ledgerMode = "misconfigured";
  }

  return NextResponse.json(
    {
      ok: ledgerMode !== "misconfigured",
      app: "v-pulse",
      ledgerMode,
      timestamp: new Date().toISOString(),
    },
    { headers: secureJsonHeaders() },
  );
}
