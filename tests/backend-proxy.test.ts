import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyBackend } from "@/lib/backend-proxy";

describe("proxyBackend", () => {
  it("exposes only the reconciliation investigation/lookup/resolve routes with server operations trust", async () => {
    vi.stubEnv("BACKEND_ORIGIN","https://backend.test");vi.stubEnv("BFF_SHARED_SECRET","bff");vi.stubEnv("VPULSE_OPS_SECRET","ops");
    const upstream=vi.fn().mockResolvedValue(Response.json({state:"OBSERVED"}));vi.stubGlobal("fetch",upstream);
    const response=await proxyBackend("payments/VP-TEST/reconciliation",new Request("https://ui.test/api/control/payments/VP-TEST/reconciliation",{
      method:"POST",headers:{"X-CSRF-TOKEN":"csrf","X-V-Pulse-Ops-Secret":"forged"},
    }));
    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0][1].headers["X-V-Pulse-Ops-Secret"]).toBe("ops");
    expect(upstream.mock.calls[0][1].headers["X-CSRF-TOKEN"]).toBe("csrf");
  });
  it("forwards the original payment operation key without generating a replacement", async () => {
    vi.stubEnv("BACKEND_ORIGIN", "https://backend.test");
    vi.stubEnv("BFF_SHARED_SECRET", "trusted");
    const upstream = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", upstream);
    await proxyBackend("payments", new Request("https://ui.test/api/control/payments", {
      method: "POST", headers: { "Idempotency-Key": "original-operation-key" }, body: "{}",
    }));
    expect(upstream.mock.calls[0][1].headers["Idempotency-Key"]).toBe("original-operation-key");
  });

  it("forwards session and CSRF headers and preserves session cookies", async () => {
    vi.stubEnv("BACKEND_ORIGIN", "https://backend.test");
    vi.stubEnv("BFF_SHARED_SECRET", "trusted");
    const upstream = vi.fn().mockResolvedValue(new Response(null, { status: 204, headers: { "Set-Cookie": "VPULSE_SESSION=rotated; HttpOnly; Secure; SameSite=Lax" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await proxyBackend("auth/login", new Request("https://ui.test/api/control/auth/login", {
      method: "POST", headers: { Cookie: "VPULSE_SESSION=before", "X-CSRF-TOKEN": "csrf" },
    }));
    const options = upstream.mock.calls[0][1];
    expect(options.headers.Cookie).toBe("VPULSE_SESSION=before");
    expect(options.headers["X-CSRF-TOKEN"]).toBe("csrf");
    expect(response.headers.getSetCookie()).toEqual(["VPULSE_SESSION=rotated; HttpOnly; Secure; SameSite=Lax"]);
    expect(response.status).toBe(204);
  });
  it("rejects a cross-origin write without calling upstream", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await proxyBackend("payments", new Request("https://ui.test/api/control/payments", {
      method: "POST", headers: { Origin: "https://attacker.test" },
    }));
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects mutation methods on read-only routes before forwarding", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await proxyBackend("rails?unused=true", new Request("https://ui.test", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards an allow-listed request with server-only credentials", async () => {
    vi.stubEnv("BACKEND_ORIGIN", "https://backend.example.test/");
    vi.stubEnv("BFF_SHARED_SECRET", "bff-secret");
    vi.stubEnv("VPULSE_OPS_SECRET", "ops-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ parked: 4 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyBackend("parking/VP-1/replay", new Request("https://ui.test", { method: "POST" }));

    expect(fetchMock).toHaveBeenCalledWith("https://backend.example.test/api/parking/VP-1/replay", {
      body: undefined,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-V-Pulse-BFF-Secret": "bff-secret",
        "X-V-Pulse-Ops-Secret": "ops-secret",
      },
      method: "POST",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ parked: 4 });
  });
});
