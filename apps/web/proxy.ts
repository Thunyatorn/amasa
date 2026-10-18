import { NextResponse, type NextRequest } from "next/server";
import { GATE_REALM, gateDecision } from "./lib/gate.ts";

// The host's health check cannot send a password; this path returns a fixed body and touches no data.
const HEALTH_PATH = "/api/health";

// The shared-password gate for a public deployment (lib/gate.ts). Without DEMO_PASSWORD it lets
// everything through locally; on Fly (FLY_APP_NAME is set) it refuses to serve without a password.
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === HEALTH_PATH) return NextResponse.next();
  const decision = await gateDecision(request.headers, process.env.DEMO_PASSWORD, Boolean(process.env.FLY_APP_NAME));
  if (decision === "allow") return NextResponse.next();
  if (decision === "unconfigured") {
    return new NextResponse("This deployment has no DEMO_PASSWORD set, so it is closed.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return new NextResponse("A password is required.", { status: 401, headers: { "WWW-Authenticate": GATE_REALM, "Cache-Control": "no-store" } });
}
