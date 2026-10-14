import { describe, expect, it } from "vitest";
import { refuseProduction } from "./not-production.ts";

describe("the checks never run against the live app", () => {
  it("refuses the deployed URL and any fly.dev host, in any case", () => {
    for (const url of [
      "https://comp4020-final-aaronjin0323.fly.dev",
      "https://comp4020-final-aaronjin0323.fly.dev/readme/",
      "http://FLY.DEV/",
      "https://x.y.fly.dev:443",
    ]) {
      expect(() => refuseProduction(url), url).toThrow(/^refusing to run against/);
    }
  });

  it("allows local servers and hosts that only look like fly.dev", () => {
    for (const url of ["http://localhost:8080", "http://127.0.0.1:8150", "https://fly.dev.example", "https://notfly.dev"]) {
      expect(() => refuseProduction(url), url).not.toThrow();
    }
  });

  it("refuses something that isn't a URL rather than guessing", () => {
    expect(() => refuseProduction("comp4020-final-aaronjin0323.fly.dev")).toThrow(/isn't a URL/);
  });
});
