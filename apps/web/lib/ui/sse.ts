import { ProgressEvent } from "../../../../packages/schemas/src/progress.ts";

export { ProgressEvent };

// Parses `text/event-stream` chunks as they arrive (SPEC §6). Comment lines (":", the 1 KB padding)
// are skipped; every event is validated, and anything that is not a ProgressEvent is dropped.
export function createSseParser(onEvent: (event: ProgressEvent) => void) {
  let buffer = "";
  const flush = (block: string) => {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    try {
      const parsed = ProgressEvent.safeParse(JSON.parse(data));
      if (parsed.success) onEvent(parsed.data);
    } catch {
      // A malformed line is ignored; the run's own error or done event decides the outcome.
    }
  };
  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        flush(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
  };
}

const ErrorBody = { parse(raw: unknown): string | null {
  const message = (raw as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.length <= 500 ? message : null;
} };

// Starts a shopping run and feeds its events to `onEvent` until the stream ends. Throws an Error with
// a plain message when the run cannot start. Aborting `signal` (Cancel) closes the request, which
// stops the run on the server.
export async function streamShop(contractId: string, signal: AbortSignal, onEvent: (event: ProgressEvent) => void): Promise<void> {
  let token: string;
  try {
    const session = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store", signal });
    const body = (await session.json()) as { token?: unknown };
    if (!session.ok || typeof body.token !== "string") throw new Error();
    token = body.token;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("We couldn't start your session. Please reload the page and try again.");
  }
  let response: Response;
  try {
    response = await fetch("/api/shop", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", "x-csrf-token": token },
      body: JSON.stringify({ contractId }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("We couldn't connect. Please try again.");
  }
  if (!response.ok || !response.body) {
    const message = response.status >= 500 ? null : ErrorBody.parse(await response.json().catch(() => null));
    throw new Error(message ?? "Something went wrong. Please try again.");
  }
  const parser = createSseParser(onEvent);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    parser.push(value);
  }
}
