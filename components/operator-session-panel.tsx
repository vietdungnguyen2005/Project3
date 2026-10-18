"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getOperatorSession, type OperatorSession } from "@/lib/operator-session";

export function OperatorSessionPanel({ onAccessChange }: { onAccessChange: (allowed: boolean) => void }) {
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void getOperatorSession(controller.signal).then((current) => {
        if (controller.signal.aborted) return;
        setSession(current);
        onAccessChange(current.authenticated && current.roles.includes("ROLE_OPERATOR"));
      }).catch(() => {
        if (!controller.signal.aborted) { onAccessChange(false); setError("Session unavailable. Public data remains read-only."); }
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [onAccessChange]);

  async function authenticate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const form = event?.currentTarget;
    const data = form ? new FormData(form) : null;
    setBusy(true); setError(""); onAccessChange(false);
    try {
      const current = await getOperatorSession();
      const response = await fetch(data ? "/api/control/auth/login" : "/api/control/auth/logout", {
        method: "POST", headers: { "X-CSRF-TOKEN": current.csrfToken },
        body: data ? new URLSearchParams({ username: String(data.get("username")), password: String(data.get("password")) }) : undefined,
      });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many sign-in attempts. Try again in a minute." : "Authentication failed. Check your credentials and retry.");
      form?.reset();
      const next = await getOperatorSession();
      setSession(next);
      onAccessChange(next.authenticated && next.roles.includes("ROLE_OPERATOR"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Authentication unavailable."); }
    finally { setBusy(false); }
  }

  return <section className="panel mb-4 p-4" aria-label="Operator access">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-xs text-[color:var(--muted)]" role="status">
        {session?.authenticated ? `Session / ${session.username} · ${session.roles.includes("ROLE_OPERATOR") ? "operator" : "read-only"}` : "Public demo / read-only · Simulated payments only"}
      </p>
      {session?.authenticated
        ? <button className="action-button" type="button" disabled={busy} onClick={() => void authenticate()}>Sign out</button>
        : <details><summary className="cursor-pointer font-mono text-xs text-[color:var(--accent)]">Operator sign-in</summary>
          <form onSubmit={(event) => void authenticate(event)} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="field-label">Username<input className="field" name="username" autoComplete="username" required maxLength={100} /></label>
            <label className="field-label">Password<input className="field" name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
            <button className="action-button" type="submit" disabled={busy || !session}>Sign in</button>
          </form>
        </details>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-200">{error}</p>}
  </section>;
}
