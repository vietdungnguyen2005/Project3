"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Eye,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { LedgerGrid } from "@/components/ledger-grid";
import {
  applyLedgerFilters,
  calculateLedgerMetrics,
  LEDGER_SIZE,
  prependLiveTransaction,
  TRANSACTION_STATUSES,
  type LedgerTransaction,
  type TransactionStatus,
} from "@/lib/ledger";

type LedgerApiResponse = {
  rows: LedgerTransaction[];
  total: number;
  source: string;
};

const statusOptions: Array<"all" | TransactionStatus> = ["all", ...TRANSACTION_STATUSES];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function compactCurrency(value: number) {
  return currency.format(value);
}

async function requestLedger() {
  const response = await fetch("/api/ledger", {
    cache: "no-store",
    headers: { "x-request-id": crypto.randomUUID() },
  });

  if (!response.ok) {
    throw new Error("Ledger proxy returned an unavailable status");
  }

  return (await response.json()) as LedgerApiResponse;
}

export function LedgerDashboard() {
  const [rows, setRows] = useState<LedgerTransaction[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);

  const loadLedger = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await requestLedger();
      setRows(payload.rows);
      setLastSync(new Date());
    } catch {
      setError("Secure ledger proxy is unavailable");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    void requestLedger()
      .then((payload) => {
        if (!isActive) {
          return;
        }

        setRows(payload.rows);
        setLastSync(new Date());
      })
      .catch(() => {
        if (isActive) {
          setError("Secure ledger proxy is unavailable");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!("EventSource" in window)) {
      return;
    }

    const source = new EventSource("/api/ledger/stream");

    source.onopen = () => setIsLiveConnected(true);
    source.onerror = () => setIsLiveConnected(false);
    source.onmessage = (event) => {
      try {
        const transaction = JSON.parse(event.data) as LedgerTransaction;
        setRows((currentRows) => prependLiveTransaction(currentRows, transaction, LEDGER_SIZE));
        setLastSync(new Date());
      } catch {
        setError("Live ledger event rejected");
      }
    };

    return () => {
      source.close();
    };
  }, []);

  const filteredRows = useMemo(() => {
    return applyLedgerFilters(rows, { query, status });
  }, [query, rows, status]);

  const metrics = useMemo(() => {
    return calculateLedgerMetrics(rows);
  }, [rows]);

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
              {isLiveConnected ? "Live stream active" : "Private headers masked"}
            </span>
            <button
              className="flex items-center gap-2 rounded border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-emerald-100 transition hover:bg-emerald-300/15 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-emerald-300"
              onClick={() => void loadLedger()}
              type="button"
            >
              <RefreshCw size={14} />
              Sync
            </button>
          </div>
        </header>

        <section className="grid gap-3 lg:grid-cols-4">
          <MetricCard
            icon={<ArrowUpRight size={18} />}
            label="Net exposure"
            tone="positive"
            value={compactCurrency(metrics.exposure)}
          />
          <MetricCard
            icon={<Eye size={18} />}
            label="Ledger depth"
            value={`${metrics.throughput.toLocaleString()} rows`}
          />
          <MetricCard
            icon={<AlertTriangle size={18} />}
            label="Flagged risk"
            tone="warning"
            value={metrics.flagged.toLocaleString()}
          />
          <MetricCard
            icon={<ArrowDownRight size={18} />}
            label="Pending settlement"
            tone="cyan"
            value={metrics.pending.toLocaleString()}
          />
        </section>

        <section className="grid min-h-[720px] gap-4 xl:grid-cols-[310px_1fr]">
          <aside className="border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
            <div className="mb-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Control Plane
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">Ledger filters</h2>
            </div>

            <label className="text-xs font-medium uppercase tracking-[0.12em] text-[color:var(--muted)]">
              Search ledger
              <span className="mt-2 flex items-center gap-2 border border-[color:var(--line)] bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white">
                <Search size={16} className="text-[color:var(--muted)]" />
                <input
                  className="w-full bg-transparent outline-none placeholder:text-slate-500"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ID, account, counterparty"
                  value={query}
                />
              </span>
            </label>

            <div className="mt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-[color:var(--muted)]">
                Status
              </p>
              <div className="grid grid-cols-2 gap-2">
                {statusOptions.map((option) => (
                  <button
                    className={`rounded border px-3 py-2 text-sm capitalize transition focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-emerald-300 ${
                      status === option
                        ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-100"
                        : "border-[color:var(--line)] bg-black/20 text-[color:var(--muted)] hover:text-white"
                    }`}
                    key={option}
                    onClick={() => setStatus(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 border-t border-[color:var(--line)] pt-5 text-sm text-[color:var(--muted)]">
              <div className="flex justify-between gap-3">
                <span>Visible set</span>
                <strong className="text-white">{filteredRows.length.toLocaleString()}</strong>
              </div>
              <div className="mt-3 flex justify-between gap-3">
                <span>Last sync</span>
                <strong className="text-white">
                  {lastSync ? lastSync.toLocaleTimeString() : "Pending"}
                </strong>
              </div>
              <div className="mt-3 flex justify-between gap-3">
                <span>Live stream</span>
                <strong className={isLiveConnected ? "text-emerald-200" : "text-[color:var(--warning)]"}>
                  {isLiveConnected ? "Connected" : "Reconnecting"}
                </strong>
              </div>
              <div className="mt-3 flex justify-between gap-3">
                <span>DOM mode</span>
                <strong className="text-emerald-200">Recycled</strong>
              </div>
            </div>
          </aside>

          <LedgerGrid error={error} isLoading={isLoading} rows={filteredRows} />
        </section>
      </section>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  tone = "default",
  value,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "positive" | "warning" | "cyan";
  value: string;
}) {
  const toneClass = {
    default: "text-white",
    positive: "text-[color:var(--positive)]",
    warning: "text-[color:var(--warning)]",
    cyan: "text-[color:var(--cyan)]",
  }[tone];

  return (
    <article className="border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
      <div className="flex items-center justify-between gap-3 text-[color:var(--muted)]">
        <span className="text-xs uppercase tracking-[0.16em]">{label}</span>
        {icon}
      </div>
      <p className={`mt-4 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </article>
  );
}
