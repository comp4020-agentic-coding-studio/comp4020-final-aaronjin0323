import { RECIPES } from "../public/recipes.js";
import type { Snapshot } from "./db.ts";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** The placeholder in public/index.html that the server fills. */
export const MARK = "<!--museum-->";

// The six plinths as plain HTML, so the page reads without JS (and without
// WebGL): each slot's title, recipe, version and who made it. Everything
// typed by a visitor is escaped here; the page's script replaces this list
// once the stream's first state arrives.
export function renderMuseum(s: Pick<Snapshot, "slots" | "draft">): string {
  const items = s.slots.map(({ slot, exhibit }) => {
    if (!exhibit) return `<li class="slot slot-empty" data-slot="${slot}"><span class="slot-n">Plinth ${slot}</span> <span class="slot-title">Empty</span></li>`;
    const v = exhibit.latest;
    const recipe = Object.hasOwn(RECIPES, v.recipe) ? RECIPES[v.recipe].name : v.recipe;
    const by = v.contributors.length
      ? v.contributors.map((c) => escapeHtml(c.name)).join(", ")
      : v.publishedBy
        ? escapeHtml(v.publishedBy.name)
        : "the museum";
    return (
      `<li class="slot" data-slot="${slot}" data-exhibit="${exhibit.id}">` +
      `<span class="slot-n">Plinth ${slot}</span> ` +
      `<span class="slot-title">${escapeHtml(v.title)}</span> ` +
      `<span class="slot-recipe">${escapeHtml(recipe)}</span> ` +
      `<span class="slot-version">version ${v.n}</span> ` +
      `<span class="slot-by">by ${by}</span>` +
      `</li>`
    );
  });
  const draft = s.draft.recipe
    ? `<p class="bench-now">On the workbench: ${escapeHtml(Object.hasOwn(RECIPES, s.draft.recipe) ? RECIPES[s.draft.recipe].name : s.draft.recipe)}</p>`
    : `<p class="bench-now">The workbench is empty.</p>`;
  return `<ol class="museum-listing" data-museum>${items.join("")}</ol>${draft}`;
}

// A whole page, for the README, the ADRs and the shell served before
// public/index.html exists. `head` is extra markup for <head>.
export function page({ title, body, head = "" }: { title: string; body: string; head?: string }): string {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/style.css">${head}
  </head>
  <body>${body}
  </body>
</html>
`;
}

/** Until the page's own index.html exists: the listing and nothing else. */
export const SHELL = page({
  title: "Impossible Museum",
  body: `
    <main>
      <h1>Impossible Museum</h1>
      ${MARK}
      <p><a href="/readme/">About</a></p>
    </main>`,
});
