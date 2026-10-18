import { withCatalog } from "../_lib/catalog";
import { search, SearchParams } from "../_lib/logic";

// GET /api/store/search?q=&category=&limit= (SPEC §4.2)
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = SearchParams.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    category: url.searchParams.get("category") || undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return Response.json({ code: "INVALID_REQUEST", message: "Invalid search parameters." }, { status: 400 });
  const { q, category, limit } = parsed.data;
  return withCatalog((c) => Response.json({ listings: search(c, q, category, limit) }));
}
