import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { demoSet } from "../../../_lib/catalog";
import { repoRootFrom } from "../../../_lib/support";

// GET /api/store/products/[sku]/image: the celebrity's photo from the local dataset. Only demo-set
// celebrities have one; the file name comes from the demo set, never from the request.
export async function GET(_request: Request, ctx: { params: Promise<{ sku: string }> }): Promise<Response> {
  const { sku } = await ctx.params;
  const celebrity = demoSet().celebrities.find((c) => c.sku === sku);
  if (!celebrity) return Response.json({ code: "NOT_FOUND", message: "Unknown product." }, { status: 404 });
  try {
    const bytes = await readFile(join(repoRootFrom(), "data", "celebrities", celebrity.imagefile));
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" } });
  } catch {
    return Response.json({ code: "NOT_FOUND", message: "No photo for this product." }, { status: 404 });
  }
}
