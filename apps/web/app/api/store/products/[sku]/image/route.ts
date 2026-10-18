import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { demoSet } from "../../../_lib/catalog";
import { placeholderSvg } from "../../../_lib/placeholder";
import { repoRootFrom } from "../../../_lib/support";

// GET /api/store/products/[sku]/image: the celebrity's photo from the local dataset. Only demo-set
// celebrities have one; the file name comes from the demo set, never from the request. When the photo
// isn't on this machine (a public deployment doesn't ship them), a neutral initials placeholder is
// served instead, so cards never show a broken image.
export async function GET(_request: Request, ctx: { params: Promise<{ sku: string }> }): Promise<Response> {
  const { sku } = await ctx.params;
  const celebrity = demoSet().celebrities.find((c) => c.sku === sku);
  if (!celebrity) return Response.json({ code: "NOT_FOUND", message: "Unknown product." }, { status: 404 });
  try {
    const bytes = await readFile(join(repoRootFrom(), "data", "celebrities", celebrity.imagefile));
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" } });
  } catch {
    return new Response(placeholderSvg(celebrity.name), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
  }
}
