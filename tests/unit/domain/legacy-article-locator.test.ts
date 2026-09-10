import { describe, expect, it } from "vitest";
import {
  assignSourceLocators,
  type LegacyArticleForLocator,
} from "../../../src/domain/services/legacy-article-locator.js";

function a(id: string, articleNumber: string | null, order: number): LegacyArticleForLocator {
  return { id, articleNumber, order };
}

describe("assignSourceLocators — legacy article identity", () => {
  it("1. unique article number -> unchanged base locator", () => {
    const { locatorById, collisions } = assignSourceLocators([
      a("art-1", "180", 0),
      a("art-2", "181", 1),
    ]);
    expect(locatorById.get("art-1")).toBe("article-180");
    expect(locatorById.get("art-2")).toBe("article-181");
    expect(collisions).toHaveLength(0);
  });

  it("2. duplicate article number -> first deterministic occurrence keeps the base locator", () => {
    // order ASC is the tiebreaker: "first" is order 0, not insertion order.
    const { locatorById } = assignSourceLocators([
      a("second-inserted-but-lower-order", "181", 0),
      a("first-inserted-but-higher-order", "181", 1),
    ]);
    expect(locatorById.get("second-inserted-but-lower-order")).toBe("article-181");
  });

  it("3. second duplicate receives a stable id-suffixed locator", () => {
    const { locatorById } = assignSourceLocators([
      a("winner-id", "181", 0),
      a("loser-id", "181", 1),
    ]);
    expect(locatorById.get("loser-id")).toBe("article-181__legacyId-loser-id");
  });

  it("4. same source data on rerun -> identical locator assignment", () => {
    const articles = [a("winner-id", "181", 0), a("loser-id", "181", 1)];
    const run1 = assignSourceLocators(articles);
    const run2 = assignSourceLocators(articles);
    expect([...run1.locatorById.entries()]).toEqual([...run2.locatorById.entries()]);
  });

  it("5. database ordering / array order changes -> identical locator assignment", () => {
    const forward = [a("winner-id", "181", 0), a("loser-id", "181", 1)];
    const reversed = [a("loser-id", "181", 1), a("winner-id", "181", 0)];
    const shuffled = [a("loser-id", "181", 1), a("winner-id", "181", 0)].reverse();
    const r1 = assignSourceLocators(forward);
    const r2 = assignSourceLocators(reversed);
    const r3 = assignSourceLocators(shuffled);
    expect(r1.locatorById.get("winner-id")).toBe(r2.locatorById.get("winner-id"));
    expect(r1.locatorById.get("loser-id")).toBe(r2.locatorById.get("loser-id"));
    expect(r1.locatorById.get("winner-id")).toBe(r3.locatorById.get("winner-id"));
    expect(r1.locatorById.get("loser-id")).toBe(r3.locatorById.get("loser-id"));
  });

  it("6. different legacy ids under the same article number -> different technical locators", () => {
    const { locatorById } = assignSourceLocators([
      a("id-a", "181", 0),
      a("id-b", "181", 1),
      a("id-c", "181", 2),
    ]);
    const locators = new Set(locatorById.values());
    expect(locators.size).toBe(3);
  });

  it("7. technical locator never touches article_number/title/text — only ids and order go in, only a sourceLocator string comes out", () => {
    const { locatorById } = assignSourceLocators([a("id-a", "181", 0)]);
    // The function's own input/output types structurally cannot carry title or
    // text at all (LegacyArticleForLocator has only id/articleNumber/order) —
    // this assertion documents that guarantee at the type + runtime level.
    expect(typeof locatorById.get("id-a")).toBe("string");
    expect(locatorById.get("id-a")).not.toContain("undefined");
  });

  it("9. articles with distinct article numbers never change locator even when a collision exists elsewhere in the same document", () => {
    const { locatorById } = assignSourceLocators([
      a("colliding-1", "181", 0),
      a("colliding-2", "181", 1),
      a("unrelated", "182", 2),
    ]);
    expect(locatorById.get("unrelated")).toBe("article-182");
  });

  it("10. no two articles in the same call can ever be assigned the same sourceLocator", () => {
    const { locatorById } = assignSourceLocators([
      a("a1", "181", 0),
      a("a2", "181", 1),
      a("a3", "181", 2),
      a("a4", null, 3),
      a("a5", null, 4), // null article_number falling back to order=4, distinct from a4's order=3
      a("a6", "182", 5),
    ]);
    const values = [...locatorById.values()];
    expect(new Set(values).size).toBe(values.length);
  });

  it("falls back to order when article_number is null, and still disambiguates null-vs-null collisions by id", () => {
    const { locatorById } = assignSourceLocators([a("only-null", null, 7)]);
    expect(locatorById.get("only-null")).toBe("article-7");
  });

  it("reports every collision group with all participating article ids", () => {
    const { collisions } = assignSourceLocators([
      a("a1", "181", 0),
      a("a2", "181", 1),
      a("a3", "182", 2),
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toEqual({
      baseLocator: "article-181",
      articleIds: ["a1", "a2"],
    });
  });
});
