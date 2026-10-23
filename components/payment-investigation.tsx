"use client";

import { useCallback, useEffect, useState } from "react";
import { inspectPayment, lookupPayment, replayPayment, resolvePayment, InvestigationError, type Investigation } from "@/lib/reconciliation";

type Props = { number: string; canOperate: boolean; onChanged: () => void };

export function PaymentInvestigation({ number, canOperate, onChanged }: Props) {
  const [record, setRecord] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await inspectPayment(number, signal);
      if (!signal?.aborted) { setRecord(next); setError(null); setConfirmed(false); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Evidence unavailable. Refresh before deciding.");
    }
  }, [number]);

  useEffect(() => {
    if (!canOperate) return;
    const controller = new AbortController();
    const initial = window.setTimeout(() => void refresh(controller.signal), 0);
    return () => { window.clearTimeout(initial); controller.abort(); };
  }, [canOperate, refresh]);

  useEffect(() => {
    if (!canOperate || record?.nextAction !== "WAIT_FOR_LOOKUP") return;
    const controller = new AbortController();
    const timer = window.setInterval(() => void refresh(controller.signal), 2000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [canOperate, record?.nextAction, refresh]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError(null); setConfirmed(false);
    try { await action(); await refresh(); onChanged(); }
    catch (cause) {
      setError(cause instanceof InvestigationError && ["PAYMENT_RECONCILIATION_REQUIRED", "PAYMENT_OPERATION_REJECTED"].includes(cause.code ?? "")
        ? `Unsafe replay or stale resolution rejected. ${cause.message}`
        : cause instanceof Error ? cause.message : "Decision was not verified. Refresh the original investigation.");
    } finally { setBusy(false); }
  }

  if (!canOperate) return <section className="mt-6 border border-[color:var(--line)] p-4 text-sm text-[color:var(--muted)]">Sign in as an operator to inspect provider evidence. Unknown payments must not be blindly retried.</section>;

  const action = record?.nextAction;
  const evidence = record?.evidence[0];
  const resolve = action === "CONFIRM_SUCCESS" || action === "CONFIRM_REJECTION";
  const replay = action === "CONTROLLED_REPLAY_ALLOWED" && record?.replayPermitted;
  const lookup = action === "RECONCILE_PROVIDER";
  const label = action === "CONFIRM_SUCCESS" ? "Confirm verified success" : action === "CONFIRM_REJECTION" ? "Confirm rejection / allow controlled replay" : "Execute controlled replay";

  return <section aria-label="Provider investigation" className="mt-7 border-t border-[color:var(--line)] pt-5">
    <p className="eyebrow">Provider investigation / simulated only</p>
    <p className="mt-2 text-sm text-[color:var(--muted)]">Lookup reads the original operation. It never authorizes a payment. Resolution is a separate, audited decision.</p>
    {error ? <p className="mt-3 border border-red-400/40 bg-red-950/40 p-3 text-sm text-red-100" role="alert">{error}</p> : null}
    {!record ? <p className="mt-3 text-sm" role="status">Loading investigation…</p> : <>
      <dl className="mt-4 space-y-2 break-all text-xs"><div><dt>Current state</dt><dd className="font-mono text-white">{record.detail.payment.status}</dd></div><div><dt>Original provider reference</dt><dd className="font-mono text-white">{record.providerReference ?? "Missing — historical record; manual review required"}</dd></div><div><dt>Permitted next action</dt><dd className="font-mono text-[color:var(--accent)]" role="status">{action}</dd></div></dl>
      {action === "WAIT_FOR_LOOKUP" ? <p className="mt-3 text-sm">Reconciliation in progress. Refreshing evidence only; no automatic financial action.</p> : null}
      {action === "ALREADY_RECONCILED" ? <p className="mt-3 text-sm text-emerald-300">Successfully resolved — already reconciled. No authorization repeated.</p> : null}
      {evidence && ["UNKNOWN", "NOT_FOUND", "PROVIDER_UNAVAILABLE", "INTERRUPTED"].includes(evidence.outcome ?? "") ? <p className="mt-3 border-l-2 border-amber-300 p-3 text-sm text-amber-100">{evidence.outcome === "PROVIDER_UNAVAILABLE" ? "Provider unavailable." : "Outcome unknown or unverified."} Keep parked. NOT_FOUND is not proof of no execution; unsafe replay remains blocked.</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="action-button" disabled={busy} type="button" onClick={() => void refresh()}>Refresh evidence</button>
        {lookup ? <button className="action-button" disabled={busy} type="button" onClick={() => void act(() => lookupPayment(number))}>{busy ? "Reconciling…" : "Look up original operation"}</button> : null}
      </div>
      {resolve || replay ? <div className="mt-4 border border-amber-400/30 p-3">
        <label className="flex items-start gap-2 text-xs leading-5"><input checked={confirmed} onChange={event => setConfirmed(event.target.checked)} type="checkbox" />I reviewed the provider reference and evidence. {replay ? "This starts a new authorization attempt under the simulator's no-execution rejection guarantee." : "This records a local decision only; it does not send authorization."}</label>
        <button className="primary-button mt-3" disabled={busy || !confirmed || !!error} type="button" onClick={() => void act(() => resolve && evidence ? resolvePayment(number, evidence.id) : replayPayment(number))}>{label}</button>
      </div> : null}
      <h3 className="mt-6 font-mono text-xs uppercase tracking-widest text-white">Provider evidence</h3>
      <div className="mt-3 space-y-2">{record.evidence.map(item => <article className="border border-[color:var(--line)] p-3 text-xs" key={item.id}><strong>{item.state} / {item.outcome ?? "Pending"}</strong><p className="mt-1 break-all font-mono text-[color:var(--muted)]">{item.evidenceCode ?? "Lookup claim persisted"}</p><p className="mt-1">Requested by {item.requestedBy}{item.resolvedBy ? ` · Resolved by ${item.resolvedBy}` : ""}</p><p className="mt-1 break-all">Request {item.requestId ?? "not available"} · version {item.paymentVersion}</p></article>)}</div>
      <h3 className="mt-6 font-mono text-xs uppercase tracking-widest text-white">Audit timeline</h3>
      <ol className="mt-3 space-y-2 text-xs text-[color:var(--muted)]">{record.audit.map((item, index) => <li key={`${item.createdAt}-${index}`}><span className="text-white">{item.action}</span> · {item.actor} · {new Date(item.createdAt).toLocaleString("en-GB")}</li>)}</ol>
    </>}
  </section>;
}
