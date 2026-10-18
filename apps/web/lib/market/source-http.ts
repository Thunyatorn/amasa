import { canon } from "@amasa/schemas";
import type { Db } from "../db/index.ts";
import { reserveHost } from "./repository.ts";
import { SourcePayload } from "./schemas.ts";

export class MarketError extends Error {
  constructor(public readonly code: string, public readonly retryAfterMs = 60_000) { super(code); }
}
const API_HOSTS = new Set(["www.wikidata.org", "en.wikipedia.org", "api.themoviedb.org"]);
export const REFERENCE_HOSTS = new Set(["www.forbes.com", "www.reuters.com", "apnews.com", "www.sec.gov"]);
export function publicUrl(raw: string, references = false): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new MarketError("SOURCE_URL_REJECTED"); }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash
    || !(API_HOSTS.has(u.hostname) || references && REFERENCE_HOSTS.has(u.hostname))) throw new MarketError("SOURCE_URL_REJECTED");
  return u;
}
type Options = { userAgent: string; tmdbToken?: string; fetch?: typeof fetch; now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>; maxBytes?: number; timeoutMs?: number; minIntervalMs?: number };
export class SourceHttp {
  private readonly now: () => number;
  constructor(private readonly db: Db, private readonly options: Options) { this.now = options.now ?? Date.now; }
  async get(endpoint: string, sourceUrl: string, signal: AbortSignal, ttlMs = 3_600_000, references = false): Promise<SourcePayload> {
    publicUrl(sourceUrl, references);
    const original = publicUrl(endpoint, references);
    const cachedRow = this.db.prepare("SELECT json,expires_at FROM market_http_cache WHERE endpoint=?").get(endpoint) as { json: string; expires_at: number } | undefined;
    const cached = cachedRow ? SourcePayload.parse(JSON.parse(cachedRow.json)) : undefined;
    if (cached && cachedRow!.expires_at > this.now()) return cached;
    const abort = AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs ?? 20_000)]);
    let url = original;
    for (let redirects = 0; redirects <= 3; redirects++) {
      abort.throwIfAborted();
      // All Wikimedia hosts share one persisted reservation budget across every worker.
      const host = /(^|\.)(wikidata|wikipedia)\.org$/.test(url.hostname) ? "wikimedia" : url.hostname;
      while (!reserveHost(this.db, host, this.now(), this.options.minIntervalMs ?? (host === "wikimedia" ? 1100 : 1000))) {
        await (this.options.sleep ?? sleep)(100, abort); abort.throwIfAborted();
      }
      const headers: Record<string, string> = { "User-Agent": this.options.userAgent, Accept: references ? "text/html,text/plain" : "application/json" };
      if (cached && url.href === original.href) {
        if (cached.etag) headers["If-None-Match"] = cached.etag;
        if (cached.lastModified) headers["If-Modified-Since"] = cached.lastModified;
      }
      if (url.hostname === "api.themoviedb.org") {
        if (!this.options.tmdbToken) throw new MarketError("TMDB_NOT_CONFIGURED", 86_400_000);
        headers.Authorization = `Bearer ${this.options.tmdbToken}`;
      }
      let response: Response;
      try { response = await (this.options.fetch ?? fetch)(url, { headers, redirect: "manual", signal: abort }); }
      catch { throw new MarketError(abort.aborted ? "SOURCE_TIMEOUT" : "SOURCE_NETWORK"); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw new MarketError("SOURCE_REDIRECT_LIMIT");
        const next = publicUrl(new URL(location, url).href, references);
        // Credentials and API validators never cross a host boundary, even to another allowed host.
        if (next.hostname !== original.hostname) throw new MarketError("SOURCE_REDIRECT_REJECTED");
        url = next; continue;
      }
      if (response.status === 304 && cached) {
        await response.body?.cancel();
        const result = { ...cached, checkedAt: this.now() }; this.cache(endpoint, result, ttlMs); return result;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const delay = retryDelay(response.headers.get("retry-after"), this.now());
        if (response.status === 429 || response.status === 503) this.block(host, delay);
        throw new MarketError(`SOURCE_HTTP_${response.status}`, delay);
      }
      const max = this.options.maxBytes ?? 1_000_000;
      if (Number(response.headers.get("content-length") ?? 0) > max) { await response.body?.cancel(); throw new MarketError("SOURCE_TOO_LARGE"); }
      if (!response.body) throw new MarketError("SOURCE_EMPTY");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength; if (bytes > max) throw new MarketError("SOURCE_TOO_LARGE"); chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const payload = Buffer.concat(chunks).toString("utf8");
      if (!references) {
        let parsed: unknown;
        try { parsed = JSON.parse(payload); } catch { throw new MarketError("SOURCE_INVALID_JSON"); }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MarketError("SOURCE_INVALID_JSON");
        const error = (parsed as { error?: { code?: string } }).error;
        if (error) {
          const delay = retryDelay(response.headers.get("retry-after"), this.now()); this.block(host, delay);
          throw new MarketError(error.code === "maxlag" ? "SOURCE_MAXLAG" : "SOURCE_API_ERROR", delay);
        }
      }
      const result = SourcePayload.parse({ url: sourceUrl, retrievalUrl: endpoint, payload, checkedAt: this.now(),
        etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), publicationDate: null });
      this.cache(endpoint, result, ttlMs); return result;
    }
    throw new MarketError("SOURCE_REDIRECT_LIMIT");
  }
  private cache(endpoint: string, result: SourcePayload, ttl: number) {
    this.db.prepare(`INSERT INTO market_http_cache VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET source_url=excluded.source_url,json=excluded.json,expires_at=excluded.expires_at`)
      .run(endpoint, result.url, canon(result), this.now() + ttl);
  }
  private block(host: string, delay: number) {
    this.db.prepare("UPDATE market_host_limits SET blocked_until=max(blocked_until,?),failures=failures+1 WHERE host=?").run(this.now() + delay, host);
  }
}
function retryDelay(value: string | null, now: number) {
  const ms = value && /^\d+$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - now : 60_000;
  return Number.isFinite(ms) ? Math.max(1000, Math.min(86_400_000, ms)) : 60_000;
}
async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new MarketError("SOURCE_CANCELLED")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
