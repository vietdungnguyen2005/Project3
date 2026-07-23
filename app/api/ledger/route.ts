import { NextResponse } from "next/server";
import { generateLedger } from "@/lib/ledger";
import {
  buildForwardHeaders,
  buildLedgerEndpoint,
  normalizeLedgerRows,
  resolveLedgerServiceUrl,
  sanitizeLedgerLimit,
  secureJsonHeaders,
} from "@/lib/ledger-proxy";

export const dynamic = "force-dynamic";

function secureJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: secureJsonHeaders(),
  });
}

export async function GET(request: Request) {
  const limit = sanitizeLedgerLimit(new URL(request.url).searchParams.get("limit"));
  let upstream: string | null;

  try {
    upstream = resolveLedgerServiceUrl();
  } catch {
    return secureJson({ error: "Ledger proxy configuration is invalid" }, 500);
  }

  if (!upstream) {
    return secureJson({
      source: "synthetic-secure-proxy",
      rows: generateLedger(limit),
      total: limit,
    });
  }

  try {
    const response = await fetch(buildLedgerEndpoint(upstream), {
      method: "GET",
      headers: buildForwardHeaders(request),
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return secureJson({ error: "Ledger service unavailable" }, 502);
    }

    const data = await response.json();
    const rows = normalizeLedgerRows(data, limit);

    return secureJson({
      source: "brokered-ledger-service",
      rows,
      total: rows.length,
    });
  } catch {
    return secureJson({ error: "Ledger proxy request failed" }, 502);
  }
}
