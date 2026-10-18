import { json, route } from "../../../lib/http";
import { CSRF_COOKIE, csrfCookie, isValidSession, newCsrfToken, newSessionValue, parseCookies, SESSION_COOKIE, sessionCookie } from "../../../lib/session";

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

// GET /api/csrf: starts the demo user's session if needed and issues a CSRF token (SPEC §5).
// Within a valid session the existing token is returned unchanged: rotating it on every call
// would make a request that is already in flight fail its CSRF check.
export const GET = route(async (request: Request) => {
  const headers = new Headers();
  const cookies = parseCookies(request.headers.get("cookie"));
  const hasSession = isValidSession(cookies[SESSION_COOKIE]);
  if (!hasSession) headers.append("Set-Cookie", sessionCookie(newSessionValue()));
  const existing = cookies[CSRF_COOKIE];
  const token = hasSession && existing && TOKEN_FORMAT.test(existing) ? existing : newCsrfToken();
  if (token !== existing) headers.append("Set-Cookie", csrfCookie(token));
  headers.set("Cache-Control", "no-store");
  return json({ token }, 200, headers);
});
