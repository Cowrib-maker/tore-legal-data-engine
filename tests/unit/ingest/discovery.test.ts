import { describe, expect, it } from "vitest";

import { parseListHtml } from "../../../src/infrastructure/sources/legalinfo/discovery.js";
import { LIST_PAGE_FIXTURE } from "../../fixtures/legalinfo/pages.js";

describe("LegalInfo source discovery", () => {
  it("extracts official detail URLs from a listing fixture", () => {
    const acts = parseListHtml(LIST_PAGE_FIXTURE, "2026-01-01T00:00:00.000Z");
    expect(acts.map((item) => item.lawId)).toEqual(["1", "1622"]);
    expect(acts[1]?.canonicalUrl).toBe("https://legalinfo.mn/mn/detail?lawId=1622");
    expect(acts[1]?.discoveredTitle).toContain("ЭРҮҮГИЙН");
    expect(acts[1]?.actType).toBe("law");
  });
});
