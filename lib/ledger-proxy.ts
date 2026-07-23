import "server-only";

import {
  LEDGER_SIZE,
  type LedgerTransaction,
  TRANSACTION_RAILS,
  TRANSACTION_STATUSES,
  type TransactionStatus,
} from "@/lib/ledger";

export const PROXY_ALLOWED_REQUEST_HEADERS = ["x-request-id", "x-correlation-id"] as const;

type RuntimeEnv = Record<string, string | undefined>;

export function sanitizeLedgerLimit(value: string | null, max = LEDGER_SIZE) {
  if (!value) {
    return max;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return max;
  }

  return Math.min(parsed, max);
}

export function sanitizeLedgerOffset(value: string | null, max = LEDGER_SIZE - 1) {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(parsed, max);
}

export function sanitizeLedgerStatus(value: string | null): "all" | TransactionStatus {
  if (value && TRANSACTION_STATUSES.includes(value as TransactionStatus)) {
    return value as TransactionStatus;
  }

  return "all";
}

export function sanitizeLedgerWindowParams(searchParams: URLSearchParams) {
  return {
    offset: sanitizeLedgerOffset(searchParams.get("offset")),
    limit: sanitizeLedgerLimit(searchParams.get("limit"), 1_500),
    query: (searchParams.get("query") ?? "").trim().slice(0, 80),
    status: sanitizeLedgerStatus(searchParams.get("status")),
  };
}

export function resolveLedgerServiceUrl(env: RuntimeEnv = process.env, requireHttps = process.env.NODE_ENV === "production") {
  const rawUrl = env.FINTECH_LEDGER_SERVICE_URL?.trim();

  if (!rawUrl) {
    return null;
  }

  const url = new URL(rawUrl);

  if (requireHttps && url.protocol !== "https:") {
    throw new Error("FINTECH_LEDGER_SERVICE_URL must use HTTPS in production");
  }

  return url.toString().replace(/\/$/, "");
}

export function buildLedgerEndpoint(baseUrl: string, path: "ledger" | "ledger/stream" = "ledger") {
  const url = new URL(baseUrl);
  const basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${basePath}${path}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildForwardHeaders(
  request: Request,
  token = process.env.FINTECH_SERVICE_TOKEN,
  accept: "application/json" | "text/event-stream" = "application/json",
) {
  const headers = new Headers({
    accept,
    "x-v-pulse-broker": "next-serverless-proxy",
  });

  for (const header of PROXY_ALLOWED_REQUEST_HEADERS) {
    const value = request.headers.get(header);

    if (value) {
      headers.set(header, value);
    }
  }

  if (token?.trim()) {
    headers.set("authorization", `Bearer ${token.trim()}`);
  }

  return headers;
}

export function secureJsonHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

export function secureEventStreamHeaders() {
  return {
    "Cache-Control": "no-cache, no-store, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  };
}

function isLedgerTransaction(value: unknown): value is LedgerTransaction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Record<string, unknown>;

  return (
    typeof row.id === "string" &&
    typeof row.postedAt === "string" &&
    typeof row.account === "string" &&
    typeof row.counterparty === "string" &&
    typeof row.region === "string" &&
    typeof row.debit === "number" &&
    typeof row.credit === "number" &&
    typeof row.balance === "number" &&
    typeof row.riskScore === "number" &&
    TRANSACTION_RAILS.includes(row.rail as LedgerTransaction["rail"]) &&
    TRANSACTION_STATUSES.includes(row.status as LedgerTransaction["status"])
  );
}

export function normalizeLedgerRows(payload: unknown, max = LEDGER_SIZE) {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { rows?: unknown }).rows)
      ? (payload as { rows: unknown[] }).rows
      : [];

  return rows.filter(isLedgerTransaction).slice(0, max);
}
