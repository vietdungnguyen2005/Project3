"use client";

import { useEffect, useMemo, useRef } from "react";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownUp, Loader2 } from "lucide-react";
import {
  formatLedgerDate,
  formatLedgerMoney,
  ledgerGridColumns,
  ledgerGridTemplateColumns,
  ledgerStatusClass,
} from "@/components/ledger-grid-columns";
import type { LedgerTransaction } from "@/lib/ledger";

export function LedgerGrid({
  error,
  isLoading,
  latestTransaction,
  onVisibleRangeChange,
  rowsByIndex,
  totalRows,
}: {
  error: string | null;
  isLoading: boolean;
  latestTransaction: LedgerTransaction | null;
  onVisibleRangeChange: (startIndex: number, endIndex: number) => void;
  rowsByIndex: ReadonlyMap<number, LedgerTransaction>;
  totalRows: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const tableColumns = useMemo<Array<ColumnDef<LedgerTransaction>>>(
    () =>
      ledgerGridColumns.map((column) => ({
        id: column.id,
        header: column.header,
        size: column.width,
      })),
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table exposes stateful table APIs by design.
  const table = useReactTable({
    data: [],
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 14,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  useEffect(() => {
    const first = virtualRows[0];
    const last = virtualRows[virtualRows.length - 1];

    if (first && last) {
      onVisibleRangeChange(first.index, last.index);
    }
  }, [onVisibleRangeChange, virtualRows]);

  return (
    <section className="min-w-0 border border-[color:var(--line)] bg-[color:var(--panel)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--line)] px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Historical transaction ledger</h2>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {virtualRows.length.toLocaleString()} mounted rows from {totalRows.toLocaleString()} records
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {latestTransaction ? (
            <span className="rounded border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
              Latest {latestTransaction.id}
            </span>
          ) : null}
          <span className="flex items-center gap-2 rounded border border-[color:var(--line)] bg-black/25 px-3 py-2 text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">
            <ArrowDownUp size={14} />
            Virtual scroll
          </span>
        </div>
      </div>

      <div
        aria-colcount={ledgerGridColumns.length}
        aria-label="Virtualized transaction ledger"
        aria-rowcount={totalRows + 1}
        className="overflow-x-auto"
        role="grid"
      >
        <div className="w-full sm:min-w-[1400px]">
          <div
            className="hidden border-b border-[color:var(--line)] bg-[color:var(--panel-strong)] sm:grid"
            role="row"
            style={{ gridTemplateColumns: ledgerGridTemplateColumns }}
          >
            {table.getHeaderGroups().map((headerGroup) =>
              headerGroup.headers.map((header, index) => (
                <div
                  aria-colindex={index + 1}
                  className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted)]"
                  key={header.id}
                  role="columnheader"
                >
                  {String(header.column.columnDef.header)}
                </div>
              )),
            )}
          </div>

          <div
            aria-busy={isLoading}
            className="relative h-[620px] overflow-auto"
            data-ledger-viewport
            ref={parentRef}
            role="rowgroup"
          >
            {isLoading && rowsByIndex.size === 0 ? (
              <div className="flex h-full items-center justify-center gap-3 text-[color:var(--muted)]">
                <Loader2 className="animate-spin" size={18} />
                Loading secure ledger window
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center text-rose-100">{error}</div>
            ) : totalRows === 0 ? (
              <div className="flex h-full items-center justify-center text-[color:var(--muted)]">
                No ledger records match the current filters
              </div>
            ) : (
              <div className="relative w-full" style={{ height: `${totalSize}px` }}>
                {virtualRows.map((virtualRow) => {
                  const row = rowsByIndex.get(virtualRow.index);
                  return (
                    <div
                      aria-rowindex={virtualRow.index + 2}
                      className="absolute left-0 w-full border-b border-white/[0.045] text-sm text-slate-300 hover:bg-emerald-300/[0.045]"
                      data-index={virtualRow.index}
                      data-ledger-row
                      key={virtualRow.key}
                      ref={virtualizer.measureElement}
                      role="row"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <div className="hidden w-full sm:grid" style={{ gridTemplateColumns: ledgerGridTemplateColumns }}>
                        {ledgerGridColumns.map((column, columnIndex) => (
                          <div
                            aria-colindex={columnIndex + 1}
                            className="flex h-14 items-center overflow-hidden px-3"
                            key={column.id}
                            role="gridcell"
                          >
                            <span className="truncate">{row ? column.cell(row) : "Loading..."}</span>
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-2 p-3 sm:hidden">
                        {row ? (
                          <>
                            <div className="flex items-start justify-between gap-3" role="gridcell">
                              <div>
                                <p className="font-medium text-white">{row.id}</p>
                                <p className="mt-1 text-xs text-[color:var(--muted)]">
                                  {formatLedgerDate(row.postedAt)} · {row.rail} · {row.region}
                                </p>
                              </div>
                              <span className={`rounded border px-2 py-1 text-xs capitalize ${ledgerStatusClass[row.status]}`}>
                                {row.status}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs" role="gridcell">
                              <span className="text-[color:var(--muted)]">Account</span>
                              <strong className="text-right text-white">{row.account}</strong>
                              <span className="text-[color:var(--muted)]">Counterparty</span>
                              <strong className="text-right text-white">{row.counterparty}</strong>
                              <span className="text-[color:var(--muted)]">Movement</span>
                              <strong className="text-right text-white">
                                {row.credit ? formatLedgerMoney(row.credit) : `-${formatLedgerMoney(row.debit)}`}
                              </strong>
                            </div>
                          </>
                        ) : (
                          <div className="py-4 text-[color:var(--muted)]" role="gridcell">
                            Loading ledger row...
                          </div>
                        )}
                      </div>
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
