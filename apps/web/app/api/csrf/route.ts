import { json, route } from "../../../lib/http";
import { csrfCookie, isValidSession, newCsrfToken, newSessionValue, parseCookies, SESSION_COOKIE, sessionCookie } from "../../../lib/session";

// GET /api/csrf: starts the demo user's session if needed and issues a CSRF token (SPEC §5).
export const GET = route(async (request: Request) => {
  const headers = new Headers();
  if (!isValidSession(parseCookies(request.headers.get("cookie"))[SESSION_COOKIE])) {
    headers.append("Set-Cookie", sessionCookie(newSessionValue()));
  }
  const token = newCsrfToken();
  headers.append("Set-Cookie", csrfCookie(token));
  headers.set("Cache-Control", "no-store");
  return json({ token }, 200, headers);
});
