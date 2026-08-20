import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyBackend } from "@/lib/backend-proxy";

describe("proxyBackend", () => {
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
