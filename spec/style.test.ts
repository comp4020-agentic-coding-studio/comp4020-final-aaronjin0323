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

// Attribute *names* drift the same way values do: a stylesheet selecting
// [data-pending] while the script sets data-busy styles nothing.
describe("the stylesheet's hooks", () => {
  it("selects only data attributes the code or the page sets", () => {
    const names = [...css.matchAll(/\[(data-[\w-]+)[\]=]/g), ...css.matchAll(/attr\((data-[\w-]+)/g)].map((m) => m[1]);
    expect(names.length, "style.css selects no data attributes; nothing to check").toBeGreaterThan(0);
    const camel = (n: string): string => n.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    const set = (n: string): boolean => code.includes(n) || new RegExp(`dataset\\.${camel(n)}\\b`).test(code);
    const unset = [...new Set(names)].filter((n) => !set(n));
    expect(unset, "data attributes style.css selects that nothing sets").toEqual([]);
  });

  // Every value the script writes for these is styled: a preview kind or a
  // connection state with no rule is invisible, and the player can't tell.
  it("styles every preview kind and connection state the script writes", () => {
    const previews = [...app.matchAll(/dataset\.preview = "([\w-]+)"/g)].map((m) => m[1]);
    // the keys of `const CONN_TEXT = { live: "…", … }`
    const connText = app.match(/CONN_TEXT = \{([^}]*)\}/)?.[1] ?? "";
    const conn = [...connText.matchAll(/(?:^|,)\s*(\w+):\s*"/g)].map((m) => m[1]);
    expect(previews.length, "app.js writes no preview kinds; nothing to check").toBeGreaterThan(0);
    expect(conn.length, "app.js names no connection states; nothing to check").toBeGreaterThan(0);
    const missing = [
      ...previews.filter((v) => !css.includes(`[data-preview="${v}"]`)).map((v) => `data-preview="${v}"`),
      // "connecting" is the server-rendered default, styled by the bare .conn rule
      ...conn.filter((v) => !css.includes(`[data-conn="${v}"]`)).map((v) => `data-conn="${v}"`),
    ];
    expect(missing, "values app.js writes that style.css never styles").toEqual([]);
  });
});

// Each rule that runs an animation or a transition has to be switched off
// under prefers-reduced-motion. Checked by selector, so a new animated rule
// added without its reduced-motion line fails here.
describe("reduced motion", () => {
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  const outside = css.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g, "");
  // top-level rules (and rules one level inside other @media/@supports)
  const rules = [...outside.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].trim().split(/,\s*/).map((s) => s.trim()),
    body: m[2],
  }));
  const selectorsIn = (block: string): Set<string> =>
    new Set([...block.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].trim().split(/,\s*/).map((s) => s.trim())));

  it("has a reduced-motion block", () => {
    expect(reduced.length, "no @media (prefers-reduced-motion: reduce) block").toBeGreaterThan(0);
  });

  it("stops every animation", () => {
    const animated = rules
      .filter((r) => /(^|;|\s)animation:\s*(?!none\b)\S/.test(r.body))
      .flatMap((r) => r.selectors)
      .filter((s) => !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
    expect(animated.length, "no animated rules found; nothing to check").toBeGreaterThan(0);
    const calmed = selectorsIn(reduced);
    expect(animated.filter((s) => !calmed.has(s)), "animated selectors with no reduced-motion rule").toEqual([]);
  });

  it("stops every transition", () => {
    const moving = rules
      .filter((r) => /(^|;|\s)transition:\s*(?!none\b)\S/.test(r.body))
      .flatMap((r) => r.selectors);
    expect(moving.length, "no transitions found; nothing to check").toBeGreaterThan(0);
    const calmed = selectorsIn(reduced);
    expect(moving.filter((s) => !calmed.has(s)), "transitioned selectors with no reduced-motion rule").toEqual([]);
  });
});

// The colours text is set in, checked against WCAG AA (4.5:1) from the
// tokens in :root. Text over the header's gradient can't be checked this
// way (axe can't either); that's measured from pixels in the browser.
describe("contrast", () => {
  const token = (name: string): string => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,6})`, "i"));
    if (!m) throw new Error(`no hex value for --${name} in :root`);
    return m[1];
  };
  const lum = (hex: string): number => {
    const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const f = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // [text, background, where it's used]
  const pairs: [string, string, string][] = [
    ["ink", "night", "body text"],
    ["muted", "night", "claimed count, connection, key, camera hint"],
    ["muted", "panel", "status line, inspector labels, confirm text"],
    ["ink", "panel", "inspector values"],
    ["accent", "panel", "notices"],
    ["night", "cream", "name field, camera buttons"],
    ["night", "accent", "the confirm bar's claim button"],
    ["money", "night", "the claimed count's digits"],
  ];
  it.each(pairs)("--%s on --%s meets AA (%s)", (fg, bg) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

// The containers the script fills are rendered by the server, so the page
// has them (and their ids and roles) before any script runs.
describe("the page's live regions", () => {
  it("renders the inspector, connection line and announcer", async () => {
    const { JSDOM } = await import("jsdom");
    const doc = new JSDOM(await (await fetch(new URL("/", baseUrl))).text()).window.document;
    const inspect = doc.querySelector("aside#inspect[data-inspect]");
    expect(inspect, "no <aside id=inspect data-inspect>").not.toBeNull();
    expect(inspect!.hasAttribute("hidden"), "the inspector starts hidden").toBe(true);
    expect(inspect!.querySelector("h2[data-inspect-title]")).not.toBeNull();
    expect(inspect!.querySelector("dl[data-inspect-facts]")).not.toBeNull();
    expect(doc.querySelector('p.conn[data-conn="connecting"]')).not.toBeNull();
    const announce = doc.querySelector("[data-announce]");
    expect(announce?.getAttribute("aria-live")).toBe("polite");
    expect(announce?.classList.contains("sr-only")).toBe(true);
    expect(/\.sr-only\s*\{[^}]*clip-path/.test(css), "style.css has no .sr-only rule").toBe(true);
  });
});
