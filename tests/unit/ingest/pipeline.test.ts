import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArchiveService } from "../../../src/application/archive/archive.service.js";
import { CorpusCitationValidator } from "../../../src/application/citations/corpus-citation-validator.js";
import { parseIngestCliArgs } from "../../../src/application/ingest/cli-args.js";
import { IngestLegalInfoService } from "../../../src/application/ingest/ingest-legalinfo.service.js";
import { CitationStatus, DocumentStatus, DocumentType, IngestJobStatus, ParseReviewStatus, SourceType, TrustLevel } from "../../../src/domain/enums.js";
import type {
  DiscoveredAct,
  DownloadRequest,
  ISourceConnector,
  SourceDescriptor,
} from "../../../src/domain/ports/source-connector.js";
import { LocalFilesystemArchiveStorage } from "../../../src/infrastructure/archive/local-filesystem.storage.js";
import { LegalInfoHtmlParser } from "../../../src/parsers/legalinfo/legalinfo-html.parser.js";
import { createInMemoryRepositories } from "../../helpers/in-memory-repos.js";
import { LAW_HTML_FIXTURE, LIST_PAGE_FIXTURE, MALFORMED_HTML_FIXTURE } from "../../fixtures/legalinfo/pages.js";

class FixtureConnector implements ISourceConnector {
  readonly descriptor: SourceDescriptor = {
    id: "mn.legalinfo",
    name: "fixture",
    jurisdiction: "MN",
    authority: "LEGALINFO",
    enabled: true,
  };

  constructor(
    private readonly html: string,
    private readonly detailUrl = "https://legalinfo.mn/mn/detail?lawId=1622",
  ) {}

  async connect() {
    return { connected: true, mode: "mock" as const };
  }

  async discover(): Promise<DiscoveredAct[]> {
    return [
      {
        sourceUrl: this.detailUrl,
        canonicalUrl: this.detailUrl,
        discoveredTitle: "ЭРҮҮГИЙН ХУУЛЬ",
        actType: "law",
        lawId: "1622",
        discoveredAt: "2026-01-01T00:00:00.000Z",
      },
    ];
  }

