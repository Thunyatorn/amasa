// The shared-password gate for a public deployment (set DEMO_PASSWORD). It is HTTP Basic: the
// browser asks once and keeps sending the password. Used by proxy.ts, kept here so it can be unit tested.
//
// Internal calls skip it: the app calls its own store over HTTP from inside the machine. Those calls
// never pass through Fly's proxy, which adds Fly-Forwarded-Port to every request it forwards (documented
// as "always set") and Fly-Client-IP. A request is treated as internal only when it has NEITHER header,
// so a caller outside cannot look internal. Not X-Forwarded-For: Next.js itself sets that on every
// request, internal ones included (found when testing the container). The Host header is never trusted.

export const GATE_REALM = 'Basic realm="Amasa demo", charset="UTF-8"';
const FROM_FLY_PROXY = ["fly-forwarded-port", "fly-client-ip"] as const;

export type GateDecision = "allow" | "challenge" | "unconfigured";

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Constant-time comparison of two passwords (compared as fixed-length hashes).
async function samePassword(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function passwordFrom(authorization: string | null): string | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authorization ?? "");
  if (!match) return null;
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]!), (c) => c.charCodeAt(0)));
    const colon = decoded.indexOf(":");
    return colon < 0 ? null : decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

// `onFly` is true when FLY_APP_NAME is set (Fly sets it on every machine): there, a missing password
// closes the site instead of opening it.
export async function gateDecision(headers: Headers, password: string | undefined, onFly = false): Promise<GateDecision> {
  if (!password) return onFly ? "unconfigured" : "allow";
  if (!FROM_FLY_PROXY.some((name) => headers.has(name))) return "allow";
  const given = passwordFrom(headers.get("authorization"));
  return given !== null && (await samePassword(given, password)) ? "allow" : "challenge";
}
