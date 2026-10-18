// GET /api/health: a liveness check for the host (Fly). It answers a fixed body and touches no data, so
// it is the one path the deployment's password gate lets through.
export function GET(): Response {
  return Response.json({ ok: true });
}
