export const TRANSACTION_STATUSES = ["settled", "pending", "flagged", "reversed"] as const;
export const TRANSACTION_RAILS = ["ACH", "WIRE", "CARD", "SWIFT", "RTP"] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export type TransactionRail = (typeof TRANSACTION_RAILS)[number];
export type LedgerStatusFilter = "all" | TransactionStatus;

export type LedgerTransaction = {
  id: string;
  postedAt: string;
  account: string;
  counterparty: string;
  rail: TransactionRail;
  status: TransactionStatus;
  debit: number;
  credit: number;
  balance: number;
  riskScore: number;
  region: string;
};

export type LedgerFilters = {
  query: string;
  status: LedgerStatusFilter;
};

export type LedgerMetrics = {
  exposure: number;
  throughput: number;
  flagged: number;
  pending: number;
};

export type LedgerMode = "synthetic" | "brokered";

export type LedgerWindowRequest = {
  offset?: number;
  limit?: number;
  query?: string;
  status?: LedgerStatusFilter;
};

export type LedgerWindow = {
  rows: LedgerTransaction[];
  total: number;
  offset: number;
  limit: number;
  metrics: LedgerMetrics;
};

export type LedgerApiResponse = LedgerWindow & {
  source: string;
  mode: LedgerMode;
};

const counterparties = [
  "Nova Custody",
  "Aster Clearing",
  "BridgePay",
  "Helio Markets",
  "Matrix Prime",
  "Quanta FX",
  "Vertex Treasury",
  "Cobalt Trust",
] as const;

const regions = ["APAC", "EMEA", "LATAM", "NA"];
export const LEDGER_SIZE = 100_000;

function pseudoRandom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export function createLedgerTransaction(index: number): LedgerTransaction {
  const movement = Math.round((pseudoRandom(index + 7) * 19000 + 70) * 100) / 100;
  const isCredit = pseudoRandom(index + 17) > 0.48;
  const statusIndex = Math.floor(pseudoRandom(index + 29) * TRANSACTION_STATUSES.length);
  const riskScore = Math.round(pseudoRandom(index + 41) * 100);
  const postedAt = new Date(Date.UTC(2026, 6, 24, 0, 0, 0) - index * 45_000).toISOString();

  return {
    id: `VP-${String(index + 1).padStart(8, "0")}`,
    postedAt,
    account: `ACCT-${String(730000 + (index % 1250)).padStart(6, "0")}`,
    counterparty: counterparties[index % counterparties.length],
    rail: TRANSACTION_RAILS[index % TRANSACTION_RAILS.length],
    status: riskScore > 94 ? "flagged" : TRANSACTION_STATUSES[statusIndex],
    debit: isCredit ? 0 : movement,
    credit: isCredit ? movement : 0,
    balance: 7_500_000 + index * 13.37 + (isCredit ? movement : -movement),
    riskScore,
    region: regions[index % regions.length],
  };
}

export function generateLedger(count: number): LedgerTransaction[] {
  const safeCount = Math.max(0, Math.min(LEDGER_SIZE, Math.trunc(count)));
  return Array.from({ length: safeCount }, (_, index) => createLedgerTransaction(index));
}

function normalizeWindowNumber(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(value));
}

export function generateLedgerWindow({
  limit = 500,
  offset = 0,
  query = "",
  status = "all",
}: LedgerWindowRequest): LedgerWindow {
  const safeOffset = normalizeWindowNumber(offset, 0);
  const safeLimit = Math.min(normalizeWindowNumber(limit, 500), LEDGER_SIZE);
  const filters = { query, status };
  const rows: LedgerTransaction[] = [];
  const metrics: LedgerMetrics = { exposure: 0, throughput: 0, flagged: 0, pending: 0 };
  let total = 0;

  for (let index = 0; index < LEDGER_SIZE; index += 1) {
    const row = createLedgerTransaction(index);

    if (!matchesLedgerFilters(row, filters)) {
      continue;
    }

    metrics.exposure += row.credit - row.debit;
    metrics.throughput += 1;

    if (row.status === "flagged") {
      metrics.flagged += 1;
    }

    if (row.status === "pending") {
      metrics.pending += 1;
    }

    if (total >= safeOffset && rows.length < safeLimit) {
      rows.push(row);
    }

    total += 1;
  }

  return {
    rows,
    total,
    offset: safeOffset,
    limit: safeLimit,
    metrics,
  };
}

export function applyLedgerFilters(rows: LedgerTransaction[], filters: LedgerFilters) {
  return rows.filter((row) => matchesLedgerFilters(row, filters));
}

export function matchesLedgerFilters(row: LedgerTransaction, filters: LedgerFilters) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const matchesStatus = filters.status === "all" || row.status === filters.status;
  const matchesQuery =
    normalizedQuery.length === 0 ||
    row.id.toLowerCase().includes(normalizedQuery) ||
    row.account.toLowerCase().includes(normalizedQuery) ||
    row.counterparty.toLowerCase().includes(normalizedQuery);

  return matchesStatus && matchesQuery;
}

export function calculateLedgerMetrics(rows: LedgerTransaction[]): LedgerMetrics {
  return rows.reduce(
    (metrics, row) => {
      metrics.exposure += row.credit - row.debit;
      metrics.throughput += 1;

      if (row.status === "flagged") {
        metrics.flagged += 1;
      }

      if (row.status === "pending") {
        metrics.pending += 1;
      }

      return metrics;
    },
    { exposure: 0, throughput: 0, flagged: 0, pending: 0 },
  );
}

export function prependLiveTransaction(
  rows: LedgerTransaction[],
  transaction: LedgerTransaction,
  limit = LEDGER_SIZE,
) {
  return [transaction, ...rows].slice(0, limit);
}
