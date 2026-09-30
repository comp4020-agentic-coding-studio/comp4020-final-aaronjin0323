import { readFileSync } from "node:fs";
import { marked } from "marked";
import { page } from "./html.ts";

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
