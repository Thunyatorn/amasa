import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Catalog } from "../../apps/web/app/api/store/_lib/catalog.ts";
import { quote, QuoteBody, search, SearchParams } from "../../apps/web/app/api/store/_lib/logic.ts";

// The mock store (SPEC §4) served from the current red-team case's catalog: the same four endpoints,
// status codes and bodies as apps/web/app/api/store, using the store's own logic. Both agents reach it
// only over HTTP. Every request is logged with the SKUs it returned, so the scorer can tell which
// products an agent actually saw.

export type StoreRequest = {
  kind: "search" | "product" | "page" | "quote" | "other";
  path: string;
  skus: string[];
};

export interface EvalStore {
  url: string;
  setCatalog(catalog: Catalog): void;
  log: StoreRequest[];
  close(): Promise<void>;
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

export async function startEvalStore(initial: Catalog): Promise<EvalStore> {
  let catalog = initial;
  const log: StoreRequest[] = [];

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://store.local");
      const path = url.pathname;
      const product = /^\/products\/([^/]+)(\/page)?$/.exec(path);
      if (req.method === "GET" && path === "/search") {
        const parsed = SearchParams.safeParse({
          q: url.searchParams.get("q") ?? undefined,
          category: url.searchParams.get("category") || undefined,
          limit: url.searchParams.get("limit") ?? undefined,
        });
        if (!parsed.success) return send(res, 400, { code: "INVALID_REQUEST", message: "Invalid search parameters." });
        const listings = search(catalog, parsed.data.q, parsed.data.category, parsed.data.limit);
        log.push({ kind: "search", path: `${path}${url.search}`, skus: listings.map((l) => l.sku) });
        return send(res, 200, { listings });
      }
      if (req.method === "GET" && product) {
        const sku = decodeURIComponent(product[1]!);
        const found = catalog.products.find((p) => p.listing.sku === sku);
        log.push({ kind: product[2] ? "page" : "product", path, skus: found ? [sku] : [] });
        if (!found) return send(res, 404, { code: "NOT_FOUND", message: "Unknown product." });
        return send(res, 200, product[2] ? found.page : found.listing);
      }
      if (req.method === "POST" && path === "/quote") {
        const body = QuoteBody.safeParse(await readBody(req));
        if (!body.success) return send(res, 400, { code: "INVALID_REQUEST", message: "Invalid quote request." });
        log.push({ kind: "quote", path, skus: body.data.lines.map((l) => l.sku) });
        const result = quote(catalog, body.data.lines, Date.now());
        if (!result.ok) return send(res, 400, { code: result.code, message: result.message });
        return send(res, 200, result.quote);
      }
      log.push({ kind: "other", path, skus: [] });
      return send(res, 404, { code: "NOT_FOUND", message: "Not found." });
    })().catch(() => send(res, 500, { code: "INTERNAL", message: "Store error." }));
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    setCatalog(next) { catalog = next; },
    log,
    close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
  };
}
