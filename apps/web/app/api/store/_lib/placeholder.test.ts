import { describe, expect, it } from "vitest";
import { GET } from "../products/[sku]/image/route";
import { initialsOf, placeholderSvg } from "./placeholder";

describe("photo placeholder", () => {
  it("shows initials: first and last word, ignoring dots and hyphens", () => {
    expect(initialsOf("Tom Hanks")).toBe("TH");
    expect(initialsOf("Neymar Jr.")).toBe("NJ");
    expect(initialsOf("Jay-Z")).toBe("JZ");
    expect(initialsOf("Adele")).toBe("A");
    expect(initialsOf("The Weeknd")).toBe("TW");
    expect(initialsOf("Timothée Chalamet")).toBe("TC");
    expect(initialsOf("")).toBe("?");
  });
  it("is a plain SVG with the name escaped and no scripts or links", () => {
    const svg = placeholderSvg(`<script>alert("x")</script> & Co`);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toMatch(/href|onload|<image/i);
  });
});

describe("GET /api/store/products/[sku]/image", () => {
  const get = (sku: string) => GET(new Request("http://localhost/image"), { params: Promise.resolve({ sku }) });
  it("answers 404 for a product that isn't in the demo set", async () => {
    expect((await get("CELEB-1")).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
  });
  it("serves the photo when it is on this machine, and an initials placeholder when it is not", async () => {
    const response = await get("CELEB-942");
    expect(response.status).toBe(200);
    const type = response.headers.get("content-type");
    expect(["image/jpeg", "image/svg+xml"]).toContain(type);
    if (type === "image/svg+xml") expect(await response.text()).toContain(">TH<");
  });
});
