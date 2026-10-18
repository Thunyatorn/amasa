import { z } from "zod";
import type { ProgressEvent } from "@amasa/schemas";
import { runShop } from "../../../lib/agent/shop-run.ts";
import { ApiError, parseBody, route } from "../../../lib/http.ts";
import { createRateLimiter } from "../../../lib/rate-limit.ts";
import { requireSessionAndCsrf, sessionId } from "../../../lib/session.ts";
import { encodeEvent, SSE_HEADERS, SSE_PADDING } from "../../../lib/shop/sse.ts";

// Node, not edge: the run uses better-sqlite3.
export const runtime = "nodejs";

const ShopBody = z.strictObject({ contractId: z.string().uuid() });
const limiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

// POST /api/shop (SPEC §5, §6): stages 2–5 as a text/event-stream of ProgressEvents. Closing the
// request (Cancel in the UI) aborts the run: no further model or store calls are made.
export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const { contractId } = await parseBody(request, ShopBody);
  if (!limiter.allow(sessionId(request))) {
    throw new ApiError(429, "RATE_LIMITED", "You've started many searches this hour. Please try again later.");
  }
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(sink) {
      sink.enqueue(encoder.encode(SSE_PADDING));
      const emit = (event: ProgressEvent) => {
        if (!closed) sink.enqueue(encoder.encode(encodeEvent(event)));
      };
      void runShop(contractId, emit, controller.signal).finally(() => {
        if (closed) return;
        closed = true;
        sink.close();
      });
    },
    cancel() {
      closed = true;
      controller.abort();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
});
