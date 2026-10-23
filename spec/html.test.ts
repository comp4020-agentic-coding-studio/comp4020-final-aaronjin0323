import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { openStore } from "../src/db.ts";
import { escapeHtml, renderMuseum } from "../src/html.ts";

// The no-JS listing escapes everything a visitor typed. The HTTP page test
// can't rely on a hostile title being on a plinth (the museum it reads is
// shared), so this renders one directly.

describe("the server-rendered listing", () => {
  it("escapes titles and names", () => {
    const store = openStore(":memory:");
    const t0 = new Date("2026-11-01T00:00:00Z");
    const pid = "00000000-0000-4000-8000-000000000001";
    store.ensureVisitor(pid, `<img src=x onerror="alert(1)">`, 0, t0);
    store.gesture(pid, { kind: "tap", object: "bell", at: 1 }, t0);
    store.publish(pid, { title: `<script>alert("t")</script> & 'q'`, slot: 4, replace: true }, t0);
    const html = renderMuseum(store.snapshot(t0));
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelectorAll("script, img")).toHaveLength(0);
    const slot = doc.querySelector('[data-slot="4"]')!;
    expect(slot.querySelector(".slot-title")!.textContent).toBe(`<script>alert("t")</script> & 'q'`);
    expect(slot.querySelector(".slot-by")!.textContent).toBe(`by <img src=x onerror="alert(1)">`);
    expect(doc.querySelector('[data-slot="5"] .slot-title')!.textContent).toBe("Wrong Door, Right Bounce");
    expect(doc.querySelector('[data-slot="1"] .slot-by')!.textContent).toBe("by the museum");
    expect(slot.querySelector(".slot-recipe")!.textContent).toBe("a performance of 1 gesture");
    expect(doc.querySelector(".bench-now")!.textContent).toBe("On the stage: 1 gesture, playing");
  });

  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});
