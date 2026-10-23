import { expect, it } from "vitest";
import { readFileSync } from "node:fs";

it("keeps reconciliation visibility in the existing dashboard with identity-free metric labels", () => {
  const dashboard = JSON.parse(readFileSync("infra/grafana/dashboards/payment-reliability.json", "utf8"));
  const queries = dashboard.panels.flatMap((panel: { targets: {expr: string}[] }) => panel.targets.map(target => target.expr)).join("\n");
  for (const metric of ["vpulse_reconciliation_attempts_total", "vpulse_reconciliation_oldest_unresolved_seconds", "vpulse_reconciliation_lookup_failures_total", "vpulse_reconciliation_latency_seconds_sum", "vpulse_replay_unsafe_rejected_total"]) expect(queries).toContain(metric);
  expect(queries).not.toMatch(/payment_id|merchant_id|provider_reference/);
});
