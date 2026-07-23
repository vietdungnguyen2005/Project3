import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(file: string) {
  return readFileSync(path.resolve(file), "utf8");
}

describe("fintech pain point proofs", () => {
  it("solves DOM flooding by rendering virtual rows instead of every ledger record", () => {
    const grid = source("components/ledger-grid.tsx");

    expect(grid).toContain("@tanstack/react-virtual");
    expect(grid).toContain("useVirtualizer");
    expect(grid).toContain("virtualRows.map");
    expect(grid).toContain("data-ledger-row");
    expect(grid).not.toMatch(/tableRows\.map\(/);
  });

  it("solves reverse proxy brokerage by keeping sensitive upstream access in server-only modules", () => {
    const route = source("app/api/ledger/route.ts");
    const proxy = source("lib/ledger-proxy.ts");
    const dashboard = source("components/ledger-dashboard.tsx");

    expect(route).toContain("buildForwardHeaders");
    expect(proxy).toContain("server-only");
    expect(proxy).toContain("PROXY_ALLOWED_REQUEST_HEADERS");
    expect(dashboard).not.toMatch(/FINTECH_LEDGER_SERVICE_URL|FINTECH_SERVICE_TOKEN|SECRET_ACCESS_KEY|API_TOKEN/);
  });
});
