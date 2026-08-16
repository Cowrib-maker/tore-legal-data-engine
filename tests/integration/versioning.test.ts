import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CorpusCitationValidator } from "../../src/application/citations/corpus-citation-validator.js";
import { IngestLegalInfoService } from "../../src/application/ingest/ingest-legalinfo.service.js";
import { CorpusRetrieval } from "../../src/application/legal-corpus/corpus-retrieval.js";
import {
  CitationStatus,
  DocumentStatus,
  DocumentType,
  LegalNodeType,
  SourceType,
  TrustLevel,
  VersionStatus,
} from "../../src/domain/enums.js";
import type { LegalNode } from "../../src/domain/entities.js";
import { InvariantError } from "../../src/domain/errors.js";
import { LegalInfoHtmlParser } from "../../src/parsers/legalinfo/legalinfo-html.parser.js";
import { LAW_HTML_FIXTURE } from "../fixtures/legalinfo/pages.js";
import { persist, prisma, repos, resetDatabase, createArchive } from "./helpers.js";
import type {
  DiscoveredAct,
  DownloadRequest,
  ISourceConnector,
  SourceDescriptor,
} from "../../src/domain/ports/source-connector.js";

const V2_HTML = LAW_HTML_FIXTURE.replace(
  "Хүний амь насыг хорихыг хориглоно.",
  "Хүний амь насыг хорихыг хориглоно. Нэмэлт өөрчлөлт.",
);

class HtmlConnector implements ISourceConnector {
  readonly descriptor: SourceDescriptor = {
    id: "mn.legalinfo",
    name: "fixture",
    jurisdiction: "MN",
    authority: "LEGALINFO",
    enabled: true,
  };

  constructor(private html: string) {}

  setHtml(html: string): void {
    this.html = html;
  }

  async connect() {
    return { connected: true, mode: "mock" as const };
  }

  async discover(): Promise<DiscoveredAct[]> {
    return [
      {
        sourceUrl: "https://legalinfo.mn/mn/detail?lawId=1622",
        canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=1622",
        discoveredTitle: "ЭРҮҮГИЙН ХУУЛЬ",
        actType: "law",
        lawId: "1622",
        discoveredAt: "2026-01-01T00:00:00.000Z",
      },
    ];
  }

  async download(_request?: DownloadRequest) {
    return {
      url: "https://legalinfo.mn/mn/detail?lawId=1622",
      retrievedUrl: "https://legalinfo.mn/mn/detail?lawId=1622",
      bytes: new TextEncoder().encode(this.html),
      mimeType: "text/html; charset=utf-8",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  async health() {
    return { ok: true, detail: "fixture" };
  }
}

function root(versionId: string): LegalNode {
  return {
    id: randomUUID(),
    documentVersionId: versionId,
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
    title: "root",
    text: "root",
    sourceLocator: "doc",
    contentHash: `hash-${versionId}`,
    children: [],
  };
}

describe("corpus versioning (TEST_DATABASE_URL only)", () => {
  const dirs: string[] = [];

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    await prisma.$disconnect();
  });

  async function ingestService(html: string) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-version-"));
    dirs.push(dir);
    const connector = new HtmlConnector(html);
    const archive = createArchive(dir);
    const ingest = new IngestLegalInfoService({
      connector,
      parser: new LegalInfoHtmlParser(),
      archive,
      uow: { run: async (fn) => fn(repos) },
      repos,
    });
    await repos.sources.save({
      id: "mn.legalinfo",
      name: "LegalInfo Mongolia",
      type: SourceType.LEGISLATION,
      authority: "LEGALINFO",
      jurisdiction: "MN",
      baseUrl: "https://legalinfo.mn",
      trustLevel: TrustLevel.OFFICIAL,
    });
    return { ingest, archive, connector };
  }

  it("keeps version 1 immutable and adds version 2 on content change", async () => {
    const { ingest, archive, connector } = await ingestService(LAW_HTML_FIXTURE);
    const first = await ingest.run({ limit: 1, dryRun: false, allowFullCrawl: false });
    expect(first.published).toBe(1);
    const documentId = first.documents[0]?.documentId ?? "";
    const v1Id = first.documents[0]?.versionId ?? "";
    const hash1 = first.documents[0]?.hash ?? "";
    const v1Nodes = await repos.nodes.findTreeByVersion(v1Id);
    const v1Text = JSON.stringify(v1Nodes);

    const same = await ingest.run({ limit: 1, dryRun: false, allowFullCrawl: false });
    expect(same.unchanged).toBe(1);
    expect(same.documents[0]?.versionId).toBe(v1Id);
    const again = await archive.store(new TextEncoder().encode(LAW_HTML_FIXTURE), {
      originalUrl: "https://legalinfo.mn/mn/detail?lawId=1622",
      retrievedAt: "2026-01-02T00:00:00.000Z",
      mimeType: "text/html",
      originalFileName: "dup.html",
      sourceId: "mn.legalinfo",
    });
    expect(again.created).toBe(false);

    connector.setHtml(V2_HTML);
    const second = await ingest.run({ limit: 1, dryRun: false, allowFullCrawl: false });
    expect(second.published).toBe(1);
    const v2Id = second.documents[0]?.versionId ?? "";
    expect(v2Id).not.toBe(v1Id);
    expect(second.documents[0]?.hash).not.toBe(hash1);

    const versions = await repos.versions.listByDocumentId(documentId);
    expect(versions).toHaveLength(2);
    expect(versions[0]?.id).toBe(v1Id);
    expect(versions[0]?.status).toBe(VersionStatus.SUPERSEDED);
    expect(versions[0]?.contentHash).toBe(hash1);
    expect(JSON.stringify(await repos.nodes.findTreeByVersion(v1Id))).toBe(v1Text);
    expect(versions[1]?.status).toBe(VersionStatus.PUBLISHED);
    expect(versions[1]?.contentHash).toBe(second.documents[0]?.hash);

    const citationsV1 = await prisma.citationEntry.count({ where: { documentVersionId: v1Id } });
    const citationsV2 = await prisma.citationEntry.count({ where: { documentVersionId: v2Id } });
    expect(citationsV1).toBeGreaterThan(0);
    expect(citationsV2).toBeGreaterThan(0);
  });

