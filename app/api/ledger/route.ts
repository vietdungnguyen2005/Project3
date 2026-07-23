import { NextResponse } from "next/server";
import { calculateLedgerMetrics, generateLedgerWindow, type LedgerMetrics } from "@/lib/ledger";
import {
  buildForwardHeaders,
  buildLedgerEndpoint,
  normalizeLedgerRows,
  resolveLedgerServiceUrl,
  sanitizeLedgerWindowParams,
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
  const windowParams = sanitizeLedgerWindowParams(new URL(request.url).searchParams);
  let upstream: string | null;

  try {
    upstream = resolveLedgerServiceUrl();
  } catch {
    return secureJson({ error: "Ledger proxy configuration is invalid" }, 500);
  }

  if (!upstream) {
    const ledgerWindow = generateLedgerWindow(windowParams);

    return secureJson({
      source: "synthetic-secure-proxy",
      mode: "synthetic",
      ...ledgerWindow,
    });
  }

  try {
    const upstreamEndpoint = new URL(buildLedgerEndpoint(upstream));
    upstreamEndpoint.searchParams.set("offset", String(windowParams.offset));
    upstreamEndpoint.searchParams.set("limit", String(windowParams.limit));

    if (windowParams.query) {
      upstreamEndpoint.searchParams.set("query", windowParams.query);
    }

    if (windowParams.status !== "all") {
      upstreamEndpoint.searchParams.set("status", windowParams.status);
    }

    const response = await fetch(upstreamEndpoint, {
      method: "GET",
      headers: buildForwardHeaders(request),
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return secureJson({ error: "Ledger service unavailable" }, 502);
    }

    const data = await response.json();
    const rows = normalizeLedgerRows(data, windowParams.limit);
    const total =
      data && typeof data === "object" && typeof (data as { total?: unknown }).total === "number"
        ? (data as { total: number }).total
        : rows.length;
    const offset =
      data && typeof data === "object" && typeof (data as { offset?: unknown }).offset === "number"
        ? (data as { offset: number }).offset
        : windowParams.offset;
    const metrics =
      data && typeof data === "object" && isLedgerMetrics((data as { metrics?: unknown }).metrics)
        ? (data as { metrics: LedgerMetrics }).metrics
        : calculateLedgerMetrics(rows);

    return secureJson({
      source: "brokered-ledger-service",
      mode: "brokered",
      rows,
      total,
      offset,
      limit: windowParams.limit,
      metrics,
    });
  } catch {
    return secureJson({ error: "Ledger proxy request failed" }, 502);
  }
}

function isLedgerMetrics(value: unknown): value is LedgerMetrics {
  if (!value || typeof value !== "object") {
    return false;
  }

  const metrics = value as Record<string, unknown>;
  return (
    typeof metrics.exposure === "number" &&
    typeof metrics.throughput === "number" &&
    typeof metrics.flagged === "number" &&
    typeof metrics.pending === "number"
  );
}
