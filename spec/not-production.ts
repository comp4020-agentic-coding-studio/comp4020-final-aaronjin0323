// The spec and the browser check act as fixture visitors: they start and
// edit drafts, publish exhibits, fill and empty slots, and rename themselves.
// Run against the deployed app, they'd leave test exhibits on the plinths
// and in the storeroom of the museum the marker sees, and since nothing
// published is ever deleted, they'd stay there for good. (It happened once
// with Skyline, before crit 10.) Both refuse a production URL before they
// send a single request. CI runs the spec against the image it built, on
// localhost; after a deploy it only fetches the page.
export function refuseProduction(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`APP_URL isn't a URL: ${url}`);
  }
  if (host === "fly.dev" || host.endsWith(".fly.dev")) {
    throw new Error(
      `refusing to run against ${url}: the checks act as test visitors, and the exhibits they publish on the live museum would stay there. ` +
        "Start the app locally with a throwaway DB_PATH and point APP_URL at that.",
    );
  }
}
