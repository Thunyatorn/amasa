import { withCatalog } from "../../../_lib/catalog";

// GET /api/store/products/[sku]/page -> ProductPage (SPEC §4.3). Untrusted text: only the reader
// and the scanner ever see it.
export async function GET(_request: Request, ctx: { params: Promise<{ sku: string }> }): Promise<Response> {
  const { sku } = await ctx.params;
  return withCatalog((c) => {
    const product = c.products.find((p) => p.listing.sku === sku);
    if (!product) return Response.json({ code: "NOT_FOUND", message: "Unknown product." }, { status: 404 });
    return Response.json(product.page);
  });
}
