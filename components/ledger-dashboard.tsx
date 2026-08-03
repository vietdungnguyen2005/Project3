"use client";

import { useState } from "react";
import {
  Activity,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { LedgerControlPlane } from "@/components/ledger-control-plane";
import { LedgerGrid } from "@/components/ledger-grid";
import { LedgerMetricsStrip } from "@/components/ledger-metrics";
import { useLedgerData } from "@/components/use-ledger-data";
import type { LedgerStatusFilter } from "@/lib/ledger";

export function LedgerDashboard() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LedgerStatusFilter>("all");
  const {
    ensureVisibleRange,
    error,
    isLiveConnected,
    isLoading,
    lastSync,
    latestTransaction,
    ledgerMode,
    metrics,
    refresh,
    rowsByIndex,
    totalRows,
    windowSize,
  } = useLedgerData({ query, status });
  const isSyntheticMode = ledgerMode === "synthetic";
  const streamLabel = isSyntheticMode ? "Synthetic stream active" : "Live stream active";

  return (
    <main className="min-h-screen px-4 py-4 text-[color:var(--foreground)] sm:px-6 lg:px-8">
      <section className="mx-auto flex max-w-[1680px] flex-col gap-4">
        <header className="grid gap-3 border-b border-[color:var(--line)] pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
              <span className="flex items-center gap-2 rounded border border-emerald-300/20 bg-emerald-300/8 px-2.5 py-1">
                <ShieldCheck size={14} />
                Server-side brokered endpoints
              </span>
              <span className="flex items-center gap-2 rounded border border-sky-300/20 bg-sky-300/8 px-2.5 py-1">
                <Activity size={14} />
                Virtualized 100k ledger
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-normal text-white sm:text-5xl">
              V-Pulse
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--muted)]">
              Enterprise transaction observability with sensitive service credentials held behind a Next.js broker layer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
            <span className="flex items-center gap-2 rounded border border-[color:var(--line)] bg-black/25 px-3 py-2">
              <LockKeyhole size={14} />
              {isLiveConnected ? streamLabel : "Private headers masked"}
            </span>
            <button
              className="flex items-center gap-2 rounded border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-emerald-100 transition hover:bg-emerald-300/15 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-emerald-300"
              onClick={refresh}
              type="button"
            >
              <RefreshCw size={14} />
              Sync
            </button>
          </div>
        </header>

        {isSyntheticMode ? (
          <section className="border border-[color:var(--warning)]/35 bg-[color:var(--warning)]/10 px-4 py-3 text-sm text-amber-100">
            <strong className="font-semibold">Synthetic demo mode.</strong> No real ledger backend is configured yet;
            V-Pulse is proving the secured proxy and virtualization path with deterministic generated transactions.
          </section>
        ) : null}

        <LedgerMetricsStrip metrics={metrics} />

        <section className="grid min-h-[720px] gap-4 xl:grid-cols-[310px_1fr]">
          <LedgerControlPlane
            isLiveConnected={isLiveConnected}
            isSyntheticMode={isSyntheticMode}
            lastSync={lastSync}
            onQueryChange={setQuery}
            onStatusChange={setStatus}
            query={query}
            status={status}
            totalRows={totalRows}
            windowSize={windowSize}
          />

          <LedgerGrid
            error={error}
            isLoading={isLoading}
            latestTransaction={latestTransaction}
            onVisibleRangeChange={ensureVisibleRange}
            rowsByIndex={rowsByIndex}
            totalRows={totalRows}
          />
        </section>
      </section>
    </main>
  );
}
