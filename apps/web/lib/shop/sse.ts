import { ProgressEvent } from "@amasa/schemas";

// SPEC §6: `data: <ProgressEvent JSON>\n\n`, every event validated before it is sent.
export const encodeEvent = (event: ProgressEvent) => `data: ${JSON.stringify(ProgressEvent.parse(event))}\n\n`;

// Safari holds a stream until 1 KB has arrived; an SSE comment line (ignored by clients) pushes
// the first real event out at once.
export const SSE_PADDING = `:${" ".repeat(1024)}\n\n`;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform keeps compression from buffering the stream.
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
} as const;
