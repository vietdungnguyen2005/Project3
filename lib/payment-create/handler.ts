import { paymentCreateErrorSchema, paymentDetailSchema, paymentInputSchema, paymentIntentKey, paymentIntentSchema,
  type PaymentCreateDependencies, type PaymentCreateResult, type PaymentCreateSpec } from "./spec";
import type { z } from "zod";

type ErrorCode = z.infer<typeof paymentCreateErrorSchema>["code"];
class IntentFailure extends Error { constructor(readonly code: ErrorCode) { super(code); } }
const messages: Record<ErrorCode, string> = {
  BUSY: "A payment request is already in flight. Wait for its result before retrying.",
  INVALID_INPUT: "Review merchant, rail and integer JPY amount before sending.",
  STORAGE_UNAVAILABLE: "Tab storage is unavailable. Restore it before starting or retrying a payment.",
  INVALID_STORAGE: "Saved payment metadata is invalid. Request operator review; no replacement key was created.",
  PAYLOAD_CHANGED: "A previous payment is unresolved. Retry its original rail and amount; do not create a replacement key.",
  OUTCOME_UNKNOWN: "The payment response is unconfirmed. Keep the saved operation and retry the same details to inspect its instruction.",
  INVALID_RESPONSE: "The response could not be verified. Keep this operation key and inspect the original instruction.",
  INTENT_CHANGED: "The tab operation changed while waiting. The late response did not clear or overwrite it.",
};

export class PaymentCreateHandler implements PaymentCreateSpec {
  private busy = false;
  constructor(private readonly dependencies: PaymentCreateDependencies) {}

  async execute(input: unknown): Promise<PaymentCreateResult> {
    if (this.busy) return this.failure("BUSY");
    this.busy = true;
    try {
      const parsed = paymentInputSchema.safeParse(input);
      if (!parsed.success) return this.failure("INVALID_INPUT");
      const existing = this.read();
      let intent: z.infer<typeof paymentIntentSchema>;
      if (existing !== null) {
        let decoded: unknown;
        try { decoded = JSON.parse(existing); } catch { return this.failure("INVALID_STORAGE"); }
        const saved = paymentIntentSchema.safeParse(decoded);
        if (!saved.success) return this.failure("INVALID_STORAGE");
        intent = saved.data;
        if (JSON.stringify(intent.payload) !== JSON.stringify(parsed.data)) return this.failure("PAYLOAD_CHANGED");
      } else {
        intent = { version: 1, key: crypto.randomUUID(), payload: parsed.data };
        this.write(JSON.stringify(intent));
      }
      const current = JSON.stringify(intent);
      if (this.read() !== current) return this.failure("INTENT_CHANGED");
      const response = await this.dependencies.request("/api/control/payments", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.key },
        body: JSON.stringify(intent.payload), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return this.failure("OUTCOME_UNKNOWN");
      const result = paymentDetailSchema.safeParse(await response.json().catch(() => null));
      if (!result.success) return this.failure("INVALID_RESPONSE");
      const payment = result.data.payment;
      if (payment.merchantId !== intent.payload.merchantId || payment.rail !== intent.payload.rail
        || payment.amountMinor !== intent.payload.amountMinor || payment.currency !== intent.payload.currency) return this.failure("INVALID_RESPONSE");
      if (this.read() !== current) return this.failure("INTENT_CHANGED");
      if (payment.status !== "PROCESSING") {
        try {
          this.dependencies.storage.removeItem(paymentIntentKey);
          if (this.read() !== null) throw new Error("Metadata retained");
        } catch { return this.failure("STORAGE_UNAVAILABLE"); }
      }
      return { success: true, detail: result.data };
    } catch (failure) {
      return this.failure(failure instanceof IntentFailure ? failure.code : "OUTCOME_UNKNOWN");
    } finally { this.busy = false; }
  }

  private read(): string | null {
    try { return this.dependencies.storage.getItem(paymentIntentKey); }
    catch { throw new IntentFailure("STORAGE_UNAVAILABLE"); }
  }

  private write(value: string): void {
    try {
      this.dependencies.storage.setItem(paymentIntentKey, value);
      if (this.read() !== value) throw new Error("Metadata not retained");
    } catch { throw new IntentFailure("STORAGE_UNAVAILABLE"); }
  }

  private failure(code: ErrorCode): PaymentCreateResult { return { success: false, error: { code, message: messages[code] } }; }
}
