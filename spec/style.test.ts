import { readFileSync } from "node:fs";
import { describe, expect, inject, it } from "vitest";

// The stylesheet and the code agree on names only by convention: a class the
// script adds, an attribute value the code writes, a file the CSS points at.
// No behaviour test can catch them drifting apart, since a selector finds an
// unstyled element just as well: the +1/−1 float shipped with no style at all.
const baseUrl = inject("baseUrl");
// comments dropped: a class named only in a comment isn't styled
const css = readFileSync("public/style.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const app = readFileSync("public/app.js", "utf8");
const code = ["src/board.ts", "src/server.ts", "public/app.js", "public/diff.js"]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

describe("the stylesheet and the code", () => {
  it("names every class the page's script adds", () => {
    const added = [
      ...app.matchAll(/\.className = "([\w-]+)"/g),
      ...app.matchAll(/classList\.(?:add|toggle)\("([\w-]+)"/g),
    ].map((m) => m[1]);
    expect(added.length, "app.js adds no classes; nothing to check").toBeGreaterThan(0);
    const unstyled = [...new Set(added)].filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(css));
    expect(unstyled, "classes app.js adds that style.css never names").toEqual([]);
  });

  it("selects only attribute values the code writes", () => {
    const selected = [...css.matchAll(/\[data-[\w-]+="([^"]+)"\]/g)].map((m) => m[1]);
    expect(selected.length, "style.css selects no attribute values; nothing to check").toBeGreaterThan(0);
    const quoted = (v: string): boolean => ['"', "'", "`"].some((q) => code.includes(`${q}${v}${q}`));
    const unwritten = [...new Set(selected)].filter((v) => !quoted(v));
    expect(unwritten, "values style.css selects that no code writes").toEqual([]);
  });

  // A missing font or image fails silently: the page still renders, just in
  // a fallback, so only a check that fetches each one notices.
  it("can load every file the stylesheet points at", async () => {
    const files = [...css.matchAll(/url\("(\/[^"]*)"\)/g)].map((m) => m[1]);
    expect(files.length, "style.css points at no files; nothing to check").toBeGreaterThan(0);
    for (const file of new Set(files)) {
      const res = await fetch(new URL(file, baseUrl));
      expect(res.status, `style.css points at ${file}, which doesn't load`).toBe(200);
    }
  });
});
