// The spec and the browser checks claim plots as fixture players, so a run
// against the deployed app leaves Alice, Bob, Fay and "<b>x</b>" holding land
// on the real board (it happened once, before crit 10). Both refuse a
// production URL before they send a single request. CI runs the spec against
// the image it built, on localhost; after a deploy it only fetches the page.
export function refuseProduction(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`APP_URL isn't a URL: ${url}`);
  }
  if (host === "fly.dev" || host.endsWith(".fly.dev")) {
    throw new Error(
      `refusing to run against ${url}: the checks claim plots as test players, and on the live board they'd stay there. ` +
        "Start the app locally with a throwaway DB_PATH and point APP_URL at that.",
    );
  }
}
