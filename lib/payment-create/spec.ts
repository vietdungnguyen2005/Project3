import { z } from "zod";

export const paymentIntentKey = "vpulse:payment-create:v1";
export const paymentInputSchema = z.object({
  merchantId: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/),
  rail: z.enum(["ZENGIN", "CARD", "SWIFT"]), amountMinor: z.number().int().min(1).max(1_000_000_000_000), currency: z.literal("JPY"),
}).strict();
export const paymentIntentSchema = z.object({ version: z.literal(1), key: z.string().uuid(), payload: paymentInputSchema }).strict();
export const paymentDetailSchema = z.object({
  payment: paymentInputSchema.extend({ paymentNumber: z.string().regex(/^VP-[A-Z0-9-]{6,36}$/),
    status: z.enum(["SUCCEEDED", "PROCESSING", "PARKED"]), createdAt: z.string().datetime({ offset: true }) }),
  attempts: z.array(z.object({ attemptNumber: z.number().int().positive(), outcome: z.string(), latencyMs: z.number().int().nonnegative(),
    detail: z.string(), createdAt: z.string().datetime({ offset: true }) })), parkedReason: z.string().nullable(),
});
export const paymentCreateErrorSchema = z.object({
  code: z.enum(["BUSY", "INVALID_INPUT", "STORAGE_UNAVAILABLE", "INVALID_STORAGE", "PAYLOAD_CHANGED", "OUTCOME_UNKNOWN", "INVALID_RESPONSE", "INTENT_CHANGED"]),
  message: z.string(),
});
export const paymentCreateResultSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), detail: paymentDetailSchema }),
  z.object({ success: z.literal(false), error: paymentCreateErrorSchema }),
]);
export type PaymentCreateResult = z.infer<typeof paymentCreateResultSchema>;
export interface PaymentCreateSpec { execute(input: unknown): Promise<PaymentCreateResult>; }
export type PaymentCreateDependencies = {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  request: (url: string, init: RequestInit) => Promise<Response>;
};
