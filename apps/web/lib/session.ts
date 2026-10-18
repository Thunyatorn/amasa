import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canon } from "@amasa/schemas";
import { env } from "./env";
import { ApiError } from "./http";

// Single demo user (SPEC §1): a signed, HttpOnly session cookie, plus a double-submit CSRF
// cookie that POST routes must echo in the x-csrf-token header (SPEC §5).

export const SESSION_COOKIE = "amasa_session";
export const CSRF_COOKIE = "amasa_csrf";
export const CSRF_HEADER = "x-csrf-token";

const mac = (sid: string, secret: string) =>
  createHmac("sha256", secret).update(canon({ sid })).digest("base64url");

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // A malformed cookie is ignored (treated as missing), not a server error.
    }
  }
  return out;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function newSessionValue(secret = env().SESSION_SECRET): string {
  const sid = randomBytes(16).toString("base64url");
  return `${sid}.${mac(sid, secret)}`;
}

export function isValidSession(value: string | undefined, secret = env().SESSION_SECRET): boolean {
  if (!value) return false;
  const [sid, sig, ...rest] = value.split(".");
  if (!sid || !sig || rest.length) return false;
  return safeEqual(sig, mac(sid, secret));
}

export const newCsrfToken = () => randomBytes(32).toString("base64url");

const secureFlag = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

export const sessionCookie = (value: string) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict${secureFlag()}`;
// Readable by the page so it can echo it in the header; SameSite=Strict keeps it first-party.
export const csrfCookie = (token: string) =>
  `${CSRF_COOKIE}=${token}; Path=/; SameSite=Strict${secureFlag()}`;

export function requireSession(request: Request): void {
  const cookies = parseCookies(request.headers.get("cookie"));
  if (!isValidSession(cookies[SESSION_COOKIE])) {
    throw new ApiError(401, "NO_SESSION", "Your session has ended. Reload the page to continue.");
  }
}

export function requireSessionAndCsrf(request: Request): void {
  requireSession(request);
  const cookies = parseCookies(request.headers.get("cookie"));
  const cookie = cookies[CSRF_COOKIE];
  const header = request.headers.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw new ApiError(403, "CSRF_FAILED", "This request could not be confirmed. Reload the page and try again.");
  }
}
