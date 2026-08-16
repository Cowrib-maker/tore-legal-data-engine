import { describe, expect, it } from "vitest";

import { CorpusRetrieval } from "../../../src/application/legal-corpus/corpus-retrieval.js";
import {
  CitationStatus,
  DocumentStatus,
  DocumentType,
  LegalNodeType,
  VersionStatus,
} from "../../../src/domain/enums.js";
import type { LegalNode } from "../../../src/domain/entities.js";
import { RetrieveStatus } from "../../../src/domain/ports/retrieval.js";
import { versionsDoNotOverlap } from "../../../src/domain/services/document-version.js";
import { retrieveResponseSchema } from "../../../src/api/contracts.js";
import { createInMemoryRepositories } from "../../helpers/in-memory-repos.js";

function article(versionId: string, id: string, text: string): LegalNode {
  return {
    id,
    documentVersionId: versionId,
    parentId: null,
    nodeType: LegalNodeType.ARTICLE,
    book: null,
    part: null,
    chapter: null,
    section: null,
    article: "1",
    paragraph: null,
    clause: null,
    subClause: null,
    number: "1",
    title: "Article 1",
    text,
    sourceLocator: "art-1",
    contentHash: `hash-${id}`,
    children: [],
  };
}

async function seedVersion(input: {
  documentId: string;
  versionId: string;
  nodeId: string;
  text: string;
  versionNumber: number;
  status: typeof VersionStatus.PUBLISHED | typeof VersionStatus.SUPERSEDED;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  contentHash: string;
}): Promise<CorpusRetrieval> {
  const { repos } = createInMemoryRepositories();
  await repos.documents.save({
    id: input.documentId,
    sourceId: "src",
    documentType: DocumentType.LAW,
    title: "Test Law",
    documentNumber: null,
    issuingAuthority: "SGK",
    jurisdiction: "MN",
    adoptedAt: null,
    canonicalUrl: `https://legalinfo.mn/mn/detail?lawId=${input.documentId}`,
    status: DocumentStatus.IN_FORCE,
  });
  await repos.versions.save({
    id: input.versionId,
    documentId: input.documentId,
    versionNumber: input.versionNumber,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    contentHash: input.contentHash,
    parserId: "legalinfo-html-v1",
    status: input.status,
    amendmentDocumentId: null,
    archiveRecordId: "arc",
  });
  await repos.nodes.replaceForVersion(input.versionId, [
    article(input.versionId, input.nodeId, input.text),
  ]);
  await repos.citations.save({
    documentVersionId: input.versionId,
    legalNodeId: input.nodeId,
    citationKey: "test:art-1",
    locator: "art-1",
    exactText: input.text,
    sourceUrl: `https://legalinfo.mn/mn/detail?lawId=${input.documentId}`,
    contentHash: `hash-${input.nodeId}`,
    status: CitationStatus.VALID,
  });
  return new CorpusRetrieval(repos);
}

