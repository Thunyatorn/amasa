import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

// §10.3 step 1: the payments service listens on loopback only, never on a public interface.
export const HOST = "127.0.0.1";
const DEFAULT_PORT = 4100;

type ErrorBody = { code: string; message: string };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const notFound: ErrorBody = { code: "NOT_FOUND", message: "No such route." };
  sendJson(res, 404, notFound);
}

export function createPaymentsServer(): Server {
  return createServer(handle);
}

export function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

if (require.main === module) {
  const port = parsePort(process.env.PORT);
  createPaymentsServer().listen(port, HOST, () => {
    console.log(`payments listening on http://${HOST}:${port}`);
  });
}