  async download(_request?: DownloadRequest) {
    return {
      url: this.detailUrl,
      retrievedUrl: this.detailUrl,
      bytes: new TextEncoder().encode(this.html),
      mimeType: "text/html; charset=utf-8",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  async health() {
    return { ok: true, detail: "fixture" };
  }
}

describe("LegalInfo ingest pipeline", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function service(html: string) {
    const { repos, uow } = createInMemoryRepositories();
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-ingest-"));
    dirs.push(dir);
    const archive = new ArchiveService(new LocalFilesystemArchiveStorage(dir));
    return {
      repos,
      archive,
      ingest: new IngestLegalInfoService({
        connector: new FixtureConnector(html),
        parser: new LegalInfoHtmlParser(),
        archive,
        uow,
        repos,
      }),
    };
  }

  it("defaults the CLI to dry-run and limit 1", () => {
    expect(parseIngestCliArgs([], 5)).toEqual({
      limit: 1,
      dryRun: true,
      url: undefined,
      lawId: undefined,
      lawIds: undefined,
      allowFullCrawl: false,
      fromArchive: undefined,
      retrievedAt: undefined,
      expectedShape: undefined,
    });
    expect(parseIngestCliArgs(["--limit", "5", "--publish"], 5).dryRun).toBe(false);
    expect(parseIngestCliArgs(["--limit", "99"], 5).limit).toBe(5);
    expect(
      parseIngestCliArgs(["--law-id", "1", "--law-id", "14407", "--law-id", "8669", "--law-id", "29"], 5)
        .lawIds,
    ).toEqual(["1", "14407", "8669", "29"]);
    expect(
      parseIngestCliArgs(["--law-id", "1", "--law-id", "14407", "--law-id", "8669", "--law-id", "29"], 5)
        .limit,
    ).toBe(4);
  });

  it("archives by hash, publishes citations, and is idempotent", async () => {
    const { ingest, repos } = await service(LAW_HTML_FIXTURE);
    const first = await ingest.run({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
    });
    expect(first.published).toBe(1);
    const second = await ingest.run({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
    });
    expect(second.unchanged).toBe(1);
    const citations = await repos.citations.findByCitationKey("1622:art-17");
    expect(citations).toHaveLength(1);

    const validator = new CorpusCitationValidator(repos.citations);
    const [verdict] = await validator.verify([
      { query: "Эрүүгийн хуулийн 17 дугаар зүйл" },
    ]);
    expect(verdict?.status).toBe(CitationStatus.VALID);
    expect(verdict?.locator).toBe("art-17");

    const audits = await repos.auditLogs.listByEntity(
      "LegalDocument",
      first.documents[0]?.documentId ?? "",
    );
    expect(audits.some((item) => item.action === "ingest.published")).toBe(true);
    expect(audits.every((item) => item.actor === "system/ingestion")).toBe(true);
  });

  it("does not publish malformed parser output", async () => {
    const { ingest, repos } = await service(MALFORMED_HTML_FIXTURE);
    const result = await ingest.run({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
    });
    expect(result.reviews).toBe(1);
    expect(result.published).toBe(0);
    expect(result.documents[0]?.parseReviewId).toBeTruthy();
    expect(await repos.citations.findByCitationKey("1622:art-1")).toEqual([]);
  });

  it("records ingest job lifecycle", async () => {
    const { ingest, repos } = await service(LAW_HTML_FIXTURE);
    const result = await ingest.run({ limit: 1, dryRun: false, allowFullCrawl: false });
    const job = await repos.ingestJobs.findById(result.jobId);
    expect(job?.status).toBe(IngestJobStatus.SUCCEEDED);
    expect(job?.startedAt).toBeTruthy();
  });

  it("dry-run archives and parses without publishing citations", async () => {
    const { ingest, repos, archive } = await service(LAW_HTML_FIXTURE);
    const result = await ingest.run({ limit: 1, dryRun: true, allowFullCrawl: false });
    expect(result.documents[0]?.outcome).toBe("ready");
    expect(result.published).toBe(0);
    expect(await archive.findByHash(result.documents[0]?.hash ?? "")).toBeTruthy();
    expect(await repos.citations.findByCitationKey("1622:art-17")).toEqual([]);
    expect(await repos.documents.findBySourceAndCanonicalUrl("mn.legalinfo", "https://legalinfo.mn/mn/detail?lawId=1622")).toBeNull();
  });

  it("republishes from archived bytes without downloading", async () => {
    const { repos, uow } = createInMemoryRepositories();
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-ingest-"));
    dirs.push(dir);
    const archive = new ArchiveService(new LocalFilesystemArchiveStorage(dir));
    const bytes = await readFile(
      path.resolve(process.cwd(), "tests/fixtures/legalinfo/law-8928-anti-corruption.html"),
    );
    const stored = await archive.store(bytes, {
      originalUrl: "https://legalinfo.mn/mn/detail?lawId=8928",
      retrievedAt: "2026-08-16T14:40:17.001Z",
      mimeType: "text/html; charset=UTF-8",
      originalFileName: "8928.html",
      sourceId: "mn.legalinfo",
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
    const document = await repos.documents.save({
      sourceId: "mn.legalinfo",
      documentType: DocumentType.LAW,
      title: "АВЛИГЫН ЭСРЭГ ХУУЛЬ",
      documentNumber: null,
      issuingAuthority: "State Great Khural",
      jurisdiction: "MN",
      adoptedAt: null,
      canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=8928",
      status: DocumentStatus.DRAFT,
    });
    const review = await repos.parseReviews.save({
      documentId: document.id,
      archiveRecordId: stored.record.archiveId,
      status: ParseReviewStatus.PENDING,
      reason: "broken_article_hierarchy,duplicate_locators",
      parsedPayload: { parser: "legalinfo-html-v1" },
    });
    const ingest = new IngestLegalInfoService({
      connector: new FixtureConnector(LAW_HTML_FIXTURE),
      parser: new LegalInfoHtmlParser(),
      archive,
      uow,
      repos,
    });
    const first = await ingest.republishFromArchive({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
      fromArchive: stored.record.sha256,
      expectedShape: { articles: 37, paragraphs: 133, clauses: 143, nodes: 320 },
    });
    expect(first.published).toBe(1);
    expect(first.documents[0]?.shape).toMatchObject({
      nodes: 320,
      articles: 37,
      paragraphs: 133,
      clauses: 143,
      duplicateLocators: 0,
    });
    const second = await ingest.republishFromArchive({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
      fromArchive: stored.record.sha256,
    });
    expect(second.unchanged).toBe(1);
    const accepted = await repos.parseReviews.findById(review.id);
    expect(accepted?.status).toBe(ParseReviewStatus.ACCEPTED);
    const saved = await repos.documents.findById(document.id);
    expect(saved?.status).toBe(DocumentStatus.IN_FORCE);
  });
});

describe("listing fixture is not live network", () => {
  it("does not contain a crawl of the whole corpus", () => {
    expect(LIST_PAGE_FIXTURE).toContain("act-name");
  });
});
