import { expect, it } from "vitest";
import { paymentInputSchema, paymentIntentSchema } from "@/lib/payment-create/spec";

const valid = { merchantId: "DEMO-MERCHANT", rail: "CARD", amountMinor: 42000, currency: "JPY" };
it.each([{ amountMinor: 0 }, { amountMinor: 1.5 }, { amountMinor: 1_000_000_000_001 }, { currency: "USD" }, { rail: "OTHER" }, { merchantId: "bad merchant" }])(
  "rejects invalid payment inputs: %j", patch => {
    expect(paymentInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
it("normalizes merchant identity before comparison and rejects unknown intent versions", () => {
  expect(paymentInputSchema.parse({ ...valid, merchantId: " demo-merchant " })).toEqual(valid);
  expect(paymentIntentSchema.safeParse({ version: 2, key: crypto.randomUUID(), payload: valid }).success).toBe(false);
});
