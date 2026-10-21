import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { baseUrl, get, visitor } from "./helpers.ts";

// GET / reads without JS: the six plinths are in the HTML the server sends,
// escaped. And the static files come from public/ only, by extension.

describe("the page", () => {
  it("lists the six plinths in the HTML, with title, recipe, version and makers", async () => {
    const r = await get(visitor(), "/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(r.body).not.toContain("<!--museum-->");
    const doc = new JSDOM(r.body).window.document;
    const slots = [...doc.querySelectorAll("[data-museum] [data-slot]")];
    expect(slots.map((s) => s.getAttribute("data-slot"))).toEqual(["1", "2", "3", "4", "5", "6"]);
    // slot 1 is the Loop & Lantern unless a test replaced it, so check shape
    for (const s of slots.filter((x) => x.hasAttribute("data-exhibit"))) {
      expect(s.querySelector(".slot-title")?.textContent).toBeTruthy();
      expect(s.querySelector(".slot-recipe")?.textContent).toMatch(/^(Loop & Lantern|Arch Totem|Glass Bloom)$/);
      expect(s.querySelector(".slot-version")?.textContent).toMatch(/^version \d+$/);
      expect(s.querySelector(".slot-by")?.textContent).toMatch(/^by .+/);
    }
  });
});

describe("static files", () => {
  it("serves recipes.js as a no-cache ES module", async () => {
    const res = await fetch(new URL("/recipes.js", baseUrl()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("export function checkEdit");
  });

  it("never serves outside public/, a dotfile, or an extension off the list", async () => {
    // marked's bundle is a real .js file outside public/, in the image too
    const outside = ["/..%2fnode_modules%2fmarked%2flib%2fmarked.esm.js", "/%2e%2e%2fnode_modules/marked/lib/marked.esm.js", "/..%5cnode_modules%5cmarked%5clib%5cmarked.esm.js"];
    for (const path of [...outside, "/../package.json", "/%2e%2e/package.json", "/.env", "/%00.js", "/recipes.js.map", "/../src/db.ts"]) {
      const url = baseUrl().replace(/\/$/, "") + path;
      const res = await fetch(url);
      expect(res.status, path).toBe(404);
    }
  });
});
