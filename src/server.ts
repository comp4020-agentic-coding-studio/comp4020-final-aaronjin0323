// The bare app while the museum is rebuilt (ADR 20): the page and the
// README, nothing else.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { marked } from "marked";

const PORT = Number(process.env.PORT ?? 8080);

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body>${body}</body></html>`;

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("Impossible Museum", `<h1>Impossible Museum</h1><p>Being rebuilt. <a href="/readme/">About</a></p>`));
  } else if (path === "/readme/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("About the Impossible Museum", marked.parse(readFileSync("README.md", "utf8"), { async: false })));
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});
server.listen(PORT, "0.0.0.0");
process.on("SIGTERM", () => {
  server.close();
  server.closeAllConnections();
});
