import { createLedgerTransaction, LEDGER_SIZE } from "@/lib/ledger";
import {
  buildForwardHeaders,
  buildLedgerEndpoint,
  resolveLedgerServiceUrl,
  secureEventStreamHeaders,
} from "@/lib/ledger-proxy";

export const dynamic = "force-dynamic";

function createSyntheticLedgerStream(signal: AbortSignal) {
  const encoder = new TextEncoder();
  let nextIndex = LEDGER_SIZE + Math.floor(Date.now() / 1000);
  let interval: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (interval) {
          clearInterval(interval);
        }

        try {
          controller.close();
        } catch {
          // Stream may already be closed by the runtime.
        }
      };

      const send = () => {
        const transaction = createLedgerTransaction(nextIndex);
        nextIndex += 1;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(transaction)}\n\n`));
      };

      send();
      interval = setInterval(send, 2500);
      signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
      }
    },
  });
}

function ledgerStreamUnavailable() {
  return new Response("Ledger stream unavailable", {
    status: 502,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  let upstream: string | null;

  try {
    upstream = resolveLedgerServiceUrl();
  } catch {
    upstream = null;
  }

  if (upstream) {
    try {
      const response = await fetch(buildLedgerEndpoint(upstream, "ledger/stream"), {
        method: "GET",
        headers: buildForwardHeaders(request, undefined, "text/event-stream"),
        cache: "no-store",
        signal: request.signal,
      });

      if (response.ok && response.body) {
        return new Response(response.body, { headers: secureEventStreamHeaders() });
      }

      return ledgerStreamUnavailable();
    } catch {
      return ledgerStreamUnavailable();
    }
  }

  return new Response(createSyntheticLedgerStream(request.signal), {
    headers: secureEventStreamHeaders(),
  });
}
