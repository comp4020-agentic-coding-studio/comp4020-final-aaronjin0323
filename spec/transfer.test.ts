import { request } from "node:http";
import { gunzipSync } from "node:zlib";
import { describe, expect, inject, it } from "vitest";

// A slow connection is a case the marking names (the top band asks the app to
// hold up under one). On Slow 3G the first load was 285 KB, uncompressed,
// about 6 s; gzipped it's about 51 KB. So every text response the page needs
// goes out compressed to a client that asks, and plain to one that doesn't.
const baseUrl = inject("baseUrl");

const TEXT = ["/", "/style.css", "/app.js", "/diff.js", "/readme/"];

describe("text responses on a slow connection", () => {
  for (const path of TEXT) {
    it(`gzips ${path} for a client that accepts it, and the body is the same page`, async () => {
      const plain = await fetch(new URL(path, baseUrl), { headers: { "accept-encoding": "identity" } });
      expect(plain.status).toBe(200);
      expect(plain.headers.get("content-encoding")).toBeNull();
      const body = Buffer.from(await plain.arrayBuffer());

      // fetch would decode gzip itself and hide the header, so ask by hand.
      const url = new URL(path, baseUrl);
      const zipped = await new Promise<{ encoding: string | undefined; vary: string | undefined; bytes: Buffer }>((done, fail) => {
        request(url, { headers: { "accept-encoding": "gzip" } }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            done({ encoding: res.headers["content-encoding"], vary: res.headers.vary, bytes: Buffer.concat(chunks) }),
          );
        })
          .on("error", fail)
          .end();
      });
      expect(zipped.encoding).toBe("gzip");
      expect(zipped.vary ?? "").toMatch(/accept-encoding/i);
      expect(zipped.bytes.length).toBeLessThan(body.length / 2);
      // The page itself carries per-visitor state, so compare shape, not bytes,
      // for "/"; static files must match exactly.
      const unzipped = gunzipSync(zipped.bytes);
      if (path === "/" || path === "/readme/") expect(unzipped.toString()).toMatch(/^<!doctype html>/i);
      else expect(unzipped.equals(body)).toBe(true);
    });
  }
});
