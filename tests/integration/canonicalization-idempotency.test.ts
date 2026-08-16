import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ArchiveService } from "../../src/application/archive/archive.service.js";
import { IngestLegalInfoService } from "../../src/application/ingest/ingest-legalinfo.service.js";
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
import { flattenLegalNodes } from "../../src/domain/services/legal-node-hierarchy.js";
import type { ILegalParser } from "../../src/domain/ports/legal-parser.js";
import { LocalFilesystemByteStore } from "../../src/infrastructure/archive/local-filesystem-byte-store.js";
import { PostgresIndexedArchiveStorage } from "../../src/infrastructure/archive/postgres-indexed.storage.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/prisma/unit-of-work.js";
import {
  LEGALINFO_PARSER_ID,
  LegalInfoHtmlParser,
} from "../../src/parsers/legalinfo/legalinfo-html.parser.js";
import { LAW_HTML_FIXTURE } from "../fixtures/legalinfo/pages.js";
import { persist, prisma, repos, resetDatabase } from "./helpers.js";

const LAW_URL = "https://legalinfo.mn/mn/detail?lawId=29-phase75-impl";
const SPACED_HTML = `<!DOCTYPE html>
<html>
  <head><title>Spaced numbering 11 .1.</title></head>
  <body>
    <div id="bordered-tab1">
      <div class="law_content">
        <p>11 дүгээр зүйл.Тээвэрлүүлэгч, зорчигчийн эрх, үүрэг</p>
        <p>11 .1.Тээвэрлүүлэгч, зорчигч нь дараахь эрх эдэлнэ:</p>
        <p>11.1.1.тээвэрлэлтийн нөхцөл;</p>
      </div>
    </div>
  </body>
</html>`;

const V2_HTML = LAW_HTML_FIXTURE.replace(
  "Хүний амь насыг хорихыг хориглоно.",
  "Хүний амь насыг хорихыг хориглоно. Нэмэлт өөрчлөлт.",
);

class ParserWithId implements ILegalParser {
  constructor(
    readonly id: string,
    private readonly inner: ILegalParser,
  ) {}

  parse(input: Parameters<ILegalParser["parse"]>[0]) {
    return this.inner.parse(input);
  }
}

function emptyArt11Tree(versionId: string): LegalNode[] {
  const docId = randomUUID();
  const artId = randomUUID();
  const p1Id = randomUUID();
  const doc: LegalNode = {
    id: docId,
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
    title: "old",
    text: "old",
    sourceLocator: "doc",
    contentHash: createHash("sha256").update("doc").digest("hex"),
    children: [],
  };
  const art: LegalNode = {
    id: artId,
    documentVersionId: versionId,
    parentId: docId,
    nodeType: LegalNodeType.ARTICLE,
    book: null,
    part: null,
    chapter: null,
    section: null,
    article: "11",
    paragraph: null,
    clause: null,
    subClause: null,
    number: "11",
    title: null,
    text: "11 дүгээр зүйл",
    sourceLocator: "art-11",
    contentHash: createHash("sha256").update("art-11").digest("hex"),
    children: [],
  };
  const p1: LegalNode = {
    id: p1Id,
    documentVersionId: versionId,
    parentId: artId,
    nodeType: LegalNodeType.PARAGRAPH,
    book: null,
    part: null,
    chapter: null,
    section: null,
    article: "11",
    paragraph: "1",
    clause: null,
    subClause: null,
    number: "1",
    title: null,
    text: "",
    sourceLocator: "art-11/p-1",
    contentHash: createHash("sha256").update("art-11/p-1:").digest("hex"),
    children: [],
  };
  art.children = [p1];
  doc.children = [art];
  return [doc];
}

