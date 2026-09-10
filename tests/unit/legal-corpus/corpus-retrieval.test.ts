import { describe, expect, it } from "vitest";

import { CorpusRetrieval } from "../../../src/application/legal-corpus/corpus-retrieval.js";
import {
  DocumentStatus,
  DocumentType,
  LegalNodeType,
  VersionStatus,
} from "../../../src/domain/enums.js";
import type { LegalNode } from "../../../src/domain/entities.js";
import { createInMemoryRepositories } from "../../helpers/in-memory-repos.js";

/**
 * Regression coverage for corpus-retrieval.ts's title fallback: a legacy-backfill
 * article whose source title is null (real data — see the Constitution article-19
 * collision group) must never surface its raw `sourceLocator` as a human-facing
 * title, because a disambiguated locator looks like
 * `article-19__legacyId-<cuid>` (see src/domain/services/legacy-article-locator.ts).
 * That opaque suffix must never leak into what a citation consumer displays.
 */
describe("CorpusRetrieval — human-facing title fallback", () => {
  it("prefers the article number over the opaque sourceLocator when title is null", async () => {
    const { repos } = createInMemoryRepositories();
    await repos.documents.save({
      id: "doc-legacy",
      sourceId: "src",
      documentType: DocumentType.LAW,
      title: "МОНГОЛ УЛСЫН ҮНДСЭН ХУУЛЬ",
      documentNumber: null,
      issuingAuthority: "SGK",
      jurisdiction: "MN",
      adoptedAt: null,
      canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=367",
      status: DocumentStatus.IN_FORCE,
    });
    await repos.versions.save({
      id: "v-legacy",
      documentId: "doc-legacy",
      versionNumber: 1,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-legacy",
      parserId: "tore-legacy-import-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-legacy",
    });
    const untitledLoserNode: LegalNode = {
      id: "n-loser",
      documentVersionId: "v-legacy",
      parentId: null,
      nodeType: LegalNodeType.ARTICLE,
      book: null,
      part: null,
      chapter: null,
      section: null,
      article: "19",
      paragraph: null,
      clause: null,
      subClause: null,
      number: "19",
      // Real legacy source data: title is null for this collision group.
      title: null,
      text: "party-law amendment text",
      sourceLocator: "article-19__legacyId-cmt320r4a02cm0cud79wksv87",
      contentHash: "hash-loser",
      children: [],
    };
    await repos.nodes.replaceForVersion("v-legacy", [untitledLoserNode]);

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({ question: "lookup", nodeId: "n-loser" });

    expect(response.authorities).toHaveLength(1);
    expect(response.authorities[0]?.title).toBe("Article 19");
    expect(response.authorities[0]?.title).not.toContain("legacyId");
    expect(response.authorities[0]?.locator).toBe(
      "article-19__legacyId-cmt320r4a02cm0cud79wksv87",
    );
  });

  it("falls back to sourceLocator only when both title and article number are absent", async () => {
    const { repos } = createInMemoryRepositories();
    await repos.documents.save({
      id: "doc-bare",
      sourceId: "src",
      documentType: DocumentType.LAW,
      title: "Bare Law",
      documentNumber: null,
      issuingAuthority: "SGK",
      jurisdiction: "MN",
      adoptedAt: null,
      canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=bare",
      status: DocumentStatus.IN_FORCE,
    });
    await repos.versions.save({
      id: "v-bare",
      documentId: "doc-bare",
      versionNumber: 1,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-bare",
      parserId: "tore-legacy-import-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-bare",
    });
    const bareNode: LegalNode = {
      id: "n-bare",
      documentVersionId: "v-bare",
      parentId: null,
      nodeType: LegalNodeType.ARTICLE,
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
      text: "no article number available",
      sourceLocator: "article-7",
      contentHash: "hash-bare",
      children: [],
    };
    await repos.nodes.replaceForVersion("v-bare", [bareNode]);

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({ question: "lookup", nodeId: "n-bare" });

    expect(response.authorities[0]?.title).toBe("article-7");
  });
});
