const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

// `head` is extra markup for <head>, such as a <noscript> style for things
// only the script can bring to life.
export function page({
  title,
  body,
  script,
  head = "",
}: {
  title: string;
  body: string;
  script?: string;
  head?: string;
}): string {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/style.css">
    ${script ? `<script type="module" src="${script}"></script>` : ""}${head}
  </head>
  <body>${body}
  </body>
</html>
`;
}