  it("selects historical version by as-of interval and rejects overlapping published rows", async () => {
    const source = await repos.sources.save({
      name: "LegalInfo",
      type: SourceType.LEGISLATION,
      authority: "LEGALINFO",
      jurisdiction: "MN",
      baseUrl: `https://legalinfo.mn/${randomUUID()}`,
      trustLevel: TrustLevel.OFFICIAL,
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-asof-"));
    dirs.push(dir);
    const archive = createArchive(dir);
    const a1 = await archive.store(new TextEncoder().encode("v1-bytes"), {
      originalUrl: "https://legalinfo.mn/mn/detail?lawId=asof",
      retrievedAt: "2020-01-01T00:00:00.000Z",
      mimeType: "text/plain",
      originalFileName: "v1.txt",
      sourceId: source.id,
    });
    const a2 = await archive.store(new TextEncoder().encode("v2-bytes"), {
      originalUrl: "https://legalinfo.mn/mn/detail?lawId=asof",
      retrievedAt: "2022-01-01T00:00:00.000Z",
      mimeType: "text/plain",
      originalFileName: "v2.txt",
      sourceId: source.id,
    });
    const documentId = randomUUID();
    const v1 = randomUUID();
    const node1 = randomUUID();
    await persist.persist({
      document: {
        id: documentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "As-of Law",
        documentNumber: null,
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: null,
        canonicalUrl: `https://legalinfo.mn/mn/detail?lawId=asof-${documentId}`,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: v1,
        documentId,
        versionNumber: 1,
        effectiveFrom: "2020-01-01T00:00:00.000Z",
        effectiveTo: "2021-12-31T23:59:59.000Z",
        contentHash: a1.record.sha256,
        parserId: "legalinfo-html-v1",
        status: VersionStatus.SUPERSEDED,
        amendmentDocumentId: null,
        archiveRecordId: a1.record.archiveId,
      },
      nodes: [
        {
          ...root(v1),
          id: node1,
          text: "version-one",
          sourceLocator: "art-1",
          nodeType: LegalNodeType.ARTICLE,
          article: "1",
        },
      ],
    });
    const v2 = randomUUID();
    await persist.persist({
      document: {
        id: documentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "As-of Law",
        documentNumber: null,
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: null,
        canonicalUrl: `https://legalinfo.mn/mn/detail?lawId=asof-${documentId}`,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: v2,
        documentId,
        versionNumber: 2,
        effectiveFrom: "2022-01-01T00:00:00.000Z",
        effectiveTo: null,
        contentHash: a2.record.sha256,
        parserId: "legalinfo-html-v1",
        status: VersionStatus.PUBLISHED,
        amendmentDocumentId: null,
        archiveRecordId: a2.record.archiveId,
      },
      nodes: [root(v2)],
    });

    await repos.citations.save({
      documentVersionId: v1,
      legalNodeId: node1,
      citationKey: "asof:art-1",
      locator: "art-1",
      exactText: "version-one",
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=asof",
      contentHash: "hash-v1",
      status: CitationStatus.VALID,
    });

    const retrieval = new CorpusRetrieval(repos);
    const historical = await retrieval.retrieve({
      question: "lookup",
      documentId,
      asOf: "2020-06-01T00:00:00.000Z",
    });
    expect(historical.status).toBe("ok");
    expect(historical.authorities[0]?.documentVersionId).toBe(v1);
    expect(historical.authorities[0]?.excerpt).toContain("version-one");

    const current = await retrieval.retrieve({ question: "lookup", documentId });
    expect(current.status).toBe("ok");
    expect(current.authorities[0]?.documentVersionId).toBe(v2);

    const validator = new CorpusCitationValidator(repos.citations);
    const [past] = await validator.verify([
      { query: "asof:art-1", documentId, asOf: "2020-06-01T00:00:00.000Z" },
    ]);
    expect(past?.status).toBe(CitationStatus.VALID);
    expect(past?.documentVersionId).toBe(v1);

    await expect(
      persist.persist({
        document: {
          id: documentId,
          sourceId: source.id,
          documentType: DocumentType.LAW,
          title: "As-of Law",
          documentNumber: null,
          issuingAuthority: "Parliament",
          jurisdiction: "MN",
          adoptedAt: null,
          canonicalUrl: `https://legalinfo.mn/mn/detail?lawId=asof-${documentId}`,
          status: DocumentStatus.IN_FORCE,
        },
        version: {
          documentId,
          versionNumber: 3,
          effectiveFrom: "2021-01-01T00:00:00.000Z",
          effectiveTo: null,
          contentHash: `${a2.record.sha256}-overlap`,
          parserId: "legalinfo-html-v1",
          status: VersionStatus.PUBLISHED,
          amendmentDocumentId: null,
          archiveRecordId: a2.record.archiveId,
        },
        nodes: [root(randomUUID())],
      }),
    ).rejects.toBeInstanceOf(InvariantError);
  });
});
