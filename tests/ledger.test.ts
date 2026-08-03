import { describe, expect, it } from "vitest";
import {
  applyLedgerFilters,
  calculateLedgerMetrics,
  createLedgerTransaction,
  generateLedger,
  generateLedgerWindow,
  LEDGER_SIZE,
  prependLiveTransaction,
} from "@/lib/ledger";

describe("ledger data model", () => {
  it("creates a deterministic 100,000-row historical ledger", () => {
    const rows = generateLedger(LEDGER_SIZE);

    expect(rows).toHaveLength(100_000);
    expect(rows[0]).toMatchObject({
      id: "VP-00000001",
      account: "ACCT-730000",
    });
    expect(rows.at(-1)?.id).toBe("VP-00100000");
  });

  it("keeps generated transaction amounts one-sided", () => {
    const rows = generateLedger(2_000);

    expect(rows.every((row) => row.debit === 0 || row.credit === 0)).toBe(true);
    expect(rows.every((row) => row.debit >= 0 && row.credit >= 0)).toBe(true);
  });

  it("filters by status and searchable financial identifiers", () => {
    const rows = generateLedger(500);
    const filtered = applyLedgerFilters(rows, { query: "Nova", status: "settled" });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((row) => row.counterparty.includes("Nova") && row.status === "settled")).toBe(true);
  });

  it("calculates dashboard metrics from the full ledger", () => {
    const rows = generateLedger(1_000);
    const metrics = calculateLedgerMetrics(rows);

    expect(metrics.throughput).toBe(1_000);
    expect(metrics.flagged).toBe(rows.filter((row) => row.status === "flagged").length);
    expect(metrics.pending).toBe(rows.filter((row) => row.status === "pending").length);
  });

  it("prepends live transactions without unbounded client growth", () => {
    const rows = generateLedger(5);
    const transaction = createLedgerTransaction(100_001);

    const updated = prependLiveTransaction(rows, transaction, 5);

    expect(updated).toHaveLength(5);
    expect(updated[0].id).toBe(transaction.id);
    expect(updated.at(-1)?.id).toBe(rows[3].id);
  });

  it("creates bounded ledger windows without allocating the entire ledger", () => {
    const window = generateLedgerWindow({ offset: 1_200, limit: 50 });

    expect(window.total).toBe(LEDGER_SIZE);
    expect(window.offset).toBe(1_200);
    expect(window.limit).toBe(50);
    expect(window.rows).toHaveLength(50);
    expect(window.rows[0].id).toBe("VP-00001201");
    expect(window.rows.at(-1)?.id).toBe("VP-00001250");
  });
});
