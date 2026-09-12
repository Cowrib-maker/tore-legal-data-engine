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

describe("CorpusRetrieval — open-question retrieval (P0-2B)", () => {
  async function seedLaborLaw(repos: ReturnType<typeof createInMemoryRepositories>["repos"]) {
    await repos.documents.save({
      id: "doc-labor",
      sourceId: "src",
      documentType: DocumentType.LAW,
      title: "Хөдөлмөрийн тухай хууль",
      documentNumber: null,
      issuingAuthority: "SGK",
      jurisdiction: "MN",
      adoptedAt: null,
      canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=labor",
      status: DocumentStatus.IN_FORCE,
    });
  }

  it("returns a PUBLISHED node whose text matches the question", async () => {
    const { repos } = createInMemoryRepositories();
    await seedLaborLaw(repos);
    await repos.versions.save({
      id: "v-labor",
      documentId: "doc-labor",
      versionNumber: 1,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-labor",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-labor",
    });
    const node: LegalNode = {
      id: "n-labor",
      documentVersionId: "v-labor",
      parentId: null,
      nodeType: LegalNodeType.ARTICLE,
      book: null,
      part: null,
      chapter: null,
      section: null,
      article: "40",
      paragraph: null,
      clause: null,
      subClause: null,
      number: "40",
      title: "Ажлаас үндэслэлгүй халах",
      text: "Ажил олгогч ажилтныг үндэслэлгүйгээр ажлаас халах эрхгүй.",
      sourceLocator: "art-40",
      contentHash: "hash-node",
      children: [],
    };
    await repos.nodes.replaceForVersion("v-labor", [node]);

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "Намайг ажлаас үндэслэлгүй халсан. Яах вэ?",
    });

    expect(response.status).toBe("ok");
    expect(response.authorities).toHaveLength(1);
    expect(response.authorities[0]?.nodeId).toBe("n-labor");
  });

  it("never returns a DRAFT or WITHDRAWN version for a current-law question", async () => {
    const { repos } = createInMemoryRepositories();
    await seedLaborLaw(repos);
    await repos.versions.save({
      id: "v-draft",
      documentId: "doc-labor",
      versionNumber: 1,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-draft",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.DRAFT,
      amendmentDocumentId: null,
      archiveRecordId: "arc-draft",
    });
    const draftNode: LegalNode = {
      id: "n-draft",
      documentVersionId: "v-draft",
      parentId: null,
      nodeType: LegalNodeType.ARTICLE,
      book: null,
      part: null,
      chapter: null,
      section: null,
      article: "40",
      paragraph: null,
      clause: null,
      subClause: null,
      number: "40",
      title: "Ажлаас үндэслэлгүй халах",
      text: "Ажил олгогч ажилтныг үндэслэлгүйгээр ажлаас халах эрхгүй.",
      sourceLocator: "art-40",
      contentHash: "hash-node",
      children: [],
    };
    await repos.nodes.replaceForVersion("v-draft", [draftNode]);

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "Намайг ажлаас үндэслэлгүй халсан. Яах вэ?",
    });

    expect(response.authorities).toHaveLength(0);
  });

  it("returns empty (never a fabricated hit) for an unrelated question", async () => {
    const { repos } = createInMemoryRepositories();
    await seedLaborLaw(repos);
    await repos.versions.save({
      id: "v-labor2",
      documentId: "doc-labor",
      versionNumber: 1,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-labor2",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-labor2",
    });
    const node: LegalNode = {
      id: "n-labor2",
      documentVersionId: "v-labor2",
      parentId: null,
      nodeType: LegalNodeType.ARTICLE,
      book: null,
      part: null,
      chapter: null,
      section: null,
      article: "40",
      paragraph: null,
      clause: null,
      subClause: null,
      number: "40",
      title: "Ажлаас үндэслэлгүй халах",
      text: "Ажил олгогч ажилтныг үндэслэлгүйгээр ажлаас халах эрхгүй.",
      sourceLocator: "art-40",
      contentHash: "hash-node",
      children: [],
    };
    await repos.nodes.replaceForVersion("v-labor2", [node]);

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "zzzzz qqqqq nonsense unrelated gibberish",
    });

    expect(response.authorities).toHaveLength(0);
    expect(response.status).toBe("ok");
  });

  it("returns empty for a blank/whitespace-only question without any lookup", async () => {
    const { repos } = createInMemoryRepositories();
    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({ question: "   " });
    expect(response.authorities).toHaveLength(0);
  });

  it("historical asOf: returns a SUPERSEDED version that covers the instant, never the unrelated current one", async () => {
    const { repos } = createInMemoryRepositories();
    await seedLaborLaw(repos);
    await repos.versions.save({
      id: "v-old",
      documentId: "doc-labor",
      versionNumber: 1,
      effectiveFrom: "2015-01-01T00:00:00.000Z",
      effectiveTo: "2020-01-01T00:00:00.000Z",
      contentHash: "hash-old",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.SUPERSEDED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-old",
    });
    await repos.versions.save({
      id: "v-current",
      documentId: "doc-labor",
      versionNumber: 2,
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: null,
      contentHash: "hash-current",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-current",
    });
    const oldNode: LegalNode = {
      id: "n-old",
      documentVersionId: "v-old",
      parentId: null,
      nodeType: LegalNodeType.ARTICLE,
      book: null,
      part: null,
      chapter: null,
      section: null,
      article: "40",
      paragraph: null,
      clause: null,
      subClause: null,
      number: "40",
      title: "Ажлаас халах эрх",
      text: "Хуучин зохицуулалт: ажлаас халах журам.",
      sourceLocator: "art-40",
      contentHash: "hash-old-node",
      children: [],
    };
    const currentNode: LegalNode = {
      ...oldNode,
      id: "n-current",
      documentVersionId: "v-current",
      text: "Одоогийн зохицуулалт: ажлаас халах журам.",
      contentHash: "hash-current-node",
    };
    await repos.nodes.replaceForVersion("v-old", [oldNode]);
    await repos.nodes.replaceForVersion("v-current", [currentNode]);

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "ажлаас халах журам",
      asOf: "2017-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe("ok");
    expect(response.authorities.map((a) => a.nodeId)).toEqual(["n-old"]);
  });

  it("historical asOf outside any covered interval returns AS_OF_UNAVAILABLE, never a guess", async () => {
    const { repos } = createInMemoryRepositories();
    await seedLaborLaw(repos);
    await repos.versions.save({
      id: "v-only",
      documentId: "doc-labor",
      versionNumber: 1,
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: null,
      contentHash: "hash-only",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-only",
    });
    const node: LegalNode = {
      id: "n-only",
      documentVersionId: "v-only",
      parentId: null,
      nodeType: LegalNodeType.ARTICLE,
      book: null,
      part: null,
      chapter: null,
      section: null,
      article: "40",
      paragraph: null,
      clause: null,
      subClause: null,
      number: "40",
      title: "Ажлаас халах эрх",
      text: "Одоогийн зохицуулалт: ажлаас халах журам.",
      sourceLocator: "art-40",
      contentHash: "hash-only-node",
      children: [],
    };
    await repos.nodes.replaceForVersion("v-only", [node]);

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "ажлаас халах журам",
      asOf: "2010-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe("AS_OF_UNAVAILABLE");
    expect(response.authorities).toHaveLength(0);
  });
});
