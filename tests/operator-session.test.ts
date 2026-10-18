import { afterEach, expect, it, vi } from "vitest";
import { operatorFetch } from "@/lib/operator-session";

afterEach(() => vi.unstubAllGlobals());

it("does not send a mutation for a signed-out reader", async () => {
  const upstream = vi.fn().mockResolvedValue(Response.json({ authenticated: false, roles: [], csrfToken: "anonymous" }));
  vi.stubGlobal("fetch", upstream);
  await expect(operatorFetch("/api/control/payments", { method: "POST" })).rejects.toThrow("sign in");
  expect(upstream).toHaveBeenCalledTimes(1);
});
