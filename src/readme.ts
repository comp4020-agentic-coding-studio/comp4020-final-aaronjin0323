import { readFileSync } from "node:fs";
import { marked } from "marked";
import { page } from "./html.ts";

// A markdown file under docs/ (an ADR the README links to), rendered the
// same way, so a link that works on GitHub works at /readme/ too.
export function renderDoc(path: string): string {
  const html = marked.parse(readFileSync(path, "utf8"), { async: false });
  return page({
    title: "Impossible Museum: decision record",
    body: `
    <main class="prose">
      <p><a href="/readme/">← Back to About</a></p>
      ${html}
    </main>`,
  });
}

// Rendered on each request so /readme/ can never lag behind README.md.
// Relative links (docs/adr/...) resolve under /readme/, where the server
// serves docs/.
export function renderReadme(): string {
  const html = marked.parse(readFileSync("README.md", "utf8"), { async: false });
  return page({
    title: "About the Impossible Museum",
    body: `
    <main class="prose">
      <p><a href="/">← Back to the museum</a></p>
      ${html}
    </main>`,
  });
}
