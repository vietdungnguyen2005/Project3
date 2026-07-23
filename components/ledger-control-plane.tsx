"use client";

import { Search } from "lucide-react";
import {
  TRANSACTION_STATUSES,
  type LedgerStatusFilter,
} from "@/lib/ledger";

const statusOptions: LedgerStatusFilter[] = ["all", ...TRANSACTION_STATUSES];

export function LedgerControlPlane({
  isLiveConnected,
  isSyntheticMode,
  lastSync,
  onQueryChange,
  onStatusChange,
  query,
  status,
  totalRows,
  windowSize,
}: {
  isLiveConnected: boolean;
  isSyntheticMode: boolean;
  lastSync: Date | null;
  onQueryChange: (query: string) => void;
  onStatusChange: (status: LedgerStatusFilter) => void;
  query: string;
  status: LedgerStatusFilter;
  totalRows: number;
  windowSize: number;
}) {
  return (
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
            onChange={(event) => onQueryChange(event.target.value)}
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
              onClick={() => onStatusChange(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-[color:var(--line)] pt-5 text-sm text-[color:var(--muted)]">
        <LedgerFact label="Visible set" value={totalRows.toLocaleString()} />
        <LedgerFact label="Last sync" value={lastSync ? lastSync.toLocaleTimeString() : "Pending"} />
        <LedgerFact
          label="Live stream"
          tone={isLiveConnected ? "good" : "warning"}
          value={isLiveConnected ? (isSyntheticMode ? "Synthetic" : "Connected") : "Reconnecting"}
        />
        <LedgerFact label="DOM mode" tone="good" value="Recycled" />
        <LedgerFact label="Server window" tone="good" value={windowSize.toLocaleString()} />
      </div>
    </aside>
  );
}

function LedgerFact({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "good" | "warning";
  value: string;
}) {
  const valueClass = {
    default: "text-white",
    good: "text-emerald-200",
    warning: "text-[color:var(--warning)]",
  }[tone];

  return (
    <div className="mt-3 flex justify-between gap-3 first:mt-0">
      <span>{label}</span>
      <strong className={valueClass}>{value}</strong>
    </div>
  );
}
