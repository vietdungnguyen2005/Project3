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

export const ledgerStatusClass: Record<TransactionStatus, string> = {
  settled: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  pending: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  flagged: "border-rose-300/35 bg-rose-300/10 text-rose-100",
  reversed: "border-zinc-300/25 bg-zinc-300/10 text-zinc-200",
};

export type LedgerColumn = {
  id: keyof LedgerTransaction;
  header: string;
  width: number;
  cell: (row: LedgerTransaction) => React.ReactNode;
};

export function formatLedgerMoney(value: number) {
  return money.format(value);
}

export function formatLedgerDate(value: string) {
  return dateTime.format(new Date(value));
}

export const ledgerGridColumns: LedgerColumn[] = [
  {
    id: "id",
    header: "Transaction",
    width: 156,
    cell: (row) => <span className="font-medium text-white">{row.id}</span>,
  },
  {
    id: "postedAt",
    header: "Posted",
    width: 138,
    cell: (row) => formatLedgerDate(row.postedAt),
  },
  {
    id: "account",
    header: "Account",
    width: 142,
    cell: (row) => row.account,
  },
  {
    id: "counterparty",
    header: "Counterparty",
    width: 176,
    cell: (row) => row.counterparty,
  },
  {
    id: "rail",
    header: "Rail",
    width: 88,
    cell: (row) => row.rail,
  },
  {
    id: "debit",
    header: "Debit",
    width: 132,
    cell: (row) => <span className="text-rose-100">{row.debit ? formatLedgerMoney(row.debit) : "-"}</span>,
  },
  {
    id: "credit",
    header: "Credit",
    width: 132,
    cell: (row) => <span className="text-emerald-100">{row.credit ? formatLedgerMoney(row.credit) : "-"}</span>,
  },
  {
    id: "balance",
    header: "Balance",
    width: 146,
    cell: (row) => formatLedgerMoney(row.balance),
  },
  {
    id: "riskScore",
    header: "Risk",
    width: 82,
    cell: (row) => (
      <span className={row.riskScore > 90 ? "text-rose-100" : "text-[color:var(--muted)]"}>
        {row.riskScore}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    width: 118,
    cell: (row) => (
      <span className={`rounded border px-2 py-1 text-xs capitalize ${ledgerStatusClass[row.status]}`}>
        {row.status}
      </span>
    ),
  },
  {
    id: "region",
    header: "Region",
    width: 92,
    cell: (row) => row.region,
  },
];

export const ledgerGridTemplateColumns = ledgerGridColumns.map((column) => `${column.width}px`).join(" ");
