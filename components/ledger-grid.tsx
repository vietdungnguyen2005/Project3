"use client";

import { useMemo, useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownUp, Loader2 } from "lucide-react";
import type { LedgerTransaction, TransactionStatus } from "@/lib/ledger";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const statusClass: Record<TransactionStatus, string> = {
  settled: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  pending: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  flagged: "border-rose-300/35 bg-rose-300/10 text-rose-100",
  reversed: "border-zinc-300/25 bg-zinc-300/10 text-zinc-200",
};

export function LedgerGrid({
  error,
  isLoading,
  rows,
}: {
  error: string | null;
  isLoading: boolean;
  rows: LedgerTransaction[];
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const columns = useMemo<Array<ColumnDef<LedgerTransaction>>>(
    () => [
      {
        accessorKey: "id",
        header: "Transaction",
        cell: ({ row }) => <span className="font-medium text-white">{row.original.id}</span>,
        size: 156,
      },
      {
        accessorKey: "postedAt",
        header: "Posted",
        cell: ({ row }) => dateTime.format(new Date(row.original.postedAt)),
        size: 138,
      },
      {
        accessorKey: "account",
        header: "Account",
        cell: ({ row }) => row.original.account,
        size: 142,
      },
      {
        accessorKey: "counterparty",
        header: "Counterparty",
        cell: ({ row }) => row.original.counterparty,
        size: 176,
      },
      {
        accessorKey: "rail",
        header: "Rail",
        cell: ({ row }) => row.original.rail,
        size: 88,
      },
      {
        accessorKey: "debit",
        header: "Debit",
        cell: ({ row }) => (
          <span className="text-rose-100">{row.original.debit ? money.format(row.original.debit) : "-"}</span>
        ),
        size: 132,
      },
      {
        accessorKey: "credit",
        header: "Credit",
        cell: ({ row }) => (
          <span className="text-emerald-100">{row.original.credit ? money.format(row.original.credit) : "-"}</span>
        ),
        size: 132,
      },
      {
        accessorKey: "balance",
        header: "Balance",
        cell: ({ row }) => money.format(row.original.balance),
        size: 146,
      },
      {
        accessorKey: "riskScore",
        header: "Risk",
        cell: ({ row }) => (
          <span className={row.original.riskScore > 90 ? "text-rose-100" : "text-[color:var(--muted)]"}>
            {row.original.riskScore}
          </span>
        ),
        size: 82,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <span className={`rounded border px-2 py-1 text-xs capitalize ${statusClass[row.original.status]}`}>
            {row.original.status}
          </span>
        ),
        size: 118,
      },
      {
        accessorKey: "region",
        header: "Region",
        cell: ({ row }) => row.original.region,
        size: 92,
      },
    ],
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table exposes stateful table APIs by design.
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 14,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <section className="min-w-0 border border-[color:var(--line)] bg-[color:var(--panel)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--line)] px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Historical transaction ledger</h2>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {virtualRows.length.toLocaleString()} mounted rows from {tableRows.length.toLocaleString()} records
          </p>
        </div>
        <span className="flex items-center gap-2 rounded border border-[color:var(--line)] bg-black/25 px-3 py-2 text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">
          <ArrowDownUp size={14} />
          Virtual scroll
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1400px]">
          <div className="grid grid-cols-[156px_138px_142px_176px_88px_132px_132px_146px_82px_118px_92px] border-b border-[color:var(--line)] bg-[color:var(--panel-strong)]">
            {table.getHeaderGroups().map((headerGroup) =>
              headerGroup.headers.map((header) => (
                <div
                  className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted)]"
                  key={header.id}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </div>
              )),
            )}
          </div>

          <div
            className="relative h-[620px] overflow-auto"
            ref={parentRef}
            role="region"
            aria-label="Virtualized transaction ledger"
          >
            {isLoading ? (
              <div className="flex h-full items-center justify-center gap-3 text-[color:var(--muted)]">
                <Loader2 className="animate-spin" size={18} />
                Loading secure ledger stream
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center text-rose-100">{error}</div>
            ) : (
              <div className="relative w-full" style={{ height: `${totalSize}px` }}>
                {virtualRows.map((virtualRow) => {
                  const row = tableRows[virtualRow.index];
                  return (
                    <div
                      className="absolute left-0 grid w-full grid-cols-[156px_138px_142px_176px_88px_132px_132px_146px_82px_118px_92px] border-b border-white/[0.045] text-sm text-slate-300 hover:bg-emerald-300/[0.045]"
                      data-index={virtualRow.index}
                      data-ledger-row
                      key={row.id}
                      ref={virtualizer.measureElement}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <div className="flex h-12 items-center overflow-hidden px-3" key={cell.id}>
                          <span className="truncate">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
