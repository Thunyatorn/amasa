import { withCatalog } from "../_lib/catalog";
import { quote, QuoteBody } from "../_lib/logic";

// POST /api/store/quote (SPEC §4.4): the only source of money the verifier uses.
export async function POST(request: Request): Promise<Response> {
  const body = QuoteBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "INVALID_REQUEST", message: "Invalid quote request." }, { status: 400 });
  return withCatalog((c) => {
    const result = quote(c, body.data.lines, Date.now());
    if (!result.ok) return Response.json({ code: result.code, message: result.message }, { status: 400 });
    return Response.json(result.quote);
  });
}
