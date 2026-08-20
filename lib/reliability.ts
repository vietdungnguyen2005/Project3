export type PaymentStatus = "SUCCEEDED" | "PROCESSING" | "PARKED";
export type RailName = "ZENGIN" | "CARD" | "SWIFT";
export type FailureMode = "NORMAL" | "TIMEOUT" | "REJECT";

export type Payment = {
  paymentNumber: string;
  merchantId: string;
  rail: RailName;
  amountMinor: number;
  currency: "JPY";
  status: PaymentStatus;
  createdAt: string;
};

export type PaymentWindow = {
  rows: Payment[];
  total: number;
  offset: number;
  limit: number;
};

export type Rail = {
  rail: RailName;
  displayName: string;
  failureMode: FailureMode;
  simulatedDelayMs: number;
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
  bufferedCalls: number;
  updatedAt: string;
};

export type ReliabilityOverview = {
  throughput: number;
  succeeded: number;
  processing: number;
  parked: number;
  successRate: number;
  oldestParkedSeconds: number;
  rails: Rail[];
};

export type PaymentAttempt = {
  attemptNumber: number;
  outcome: string;
  latencyMs: number;
  detail: string;
  createdAt: string;
};

export type PaymentDetail = {
  payment: Payment;
  attempts: PaymentAttempt[];
  parkedReason: string | null;
};

type ReliabilitySignal = Pick<ReliabilityOverview, "parked" | "successRate"> & {
  rails: Array<Pick<Rail, "circuitState">>;
};

export function classifyReliability(signal: ReliabilitySignal) {
  if (signal.parked > 0 || signal.successRate < 99.9 || signal.rails.some((rail) => rail.circuitState !== "CLOSED")) {
    return "BREACH" as const;
  }
  return "HEALTHY" as const;
}

export function formatYen(amountMinor: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(
    amountMinor,
  );
}
