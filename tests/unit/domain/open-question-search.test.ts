import { describe, expect, it } from "vitest";

import { VersionStatus } from "../../../src/domain/enums.js";
import type { LegalNodeSearchCandidate } from "../../../src/domain/entities.js";
import {
  filterAndDedupeCandidates,
  normalizeOpenQuestion,
} from "../../../src/domain/services/open-question-search.js";

function candidate(
  overrides: Partial<LegalNodeSearchCandidate> & { id: string; locator: string },
): LegalNodeSearchCandidate {
  return {
    node: {
      id: overrides.id,
      documentVersionId: "v1",
      parentId: null,
      nodeType: "ARTICLE",
      book: null,
      part: null,
      chapter: null,
      section: null,
      article: null,
      paragraph: null,
      clause: null,
      subClause: null,
      number: null,
      title: "Title",
      text: "text",
      sourceLocator: overrides.locator,
      contentHash: "hash",
    },
    documentId: "doc-1",
    versionId: "v1",
    versionStatus: VersionStatus.PUBLISHED,
    effectiveFrom: null,
    effectiveTo: null,
    sourceContentHash: "shash",
    parserId: "parser",
    archiveRecordId: "arc",
    score: 1,
    ...overrides,
  };
}

describe("normalizeOpenQuestion", () => {
  it("collapses internal whitespace and trims", () => {
    expect(normalizeOpenQuestion("  Намайг   ажлаас  халсан.  ")).toBe(
      "Намайг ажлаас халсан.",
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeOpenQuestion("   \n\t  ")).toBe("");
  });
});

describe("filterAndDedupeCandidates", () => {
  it("passes through candidates unchanged when asOf is not set", () => {
    const candidates = [candidate({ id: "n1", locator: "art-1" })];
    expect(filterAndDedupeCandidates(candidates, null)).toEqual(candidates);
  });

  it("drops candidates whose version does not cover the asOf instant", () => {
    const covering = candidate({
      id: "n1",
      locator: "art-1",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: "2025-01-01T00:00:00.000Z",
    });
    const notCovering = candidate({
      id: "n2",
      locator: "art-2",
      documentId: "doc-2",
      effectiveFrom: "2025-06-01T00:00:00.000Z",
      effectiveTo: "2026-01-01T00:00:00.000Z",
    });
    const result = filterAndDedupeCandidates(
      [covering, notCovering],
      "2022-01-01T00:00:00.000Z",
    );
    expect(result).toEqual([covering]);
  });

  it("never guesses applicability when effective bounds are incomplete under asOf", () => {
    const incompleteBounds = candidate({
      id: "n1",
      locator: "art-1",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: null,
    });
    expect(
      filterAndDedupeCandidates([incompleteBounds], "2022-01-01T00:00:00.000Z"),
    ).toEqual([]);
  });

  it("deduplicates by (documentId, sourceLocator), keeping the first (highest-ranked) occurrence", () => {
    const first = candidate({ id: "n1", locator: "art-1", score: 0.9 });
    const duplicate = candidate({ id: "n1-dup", locator: "art-1", score: 0.4 });
    const distinct = candidate({ id: "n2", locator: "art-2", score: 0.5 });
    const result = filterAndDedupeCandidates([first, duplicate, distinct], null);
    expect(result).toEqual([first, distinct]);
  });
});
