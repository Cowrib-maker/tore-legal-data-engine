import { describe, expect, it } from "vitest";

import { evaluateVersionStructure } from "../../../src/application/evaluation/evaluate-version.js";
import { evaluateCorpus } from "../../../src/application/evaluation/evaluate-corpus.js";
import { parentTypeAllowed } from "../../../src/application/evaluation/parent-types.js";
import { LegalNodeType, DocumentStatus, DocumentType, VersionStatus, CitationStatus } from "../../../src/domain/enums.js";
import type { FlatEvalNode } from "../../../src/application/evaluation/evaluate-version.js";

function node(partial: Partial<FlatEvalNode> & Pick<FlatEvalNode, "id" | "sourceLocator">): FlatEvalNode {
  return {
    documentVersionId: "v1",
    parentId: null,
    nodeType: LegalNodeType.DOCUMENT,
    book: null,
    part: null,
    chapter: null,
    section: null,
    article: null,
    paragraph: null,
    clause: null,
    subClause: null,
    number: null,
    title: null,
    text: "text",
    contentHash: `hash-${partial.id}`,
    ...partial,
  };
}

describe("parent type compatibility", () => {
  it("allows article under chapter and clause under paragraph", () => {
    expect(parentTypeAllowed(LegalNodeType.DOCUMENT, null)).toBe(true);
    expect(parentTypeAllowed(LegalNodeType.CHAPTER, LegalNodeType.DOCUMENT)).toBe(true);
    expect(parentTypeAllowed(LegalNodeType.ARTICLE, LegalNodeType.CHAPTER)).toBe(true);
    expect(parentTypeAllowed(LegalNodeType.PARAGRAPH, LegalNodeType.ARTICLE)).toBe(true);
    expect(parentTypeAllowed(LegalNodeType.CLAUSE, LegalNodeType.PARAGRAPH)).toBe(true);
    expect(parentTypeAllowed(LegalNodeType.CLAUSE, LegalNodeType.ARTICLE)).toBe(false);
  });
});

describe("version structure evaluation", () => {
  it("passes a single document root with unique locators", () => {
    const doc = node({ id: "d", sourceLocator: "doc" });
    const article = node({
      id: "a",
      parentId: "d",
      nodeType: LegalNodeType.ARTICLE,
      sourceLocator: "art-1",
      article: "1",
    });
    const report = evaluateVersionStructure("doc-1", "v1", [doc, article]);
    expect(report.result).toBe("PASS");
    expect(report.documentParents).toBe(1);
    expect(report.orphans).toEqual([]);
  });

  it("detects orphans, duplicate locators, and incompatible parents", () => {
    const doc = node({ id: "d", sourceLocator: "doc" });
    const orphan = node({
      id: "o",
      parentId: "missing",
      nodeType: LegalNodeType.ARTICLE,
      sourceLocator: "art-1",
    });
    const bad = node({
      id: "b",
      parentId: "d",
      nodeType: LegalNodeType.CLAUSE,
      sourceLocator: "art-1",
    });
    const report = evaluateVersionStructure("doc-1", "v1", [doc, orphan, bad]);
    expect(report.result).toBe("FAIL");
    expect(report.orphans).toContain("art-1");
    expect(report.duplicateLocators).toContain("art-1");
    expect(report.incompatibleTypes.length).toBeGreaterThan(0);
  });
});

describe("corpus evaluation snapshot", () => {
  it("reports UNRESOLVED negatives and VALID inserted locators from nodes", async () => {
    const report = await evaluateCorpus({
      documents: [
        {
          id: "d29",
          sourceId: "mn.legalinfo",
          documentType: DocumentType.LAW,
          title: "АВТОТЭЭВРИЙН ТУХАЙ ХУУЛЬ",
          documentNumber: null,
          issuingAuthority: "SGK",
          jurisdiction: "MN",
          adoptedAt: null,
          canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=29",
          status: DocumentStatus.IN_FORCE,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          versions: [],
        },
      ],
      versions: [
        {
          id: "v29",
          documentId: "d29",
          versionNumber: 1,
          effectiveFrom: null,
          effectiveTo: null,
          contentHash: "abc",
          parserId: "legalinfo-html-v1",
          status: VersionStatus.PUBLISHED,
          amendmentDocumentId: null,
          archiveRecordId: "arc",
          nodes: [],
        },
      ],
      nodes: [
        node({ id: "root", documentVersionId: "v29", sourceLocator: "doc" }),
        node({
          id: "a61",
          documentVersionId: "v29",
          parentId: "root",
          nodeType: LegalNodeType.ARTICLE,
          sourceLocator: "art-6^1",
          article: "6^1",
        }),
        node({
          id: "h",
          documentVersionId: "v29",
          parentId: "a61",
          nodeType: LegalNodeType.PARAGRAPH,
          sourceLocator: "art-6/p-1/c-1",
          article: "6",
          paragraph: "1",
        }),
      ],
      citations: [
        {
          id: "c1",
          documentVersionId: "v29",
          legalNodeId: "a61",
          citationKey: "29:art-6^1",
          locator: "art-6^1",
          exactText: "inserted",
          sourceUrl: "https://legalinfo.mn/mn/detail?lawId=29",
          contentHash: "hash-a61",
          status: CitationStatus.VALID,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      archives: [
        {
          archiveId: "arc",
          sha256: "abc",
          originalUrl: "https://legalinfo.mn/mn/detail?lawId=29",
          retrievedAt: "2026-01-01T00:00:00.000Z",
          mimeType: "text/html",
          byteSize: 10,
          storageKey: "archive/ab/abc",
          originalFileName: "29.html",
        },
      ],
      archiveBytesExist: async () => true,
    });
    expect(report.gaps.some((item) => item.startsWith("as_of_gap"))).toBe(true);
    expect(report.temporal.currentRetrieval).toBe("available");
    expect(report.temporal.historicalAsOf).toBe("unavailable");
    expect(report.insertedArticles.find((item) => item.locator === "art-6^1")?.status).toBe("VALID");
    expect(report.negativeCitations.every((item) => item.status === "UNRESOLVED")).toBe(true);
    expect(report.archives[0]?.ok).toBe(true);
  });
});
