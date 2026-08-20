"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CircleCheck, Clock3, Play, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import {
  classifyReliability,
  formatYen,
  type FailureMode,
  type Payment,
  type PaymentDetail,
  type PaymentWindow,
  type RailName,
  type ReliabilityOverview,
} from "@/lib/reliability";

type ApiFailure = { code?: string; message?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/control/${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const body = (await response.json()) as T & ApiFailure;
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}

function secondsLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function ReliabilityControlPlane() {
  const [overview, setOverview] = useState<ReliabilityOverview | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [parking, setParking] = useState<Payment[]>([]);
  const [selected, setSelected] = useState<PaymentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [rail, setRail] = useState<RailName>("ZENGIN");
  const [amount, setAmount] = useState("42000");

  const load = useCallback(async () => {
    try {
      const [nextOverview, window, parked] = await Promise.all([
        api<ReliabilityOverview>("reliability/overview"),
        api<PaymentWindow>("payments?limit=200"),
        api<Payment[]>("parking"),
      ]);
      setOverview(nextOverview);
      setPayments(window.rows);
      setParking(parked);
      setLastSync(new Date());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the control plane.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const health = useMemo(() => (overview ? classifyReliability(overview) : "UNKNOWN"), [overview]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function setFaultProfile(targetRail: RailName, failureMode: FailureMode) {
    await run(`rail-${targetRail}`, () =>
      api(`demo/rails/${targetRail}/fault-profile`, {
        method: "POST",
        body: JSON.stringify({ failureMode, delayMs: failureMode === "NORMAL" ? 35 : 0 }),
      }),
    );
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    await run("payment", () =>
      api("payments", {
        method: "POST",
        body: JSON.stringify({ merchantId: "DEMO-MERCHANT", rail, amountMinor: Number(amount), currency: "JPY" }),
      }),
    );
  }

  async function openDetail(paymentNumber: string) {
    setBusy(`detail-${paymentNumber}`);
    try {
      setSelected(await api<PaymentDetail>(`payments/${paymentNumber}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load payment detail.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen px-4 py-5 text-[color:var(--foreground)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1760px]">
        <header className="mb-5 flex flex-col justify-between gap-5 border-b border-[color:var(--line)] pb-5 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
              <span className="status-chip"><ShieldCheck size={13} /> BFF trust boundary</span>
              <span className="status-chip"><Activity size={13} /> Java virtual threads</span>
              <span className="status-chip">PostgreSQL + Redis</span>
            </div>
            <p className="mb-1 font-mono text-xs uppercase tracking-[0.26em] text-[color:var(--accent)]">Payment reliability control plane</p>
            <h1 className="text-4xl font-black uppercase tracking-[-0.04em] text-white sm:text-6xl">V-Pulse / Ops</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--muted)]">
              Contain failing payment rails, park uncertain work, and recover it without duplicate settlement.
            </p>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs">
            <div className={`health-badge ${health === "HEALTHY" ? "health-good" : "health-bad"}`}>
              <span className="pulse-dot" /> SLO {health}
            </div>
            <button className="action-button" disabled={busy !== null} onClick={() => void load()} type="button">
              <RefreshCw className={busy ? "animate-spin" : ""} size={14} /> Sync
            </button>
          </div>
        </header>

        {error ? (
          <div className="mb-4 flex items-center gap-3 border border-red-400/40 bg-red-950/45 px-4 py-3 text-sm text-red-100" role="alert">
            <AlertTriangle size={17} /> <span><strong>Control plane degraded.</strong> {error}</span>
          </div>
        ) : null}

        <section className="metric-grid" aria-label="Reliability indicators">
          <Metric label="Success rate" value={overview ? `${overview.successRate.toFixed(2)}%` : "—"} hint="target ≥ 99.90%" tone="green" />
          <Metric label="Parked work" value={overview?.parked.toLocaleString() ?? "—"} hint="requires operator recovery" tone={overview?.parked ? "red" : "green"} />
          <Metric label="Oldest parked" value={overview ? secondsLabel(overview.oldestParkedSeconds) : "—"} hint="recovery age" tone={overview?.oldestParkedSeconds ? "amber" : "green"} />
          <Metric label="Processed" value={overview?.throughput.toLocaleString() ?? "—"} hint={`${overview?.processing ?? 0} currently in-flight`} tone="cyan" />
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
          <aside className="panel">
            <PanelTitle index="01" title="Rail containment" subtitle="Inject a controlled dependency fault" />
            <div className="space-y-3 p-3">
              {overview?.rails.map((item) => (
                <article className="rail-card" key={item.rail}>
                  <div className="flex items-start justify-between gap-2">
                    <div><h3 className="font-mono text-sm font-bold text-white">{item.rail}</h3><p className="mt-1 text-xs text-[color:var(--muted)]">{item.displayName}</p></div>
                    <span className={`circuit ${item.circuitState === "CLOSED" ? "circuit-closed" : "circuit-open"}`}>{item.circuitState}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-1">
                    {(["NORMAL", "TIMEOUT", "REJECT"] as FailureMode[]).map((mode) => (
                      <button className={`profile-button ${item.failureMode === mode ? "profile-active" : ""}`} disabled={busy !== null} key={mode} onClick={() => void setFaultProfile(item.rail, mode)} type="button">{mode}</button>
                    ))}
                  </div>
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted)]">{item.bufferedCalls} calls sampled · {item.simulatedDelayMs}ms latency</p>
                </article>
              )) ?? <Skeleton />}
            </div>

            <form className="border-t border-[color:var(--line)] p-4" onSubmit={(event) => void submitPayment(event)}>
              <p className="mb-3 font-mono text-xs font-bold uppercase tracking-wider text-white">Send controlled payment</p>
              <label className="field-label" htmlFor="rail">Rail</label>
              <select className="field" id="rail" onChange={(event) => setRail(event.target.value as RailName)} value={rail}>
                <option>ZENGIN</option><option>CARD</option><option>SWIFT</option>
              </select>
              <label className="field-label" htmlFor="amount">Amount (JPY)</label>
              <input className="field" id="amount" min="1" onChange={(event) => setAmount(event.target.value)} required type="number" value={amount} />
              <button className="primary-button mt-3 w-full" disabled={busy !== null || Number(amount) < 1} type="submit"><Send size={14} /> Process payment</button>
            </form>
          </aside>

          <section className="panel min-w-0">
            <PanelTitle index="02" title="Payment stream" subtitle={`${payments.length} newest instructions · click for attempts`} />
            <div className="table-shell">
              <table className="ops-table">
                <thead><tr><th>Payment</th><th>Merchant</th><th>Rail</th><th>Amount</th><th>State</th><th>Created</th></tr></thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.paymentNumber} onClick={() => void openDetail(payment.paymentNumber)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") void openDetail(payment.paymentNumber); }}>
                      <td className="font-mono text-white">{payment.paymentNumber}</td><td>{payment.merchantId}</td><td className="font-mono">{payment.rail}</td><td>{formatYen(payment.amountMinor)}</td><td><Status status={payment.status} /></td><td className="whitespace-nowrap">{new Date(payment.createdAt).toLocaleTimeString("en-GB")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!payments.length && !error ? <div className="p-12 text-center text-sm text-[color:var(--muted)]"><RefreshCw className="mx-auto mb-3 animate-spin" size={18} /> Loading live payment stream…</div> : null}
            </div>
          </section>

          <aside className="panel">
            <PanelTitle index="03" title="Recovery queue" subtitle="Explicit replay · audited operator action" />
            <div className="max-h-[760px] space-y-2 overflow-y-auto p-3">
              {parking.map((payment) => (
                <article className="parking-card" key={payment.paymentNumber}>
                  <div className="flex justify-between gap-2"><button className="font-mono text-xs font-bold text-white hover:text-[color:var(--accent)]" onClick={() => void openDetail(payment.paymentNumber)} type="button">{payment.paymentNumber}</button><span className="font-mono text-[10px] text-red-300">PARKED</span></div>
                  <p className="mt-2 text-xs text-[color:var(--muted)]">{payment.rail} · {formatYen(payment.amountMinor)}</p>
                  <button className="replay-button mt-3" disabled={busy !== null} onClick={() => void run(`replay-${payment.paymentNumber}`, () => api(`parking/${payment.paymentNumber}/replay`, { method: "POST" }))} type="button"><Play size={12} /> Replay once rail is healthy</button>
                </article>
              ))}
              {!parking.length && overview ? <div className="p-8 text-center text-sm text-[color:var(--muted)]"><CircleCheck className="mx-auto mb-3 text-emerald-300" /> Recovery queue clear</div> : null}
            </div>
          </aside>
        </section>

        <footer className="mt-4 flex flex-wrap justify-between gap-3 border-t border-[color:var(--line)] py-4 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
          <span>Automatic refresh / 15s · mutations require server-held ops credential</span><span>Last sync / {lastSync?.toLocaleTimeString("en-GB") ?? "pending"}</span>
        </footer>
      </div>

      {selected ? <DetailDrawer detail={selected} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return <article className={`metric metric-${tone}`}><p>{label}</p><strong>{value}</strong><span>{hint}</span></article>;
}

function PanelTitle({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="panel-title"><span>{index}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function Status({ status }: { status: Payment["status"] }) {
  return <span className={`payment-status status-${status.toLowerCase()}`}>{status}</span>;
}

function Skeleton() {
  return <div className="h-28 animate-pulse border border-[color:var(--line)] bg-white/[0.03]" />;
}

function DetailDrawer({ detail, onClose }: { detail: PaymentDetail; onClose: () => void }) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose} role="presentation">
      <aside aria-label="Payment details" className="detail-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <button aria-label="Close payment details" className="drawer-close" onClick={onClose} type="button"><X /></button>
        <p className="eyebrow">Execution record</p><h2 className="mt-2 font-mono text-2xl font-black text-white">{detail.payment.paymentNumber}</h2>
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><span>Merchant</span><strong>{detail.payment.merchantId}</strong></div><div><span>Amount</span><strong>{formatYen(detail.payment.amountMinor)}</strong></div><div><span>Rail</span><strong>{detail.payment.rail}</strong></div><div><span>State</span><strong><Status status={detail.payment.status} /></strong></div></div>
        {detail.parkedReason ? <div className="mt-5 border-l-2 border-red-400 bg-red-950/35 p-3 text-sm text-red-100"><strong>Park reason:</strong> {detail.parkedReason}</div> : null}
        <h3 className="mt-8 font-mono text-xs font-bold uppercase tracking-widest text-white">Attempt timeline</h3>
        <div className="mt-3 space-y-3">{detail.attempts.map((attempt) => <article className="attempt" key={attempt.attemptNumber}><Clock3 size={14} /><div><strong>#{attempt.attemptNumber} · {attempt.outcome}</strong><p>{attempt.detail}</p><span>{attempt.latencyMs}ms · {new Date(attempt.createdAt).toLocaleString("en-GB")}</span></div></article>)}</div>
      </aside>
    </div>
  );
}
