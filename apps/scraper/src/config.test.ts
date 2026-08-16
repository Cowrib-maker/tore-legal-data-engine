import { describe, expect, it } from "vitest";

import { loadDiscoveryConfig, loadDownloadConfig } from "./config.js";

describe("discovery config", () => {
  it("parses CLI flags and defaults isactive to active and inactive lists", () => {
    const config = loadDiscoveryConfig([
      "discover",
      "--resume",
      "--category",
      "27",
      "--max-pages",
      "2",
    ]);
    expect(config.resume).toBe(true);
    expect(config.categoryId).toBe("27");
    expect(config.maxPages).toBe(2);
    expect(config.isActiveFilters).toEqual(["1", "0"]);
  });
});

describe("download config", () => {
  it("parses a single-document download selector", () => {
    const config = loadDownloadConfig(["download", "--law-id", "1", "--document-id", "abc"]);
    expect(config.lawId).toBe("1");
    expect(config.documentId).toBe("abc");
  });
});
