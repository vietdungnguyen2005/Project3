import { expect, it, vi } from "vitest";
import { PaymentCreateHandler } from "@/lib/payment-create/handler";
import { paymentIntentKey } from "@/lib/payment-create/spec";

const payload = { merchantId: "DEMO-MERCHANT", rail: "CARD", amountMinor: 42000, currency: "JPY" };
const detail = { payment: { ...payload, paymentNumber: "VP-ABCDEF123456", status: "SUCCEEDED", createdAt: "2026-10-18T00:00:00Z" }, attempts: [], parkedReason: null };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

it("rejects a second same-component submit while the first is still in flight", async () => {
  const tab = storage();
  let release!: (response: Response) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }));
  const handler = new PaymentCreateHandler({ storage: tab, request });
  const first = handler.execute(payload);
  const second = handler.execute(payload);
  release(new Response(JSON.stringify(detail), { status: 201 }));
  expect((await first).success).toBe(true);
  const duplicate = await second;
  expect(!duplicate.success && duplicate.error.code).toBe("BUSY");
  expect(request).toHaveBeenCalledTimes(1);
});

it("persists an immutable intent before sending and reuses it after a lost response and reload", async () => {
  const tab = storage();
  const request = vi.fn().mockRejectedValueOnce(new TypeError("lost response"))
    .mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }));
  const first = await new PaymentCreateHandler({ storage: tab, request }).execute(payload);
  expect(first.success).toBe(false);
  const second = await new PaymentCreateHandler({ storage: tab, request }).execute(payload);
  expect(second.success).toBe(true);
  expect(new Headers(request.mock.calls[0][1].headers).get("Idempotency-Key"))
    .toBe(new Headers(request.mock.calls[1][1].headers).get("Idempotency-Key"));
});

it("keeps PROCESSING identity and refuses changed details without sending another request", async () => {
  const tab = storage();
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...detail, payment: { ...detail.payment, status: "PROCESSING" } }), { status: 202 }));
  const handler = new PaymentCreateHandler({ storage: tab, request });
  expect((await handler.execute(payload)).success).toBe(true);
  expect(tab.getItem(paymentIntentKey)).not.toBeNull();
  const changed = await handler.execute({ ...payload, amountMinor: 99000 });
  expect(!changed.success && changed.error.code).toBe("PAYLOAD_CHANGED");
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(["not-json", "{}", '{"version":99}'])("does not replace corrupt saved metadata: %s", async raw => {
  const tab = storage();
  tab.setItem(paymentIntentKey, raw);
  const request = vi.fn();
  const result = await new PaymentCreateHandler({ storage: tab, request }).execute(payload);
  expect(!result.success && result.error.code).toBe("INVALID_STORAGE");
  expect(request).not.toHaveBeenCalled();
  expect(tab.getItem(paymentIntentKey)).toBe(raw);
});

it("does not dispatch if the operation cannot be durably recorded", async () => {
  const tab = storage();
  tab.setItem = () => { throw new Error("quota"); };
  const request = vi.fn();
  const result = await new PaymentCreateHandler({ storage: tab, request }).execute(payload);
  expect(!result.success && result.error.code).toBe("STORAGE_UNAVAILABLE");
  expect(request).not.toHaveBeenCalled();
});

it("keeps the intent when a successful HTTP response describes different payment details", async () => {
  const tab = storage();
  const request = vi.fn(async () => {
    expect(tab.getItem(paymentIntentKey)).not.toBeNull();
    return new Response(JSON.stringify({ ...detail, payment: { ...detail.payment, amountMinor: 99 } }), { status: 201 });
  });
  const result = await new PaymentCreateHandler({ storage: tab, request }).execute(payload);
  expect(!result.success && result.error.code).toBe("INVALID_RESPONSE");
  expect(tab.getItem(paymentIntentKey)).not.toBeNull();
});
