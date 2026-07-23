import { describe, expect, it } from "vitest";
import { createLedgerTransaction } from "@/lib/ledger";
import {
  buildForwardHeaders,
  buildLedgerEndpoint,
  normalizeLedgerRows,
  PROXY_ALLOWED_REQUEST_HEADERS,
  resolveLedgerServiceUrl,
  sanitizeLedgerWindowParams,
  sanitizeLedgerLimit,
} from "@/lib/ledger-proxy";

describe("ledger proxy security", () => {
  it("forwards only allowlisted correlation headers and injects the server-side token", () => {
    const request = new Request("https://v-pulse.test/api/ledger", {
      headers: {
        authorization: "Bearer client-token",
        cookie: "session=client",
        "x-api-key": "client-secret",
        "x-correlation-id": "corr-1",
        "x-request-id": "req-1",
      },
    });

    const headers = buildForwardHeaders(request, "server-token");

    expect(PROXY_ALLOWED_REQUEST_HEADERS).toEqual(["x-request-id", "x-correlation-id"]);
    expect(headers.get("authorization")).toBe("Bearer server-token");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("x-request-id")).toBe("req-1");
    expect(headers.get("x-correlation-id")).toBe("corr-1");
  });

  it("requires HTTPS for production upstreams", () => {
    expect(() =>
      resolveLedgerServiceUrl({ FINTECH_LEDGER_SERVICE_URL: "http://internal-ledger.test" }, true),
    ).toThrow(/HTTPS/);
    expect(resolveLedgerServiceUrl({ FINTECH_LEDGER_SERVICE_URL: "https://ledger.example.com/" }, true)).toBe(
      "https://ledger.example.com",
    );
  });

  it("builds canonical upstream endpoints without leaking browser query strings", () => {
    expect(buildLedgerEndpoint("https://ledger.example.com/base?token=bad#frag")).toBe(
      "https://ledger.example.com/base/ledger",
    );
    expect(buildLedgerEndpoint("https://ledger.example.com", "ledger/stream")).toBe(
      "https://ledger.example.com/ledger/stream",
    );
  });

  it("normalizes untrusted upstream payloads to valid ledger rows only", () => {
    const valid = createLedgerTransaction(7);
    const rows = normalizeLedgerRows({ rows: [valid, { id: "bad" }, null] });

    expect(rows).toEqual([valid]);
  });

  it("caps requested ledger limits at the verified virtualization target", () => {
    expect(sanitizeLedgerLimit(null)).toBe(100_000);
    expect(sanitizeLedgerLimit("250")).toBe(250);
    expect(sanitizeLedgerLimit("9999999")).toBe(100_000);
    expect(sanitizeLedgerLimit("-1")).toBe(100_000);
  });

  it("sanitizes server-side window params for ledger brokerage", () => {
    const params = new URLSearchParams({
      offset: "1200",
      limit: "75",
      query: "Nova",
      status: "flagged",
    });

    expect(sanitizeLedgerWindowParams(params)).toEqual({
      offset: 1_200,
      limit: 75,
      query: "Nova",
      status: "flagged",
    });
  });
});
