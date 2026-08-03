import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Eye,
} from "lucide-react";
import type { LedgerMetrics } from "@/lib/ledger";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function compactCurrency(value: number) {
  return currency.format(value);
}

export function LedgerMetricsStrip({ metrics }: { metrics: LedgerMetrics }) {
  return (
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