describe("parser/canonicalization versioning (TEST_DATABASE_URL)", () => {
  const dirs: string[] = [];

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    await prisma.$disconnect();
  });

  async function setupArchive(html: string, url = LAW_URL) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-canon-impl-"));
    dirs.push(dir);
    const archive = new ArchiveService(
      new PostgresIndexedArchiveStorage(new LocalFilesystemByteStore(dir), repos.archives),
    );
    const bytes = new TextEncoder().encode(html);
    const stored = await archive.store(bytes, {
      originalUrl: url,
      retrievedAt: "2026-01-01T00:00:00.000Z",
      mimeType: "text/html; charset=utf-8",
      originalFileName: "law.html",
      sourceId: null,
    });
    await repos.sources.save({
      id: "mn.legalinfo",
      name: "LegalInfo",
      type: SourceType.LEGISLATION,
      authority: "LEGALINFO",
      jurisdiction: "MN",
      baseUrl: "https://legalinfo.mn",
      trustLevel: TrustLevel.OFFICIAL,
    });
    return { archive, stored, bytes };
  }

  function ingest(archive: ArchiveService, parser: ILegalParser) {
    return new IngestLegalInfoService({
      connector: {
        descriptor: {
          id: "mn.legalinfo",
          name: "fixture",
          jurisdiction: "MN",
          authority: "LEGALINFO",
          enabled: true,
        },
        connect: async () => ({ connected: true, mode: "mock" as const }),
        discover: async () => [],
        download: async () => {
          throw new Error("network_forbidden");
        },
        health: async () => ({ ok: true, detail: "mock" }),
      },
      archive,
      parser,
      repos,
      uow: new PrismaUnitOfWork(prisma),
    });
  }

  it("A/B/C/D/F/G/H: same bytes + same parser unchanged; different parserId creates canonicalization version", async () => {
    const { archive, stored } = await setupArchive(SPACED_HTML);
    const documentId = randomUUID();
    const versionId = randomUUID();
    const oldTree = emptyArt11Tree(versionId);
    await persist.persist({
      document: {
        id: documentId,
        sourceId: "mn.legalinfo",
        documentType: DocumentType.LAW,
        title: "phase75",
        documentNumber: null,
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: null,
        canonicalUrl: LAW_URL,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: versionId,
        documentId,
        versionNumber: 1,
        effectiveFrom: null,
        effectiveTo: null,
        contentHash: stored.record.sha256,
        parserId: "legalinfo-html-v0",
        status: VersionStatus.PUBLISHED,
        amendmentDocumentId: null,
        archiveRecordId: stored.record.archiveId,
      },
      nodes: oldTree,
    });
    for (const node of flattenLegalNodes(oldTree)) {
      if (node.nodeType === LegalNodeType.DOCUMENT) continue;
      await repos.citations.save({
        documentVersionId: versionId,
        legalNodeId: node.id,
        citationKey: `29:${node.sourceLocator}`,
        locator: node.sourceLocator,
        exactText: node.text,
        sourceUrl: LAW_URL,
        contentHash: node.contentHash,
        status: CitationStatus.VALID,
      });
    }

    const v1Parser = new ParserWithId("legalinfo-html-v0", new LegalInfoHtmlParser());
    const sameParser = await ingest(archive, v1Parser).republishFromArchive({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
      fromArchive: stored.record.sha256,
      lawId: "29-phase75-impl",
    });
    expect(sameParser.unchanged).toBe(1);
    expect(sameParser.published).toBe(0);
    expect(await prisma.legalDocumentVersion.count({ where: { documentId } })).toBe(1);

    const current = new LegalInfoHtmlParser();
    expect(current.id).toBe(LEGALINFO_PARSER_ID);
    const rebuilt = await ingest(archive, current).republishFromArchive({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
      fromArchive: stored.record.sha256,
      lawId: "29-phase75-impl",
    });
    expect(rebuilt.published).toBe(1);
    expect(rebuilt.unchanged).toBe(0);

    const versions = await repos.versions.listByDocumentId(documentId);
    expect(versions).toHaveLength(2);
    const [oldVersion, newVersion] = versions;
    expect(oldVersion?.id).toBe(versionId);
    expect(oldVersion?.status).toBe(VersionStatus.SUPERSEDED);
    expect(oldVersion?.contentHash).toBe(stored.record.sha256);
    expect(oldVersion?.parserId).toBe("legalinfo-html-v0");
    expect(oldVersion?.archiveRecordId).toBe(stored.record.archiveId);
    expect(oldVersion?.effectiveFrom).toBeNull();
    expect(oldVersion?.effectiveTo).toBeNull();

    expect(newVersion?.id).toBe(rebuilt.documents[0]?.versionId);
    expect(newVersion?.status).toBe(VersionStatus.PUBLISHED);
    expect(newVersion?.contentHash).toBe(stored.record.sha256);
    expect(newVersion?.parserId).toBe(LEGALINFO_PARSER_ID);
    expect(newVersion?.archiveRecordId).toBe(stored.record.archiveId);
    expect(newVersion?.effectiveFrom).toBeNull();
    expect(newVersion?.effectiveTo).toBeNull();

    const oldNode = await prisma.legalNode.findFirst({
      where: { documentVersionId: versionId, sourceLocator: "art-11/p-1" },
    });
    const newNode = await prisma.legalNode.findFirst({
      where: { documentVersionId: newVersion!.id, sourceLocator: "art-11/p-1" },
    });
    expect(oldNode?.text).toBe("");
    expect(newNode?.text).toContain("дараахь эрх эдэлнэ");
    expect(await prisma.legalDocumentVersion.findUnique({ where: { id: versionId } })).not.toBeNull();

    const again = await ingest(archive, current).republishFromArchive({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
      fromArchive: stored.record.sha256,
      lawId: "29-phase75-impl",
    });
    expect(again.unchanged).toBe(1);
    expect(await prisma.legalDocumentVersion.count({ where: { documentId } })).toBe(2);
  });

  it("E: different source bytes + same parserId creates a new source version", async () => {
    const url = "https://legalinfo.mn/mn/detail?lawId=1622-phase75";
    const { archive, stored } = await setupArchive(LAW_HTML_FIXTURE, url);
    const parser = new LegalInfoHtmlParser();
    const service = ingest(archive, parser);

    const first = await service.republishFromArchive({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
      fromArchive: stored.record.sha256,
      lawId: "1622-phase75",
    });
    expect(first.published).toBe(1);
    const documentId = first.documents[0]?.documentId ?? "";
    const v1Id = first.documents[0]?.versionId ?? "";
    const hash1 = first.documents[0]?.hash ?? "";

    const stored2 = await archive.store(new TextEncoder().encode(V2_HTML), {
      originalUrl: url,
      retrievedAt: "2026-01-02T00:00:00.000Z",
      mimeType: "text/html; charset=utf-8",
      originalFileName: "law-v2.html",
      sourceId: "mn.legalinfo",
    });
    expect(stored2.record.sha256).not.toBe(hash1);

    const second = await service.republishFromArchive({
      limit: 1,
      dryRun: false,
      allowFullCrawl: false,
      fromArchive: stored2.record.sha256,
      lawId: "1622-phase75",
    });
    expect(second.published).toBe(1);
    const versions = await repos.versions.listByDocumentId(documentId);
    expect(versions).toHaveLength(2);
    expect(versions[0]?.id).toBe(v1Id);
    expect(versions[0]?.status).toBe(VersionStatus.SUPERSEDED);
    expect(versions[0]?.parserId).toBe(LEGALINFO_PARSER_ID);
    expect(versions[1]?.contentHash).toBe(stored2.record.sha256);
    expect(versions[1]?.parserId).toBe(LEGALINFO_PARSER_ID);
    expect(versions[1]?.archiveRecordId).toBe(stored2.record.archiveId);
    expect(versions[1]?.archiveRecordId).not.toBe(versions[0]?.archiveRecordId);
  });
});
