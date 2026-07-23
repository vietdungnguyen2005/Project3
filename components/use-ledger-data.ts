"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LEDGER_SIZE,
  matchesLedgerFilters,
  type LedgerApiResponse,
  type LedgerMetrics,
  type LedgerMode,
  type LedgerStatusFilter,
  type LedgerTransaction,
} from "@/lib/ledger";

const LEDGER_CLIENT_WINDOW_SIZE = 600;
const emptyMetrics: LedgerMetrics = { exposure: 0, throughput: 0, flagged: 0, pending: 0 };

async function requestLedgerWindow({
  limit,
  offset,
  query,
  status,
}: {
  limit: number;
  offset: number;
  query: string;
  status: LedgerStatusFilter;
}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  if (query.trim()) {
    params.set("query", query.trim());
  }

  if (status !== "all") {
    params.set("status", status);
  }

  const response = await fetch(`/api/ledger?${params.toString()}`, {
    cache: "no-store",
    headers: { "x-request-id": crypto.randomUUID() },
  });

  if (!response.ok) {
    throw new Error("Ledger proxy returned an unavailable status");
  }

  return (await response.json()) as LedgerApiResponse;
}

export function useLedgerData({
  query,
  status,
}: {
  query: string;
  status: LedgerStatusFilter;
}) {
  const rowCacheRef = useRef<Map<number, LedgerTransaction>>(new Map());
  const pendingWindowRef = useRef<Set<number>>(new Set());
  const loadedWindowRef = useRef<Set<number>>(new Set());
  const [rowsByIndex, setRowsByIndex] = useState<ReadonlyMap<number, LedgerTransaction>>(new Map());
  const [metrics, setMetrics] = useState<LedgerMetrics>(emptyMetrics);
  const [totalRows, setTotalRows] = useState(0);
  const [ledgerMode, setLedgerMode] = useState<LedgerMode | "unknown">("unknown");
  const [isLoading, setIsLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [latestTransaction, setLatestTransaction] = useState<LedgerTransaction | null>(null);

  const clearRows = useCallback(() => {
    rowCacheRef.current = new Map();
    pendingWindowRef.current.clear();
    loadedWindowRef.current.clear();
    setRowsByIndex(new Map());
    setTotalRows(0);
    setMetrics(emptyMetrics);
  }, []);

  const loadWindow = useCallback(
    async (requestedOffset = 0) => {
      const alignedOffset = Math.max(
        0,
        Math.floor(requestedOffset / LEDGER_CLIENT_WINDOW_SIZE) * LEDGER_CLIENT_WINDOW_SIZE,
      );

      if (
        pendingWindowRef.current.has(alignedOffset) ||
        loadedWindowRef.current.has(alignedOffset)
      ) {
        return;
      }

      pendingWindowRef.current.add(alignedOffset);
      setIsLoading(rowCacheRef.current.size === 0);
      setError(null);

      try {
        const payload = await requestLedgerWindow({
          limit: LEDGER_CLIENT_WINDOW_SIZE,
          offset: alignedOffset,
          query,
          status,
        });
        const nextRows = new Map(rowCacheRef.current);

        payload.rows.forEach((row, index) => {
          nextRows.set(payload.offset + index, row);
        });

        rowCacheRef.current = nextRows;
        loadedWindowRef.current.add(alignedOffset);
        setRowsByIndex(nextRows);
        setTotalRows(payload.total);
        setMetrics(payload.metrics);
        setLedgerMode(payload.mode);
        setLastSync(new Date());
      } catch {
        setError("Secure ledger proxy is unavailable");
      } finally {
        pendingWindowRef.current.delete(alignedOffset);
        setIsLoading(false);
      }
    },
    [query, status],
  );

  const refresh = useCallback(() => {
    clearRows();
    setIsLoading(true);
    void loadWindow(0);
  }, [clearRows, loadWindow]);

  const ensureVisibleRange = useCallback(
    (startIndex: number, endIndex: number) => {
      void loadWindow(startIndex);
      void loadWindow(endIndex);
    },
    [loadWindow],
  );

  useEffect(() => {
    let isCancelled = false;

    void Promise.resolve().then(() => {
      if (isCancelled) {
        return;
      }

      clearRows();
      setLedgerMode("unknown");
      setLatestTransaction(null);
      setIsLoading(true);
      void loadWindow(0);
    });

    return () => {
      isCancelled = true;
    };
  }, [clearRows, loadWindow]);

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

        if (matchesLedgerFilters(transaction, { query, status })) {
          setLatestTransaction(transaction);
        }

        setLastSync(new Date());
      } catch {
        setError("Live ledger event rejected");
      }
    };

    return () => {
      source.close();
    };
  }, [query, status]);

  return {
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
    totalRows: totalRows || (isLoading ? LEDGER_SIZE : 0),
    windowSize: LEDGER_CLIENT_WINDOW_SIZE,
  };
}
