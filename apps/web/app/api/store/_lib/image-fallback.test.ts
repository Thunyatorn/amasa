import { describe, expect, it, vi } from "vitest";

// A machine without the photos (a public deployment): reading any photo fails.
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => { throw Object.assign(new Error("no such file"), { code: "ENOENT" }); }) }));

import { GET } from "../products/[sku]/image/route";

describe("image route without the photo files", () => {
  const get = (sku: string) => GET(new Request("http://localhost/image"), { params: Promise.resolve({ sku }) });
  it("serves the initials placeholder (200, SVG) for a demo celebrity", async () => {
    const response = await get("CELEB-942");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    const svg = await response.text();
    expect(svg).toContain(">TH<");
    expect(svg).toContain('aria-label="Tom Hanks"');
  });
  it("still answers 404 for an unknown product", async () => {
    expect((await get("CELEB-1")).status).toBe(404);
  });
});
