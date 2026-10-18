import { catalog } from "../../_lib/catalog";

// GET /api/store/products/[sku] -> StoreListing (SPEC §4.3)
export async function GET(_request: Request, ctx: { params: Promise<{ sku: string }> }): Promise<Response> {
  const { sku } = await ctx.params;
  const product = catalog().products.find((p) => p.listing.sku === sku);
  if (!product) return Response.json({ code: "NOT_FOUND", message: "Unknown product." }, { status: 404 });
  return Response.json(product.listing);
}