describe("as-of historical retrieval safety", () => {
  it("A: retrieve without asOf returns the current PUBLISHED version", async () => {
    const retrieval = await seedVersion({
      documentId: "doc-current",
      versionId: "v-current",
      nodeId: "n-current",
      text: "current text",
      versionNumber: 1,
      status: VersionStatus.PUBLISHED,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-current",
    });
    const response = await retrieval.retrieve({
      question: "lookup",
      documentId: "doc-current",
    });
    expect(response.status).toBe(RetrieveStatus.OK);
    expect(response.authorities[0]?.documentVersionId).toBe("v-current");
    expect(response.authorities[0]?.excerpt).toContain("current text");
    expect(retrieveResponseSchema.parse(response).status).toBe("ok");
  });

  it("B: asOf with a closed interval returns the matching version", async () => {
    const retrieval = await seedVersion({
      documentId: "doc-dated",
      versionId: "v-dated",
      nodeId: "n-dated",
      text: "dated text",
      versionNumber: 1,
      status: VersionStatus.PUBLISHED,
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: "2022-01-01T00:00:00.000Z",
      contentHash: "hash-dated",
    });
    const response = await retrieval.retrieve({
      question: "lookup",
      documentId: "doc-dated",
      asOf: "2020-06-01T00:00:00.000Z",
    });
    expect(response.status).toBe(RetrieveStatus.OK);
    expect(response.authorities[0]?.documentVersionId).toBe("v-dated");
    expect(response.authorities[0]?.effectiveFrom).toBe("2020-01-01T00:00:00.000Z");
  });

  it("C: asOf against a version with both dates null is AS_OF_UNAVAILABLE", async () => {
    const retrieval = await seedVersion({
      documentId: "doc-null",
      versionId: "v-null",
      nodeId: "n-null",
      text: "undated snapshot",
      versionNumber: 1,
      status: VersionStatus.PUBLISHED,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-null",
    });
    const response = await retrieval.retrieve({
      question: "lookup",
      documentId: "doc-null",
      asOf: "2015-01-01T00:00:00.000Z",
    });
    expect(response.status).toBe(RetrieveStatus.AS_OF_UNAVAILABLE);
    expect(response.authorities).toEqual([]);
    expect(retrieveResponseSchema.parse(response).status).toBe("AS_OF_UNAVAILABLE");
  });

  it("D: asOf does not select a SUPERSEDED version with both dates null", async () => {
    const { repos } = createInMemoryRepositories();
    await repos.documents.save({
      id: "doc-sup",
      sourceId: "src",
      documentType: DocumentType.LAW,
      title: "Superseded undated",
      documentNumber: null,
      issuingAuthority: "SGK",
      jurisdiction: "MN",
      adoptedAt: null,
      canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=doc-sup",
      status: DocumentStatus.IN_FORCE,
    });
    await repos.versions.save({
      id: "v-old",
      documentId: "doc-sup",
      versionNumber: 1,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-old",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.SUPERSEDED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-old",
    });
    await repos.versions.save({
      id: "v-new",
      documentId: "doc-sup",
      versionNumber: 2,
      effectiveFrom: null,
      effectiveTo: null,
      contentHash: "hash-new",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: "arc-new",
    });
    await repos.nodes.replaceForVersion("v-old", [
      article("v-old", "n-old", "old undated"),
    ]);
    await repos.nodes.replaceForVersion("v-new", [
      article("v-new", "n-new", "new undated"),
    ]);
    const retrieval = new CorpusRetrieval(repos);
    const historical = await retrieval.retrieve({
      question: "lookup",
      documentId: "doc-sup",
      asOf: "2010-01-01T00:00:00.000Z",
    });
    expect(historical.status).toBe(RetrieveStatus.AS_OF_UNAVAILABLE);
    expect(historical.authorities).toEqual([]);
    const current = await retrieval.retrieve({ question: "lookup", documentId: "doc-sup" });
    expect(current.status).toBe(RetrieveStatus.OK);
    expect(current.authorities[0]?.documentVersionId).toBe("v-new");
  });

  it("E: asOf outside a known interval has no authoritative match", async () => {
    const retrieval = await seedVersion({
      documentId: "doc-range",
      versionId: "v-range",
      nodeId: "n-range",
      text: "in-range",
      versionNumber: 1,
      status: VersionStatus.PUBLISHED,
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: "2021-01-01T00:00:00.000Z",
      contentHash: "hash-range",
    });
    const response = await retrieval.retrieve({
      question: "lookup",
      documentId: "doc-range",
      asOf: "2018-01-01T00:00:00.000Z",
    });
    expect(response.status).toBe(RetrieveStatus.AS_OF_UNAVAILABLE);
    expect(response.authorities).toEqual([]);
  });

  it("F: two closed intervals select the historical version for asOf", async () => {
    const { repos } = createInMemoryRepositories();
    await repos.documents.save({
      id: "doc-two",
      sourceId: "src",
      documentType: DocumentType.LAW,
      title: "Two versions",
      documentNumber: null,
      issuingAuthority: "SGK",
      jurisdiction: "MN",
      adoptedAt: null,
      canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=doc-two",
      status: DocumentStatus.IN_FORCE,
    });
    await repos.versions.save({
      id: "v1",
      documentId: "doc-two",
      versionNumber: 1,
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: "2022-01-01T00:00:00.000Z",
      contentHash: "h1",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.SUPERSEDED,
      amendmentDocumentId: null,
      archiveRecordId: "a1",
    });
    await repos.versions.save({
      id: "v2",
      documentId: "doc-two",
      versionNumber: 2,
      effectiveFrom: "2022-01-01T00:00:00.000Z",
      effectiveTo: "2024-01-01T00:00:00.000Z",
      contentHash: "h2",
      parserId: "legalinfo-html-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: "a2",
    });
    await repos.nodes.replaceForVersion("v1", [article("v1", "n1", "first era")]);
    await repos.nodes.replaceForVersion("v2", [article("v2", "n2", "second era")]);
    const retrieval = new CorpusRetrieval(repos);
    const past = await retrieval.retrieve({
      question: "lookup",
      documentId: "doc-two",
      asOf: "2021-06-01T00:00:00.000Z",
    });
    const later = await retrieval.retrieve({
      question: "lookup",
      documentId: "doc-two",
      asOf: "2022-06-01T00:00:00.000Z",
    });
    expect(past.status).toBe(RetrieveStatus.OK);
    expect(past.authorities[0]?.documentVersionId).toBe("v1");
    expect(past.authorities[0]?.excerpt).toContain("first era");
    expect(later.status).toBe(RetrieveStatus.OK);
    expect(later.authorities[0]?.documentVersionId).toBe("v2");
    expect(later.authorities[0]?.excerpt).toContain("second era");
  });

  it("G: overlapping PUBLISHED intervals are rejected", () => {
    expect(
      versionsDoNotOverlap([
        {
          id: "a",
          effectiveFrom: "2020-01-01T00:00:00.000Z",
          effectiveTo: "2022-01-01T00:00:00.000Z",
          status: VersionStatus.PUBLISHED,
        },
        {
          id: "b",
          effectiveFrom: "2021-01-01T00:00:00.000Z",
          effectiveTo: "2023-01-01T00:00:00.000Z",
          status: VersionStatus.PUBLISHED,
        },
      ]),
    ).toBe(false);
  });
});
