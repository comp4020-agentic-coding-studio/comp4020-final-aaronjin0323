import { readFileSync } from "node:fs";
import { marked } from "marked";
import { page } from "./html.ts";

// A markdown file under docs/ (an ADR the README links to), rendered the
// same way, so a link that works on GitHub works at /readme/ too.
export function renderDoc(path: string, title: string): string {
  const html = marked.parse(readFileSync(path, "utf8"), { async: false });
  return page({
    title,
    body: `
    <main class="prose">
      <p><a href="/readme/">← Back to About</a></p>
      ${html}
    </main>`,
  });
}

// Rendered on each request so /readme/ can never lag behind README.md.
// Relative links (docs/before.png) resolve under /readme/, where the server
// serves docs/.
export function renderReadme(): string {
  const md = readFileSync("README.md", "utf8");
  const html = marked.parse(md, { async: false });
  return page({
    title: "About Skyline",
    body: `
    <main class="prose">
      <p><a href="/">← Back to the board</a></p>
      ${html}
    </main>`,
  });
}
