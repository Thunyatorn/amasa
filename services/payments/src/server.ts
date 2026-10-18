import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { defaultDbPath, openPaymentsDb } from "./db";
import { handlePay, type PayDeps } from "./pay";
import { loadPublicKey } from "./verdict";
import { createLink, extractLink } from "./visa";

// §10.3 step 1: the payments service listens on loopback only, never on a public interface.
export const HOST = "127.0.0.1";
const DEFAULT_PORT = 4100;
const MAX_BODY_BYTES = 64 * 1024;
// Shorter than the web app's 90 s client timeout, so the web side always gets a definite answer.
const VISA_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Visa did not answer in time")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

type ErrorBody = { code: string; message: string };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: PayDeps | undefined): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && path === "/pay") {
    if (!deps) { sendJson(res, 503, { code: "NOT_CONFIGURED", message: "Payments are not configured." }); return; }
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
      sendJson(res, 415, { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send JSON." });
      return;
    }
    const text = await readBody(req);
    if (text === null) { sendJson(res, 413, { code: "TOO_LARGE", message: "Request body is too large." }); return; }
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      sendJson(res, 400, { code: "INVALID_JSON", message: "The request body is not valid JSON." });
      return;
    }
    const result = await handlePay(body, deps);
    // Log only the purchase number and the outcome: never the request body.
    const pn = typeof (body as { fields?: { purchaseNumber?: unknown } })?.fields?.purchaseNumber === "string"
      ? (body as { fields: { purchaseNumber: string } }).fields.purchaseNumber.replace(/[^A-Z0-9]/g, "").slice(0, 16) || "?" : "?";
    console.log(`pay ${pn} -> ${result.status} ${"code" in result.body ? result.body.code : "LINK_CREATED"}`);
    sendJson(res, result.status, result.body);
    return;
  }

  const notFound: ErrorBody = { code: "NOT_FOUND", message: "No such route." };
  sendJson(res, 404, notFound);
}

export function createPaymentsServer(deps?: PayDeps): Server {
  return createServer((req, res) => {
    handle(req, res, deps).catch((e: unknown) => {
      console.error(`payments internal error: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`);
      if (!res.headersSent) sendJson(res, 500, { code: "INTERNAL", message: "Something went wrong." });
    });
  });
}

export function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

// Fails closed: refuses to start without the verifier public key or a daily limit.
export function depsFromEnv(env: NodeJS.ProcessEnv): PayDeps {
  const maxDaily = Number(env.PAYMENTS_MAX_DAILY_CENTS);
  if (!env.PAYMENTS_MAX_DAILY_CENTS || !Number.isInteger(maxDaily) || maxDaily <= 0) {
    throw new Error("PAYMENTS_MAX_DAILY_CENTS must be a positive integer (cents)");
  }
  return {
    db: openPaymentsDb(defaultDbPath()),
    publicKey: loadPublicKey(env.VERIFIER_PUBLIC_KEY_B64),
    maxDailyCents: maxDaily,
    now: () => Date.now(),
    createLink: async (req) => {
      const result = await withTimeout(createLink(req), VISA_TIMEOUT_MS);
      return { ...extractLink(result), result };
    },
  };
}

if (require.main === module) {
  const port = parsePort(process.env.PORT);
  createPaymentsServer(depsFromEnv(process.env)).listen(port, HOST, () => {
    console.log(`payments listening on http://${HOST}:${port}`);
  });
}
