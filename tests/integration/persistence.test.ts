import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CorpusCitationValidator } from "../../src/application/citations/corpus-citation-validator.js";
import { CorpusRetrieval } from "../../src/application/legal-corpus/corpus-retrieval.js";
import {
  CitationStatus,
  DocumentStatus,
  DocumentType,
  IngestJobStatus,
  IngestJobType,
  LegalNodeType,
  SourceType,
  TrustLevel,
  VersionStatus,
} from "../../src/domain/enums.js";
import type { LegalNode } from "../../src/domain/entities.js";
import { InvariantError } from "../../src/domain/errors.js";
import { PrismaArchiveRecordRepository } from "../../src/infrastructure/prisma/prisma-archive-record.repository.js";
import {
  createArchive,
  createTestPrismaClient,
  persist,
  prisma,
  repos,
  resetDatabase,
} from "./helpers.js";

function node(
  partial: Partial<LegalNode> & Pick<LegalNode, "id" | "sourceLocator" | "documentVersionId">,
): LegalNode {
  return {
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
    text: "text",
    contentHash: `hash-${partial.id}`,
    children: [],
    ...partial,
  };
}

describe("PostgreSQL corpus persistence", () => {
  const dirs: string[] = [];

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    await prisma.$disconnect();
  });

  async function seedSource() {
    return repos.sources.save({
      name: "LegalInfo",
      type: SourceType.LEGISLATION,
      authority: "LEGALINFO",
      jurisdiction: "MN",
      baseUrl: `https://legalinfo.mn/${randomUUID()}`,
      trustLevel: TrustLevel.OFFICIAL,
    });
  }

  async function seedArchive(sourceId: string) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-pg-archive-"));
    dirs.push(dir);
    const archive = createArchive(dir);
    const stored = await archive.store(new TextEncoder().encode(`<law>${randomUUID()}</law>`), {
      originalUrl: "https://legalinfo.mn/law",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      mimeType: "text/html",
      originalFileName: "law.html",
      sourceId,
    });
    return { archive, stored, dir };
  }

  it("persists documents, versions, and parent/child nodes", async () => {
    const source = await seedSource();
    const { stored } = await seedArchive(source.id);
    const documentId = randomUUID();
    const versionId = randomUUID();
    const docNode = node({
      id: randomUUID(),
      documentVersionId: versionId,
      nodeType: LegalNodeType.DOCUMENT,
      sourceLocator: "doc",
      title: "Civil Code",
      children: [
        node({
          id: randomUUID(),
          documentVersionId: versionId,
          parentId: "",
          sourceLocator: "doc/art-1",
          article: "1",
          title: "Article 1",
          children: [],
        }),
      ],
    });
    const article = docNode.children[0]!;
    article.parentId = docNode.id;
    const p1 = node({
      id: randomUUID(),
      documentVersionId: versionId,
      parentId: article.id,
      nodeType: LegalNodeType.PARAGRAPH,
      sourceLocator: "doc/art-1/p-1",
      article: "1",
      paragraph: "1",
      children: [
        node({
          id: randomUUID(),
          documentVersionId: versionId,
          parentId: "",
          nodeType: LegalNodeType.CLAUSE,
          sourceLocator: "doc/art-1/p-1/c-1",
          article: "1",
          paragraph: "1",
          clause: "1",
        }),
        node({
          id: randomUUID(),
          documentVersionId: versionId,
          parentId: "",
          nodeType: LegalNodeType.CLAUSE,
          sourceLocator: "doc/art-1/p-1/c-2",
          article: "1",
          paragraph: "1",
          clause: "2",
        }),
      ],
    });
    p1.children[0]!.parentId = p1.id;
    p1.children[1]!.parentId = p1.id;
    article.children = [
      p1,
      node({
        id: randomUUID(),
        documentVersionId: versionId,
        parentId: article.id,
        nodeType: LegalNodeType.PARAGRAPH,
        sourceLocator: "doc/art-1/p-2",
        article: "1",
        paragraph: "2",
      }),
    ];
    docNode.children.push(
      node({
        id: randomUUID(),
        documentVersionId: versionId,
        parentId: docNode.id,
        sourceLocator: "doc/art-2",
        article: "2",
        title: "Article 2",
      }),
    );

    const saved = await persist.persist({
      document: {
        id: documentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "Civil Code",
        documentNumber: "CC-1",
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: "2002-01-01T00:00:00.000Z",
        canonicalUrl: "https://legalinfo.mn/law/civil",
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: versionId,
        documentId,
        versionNumber: 1,
        effectiveFrom: "2002-01-01T00:00:00.000Z",
        effectiveTo: null,
        contentHash: stored.record.sha256,
        parserId: "legalinfo-html-v1",
        status: VersionStatus.PUBLISHED,
        amendmentDocumentId: null,
        archiveRecordId: stored.record.archiveId,
      },
      nodes: [docNode],
    });

    expect(saved.document.id).toBe(documentId);
    const tree = await repos.nodes.findTreeByVersion(versionId);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.children[0]?.children).toHaveLength(2);
    expect(tree[0]?.children[0]?.children[0]?.children).toHaveLength(2);
    expect(tree[0]?.children[0]?.children[0]?.children[0]?.nodeType).toBe(
      LegalNodeType.CLAUSE,
    );
  });

  it("keeps historical versions without overlapping published intervals", async () => {
    const source = await seedSource();
    const { stored } = await seedArchive(source.id);
    const documentId = randomUUID();
    const v1 = randomUUID();
    const root = (versionId: string) =>
      node({
        id: randomUUID(),
        documentVersionId: versionId,
        nodeType: LegalNodeType.DOCUMENT,
        sourceLocator: "doc",
      });

    await persist.persist({
      document: {
        id: documentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "Civil Code",
        documentNumber: "CC-1",
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: "2002-01-01T00:00:00.000Z",
        canonicalUrl: `https://legalinfo.mn/law/${documentId}`,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: v1,
        documentId,
        versionNumber: 1,
        effectiveFrom: "2002-01-01T00:00:00.000Z",
        effectiveTo: "2019-12-31T23:59:59.000Z",
        contentHash: `${stored.record.sha256}v1`,
        parserId: "legalinfo-html-v1",
        status: VersionStatus.SUPERSEDED,
        amendmentDocumentId: null,
        archiveRecordId: stored.record.archiveId,
      },
      nodes: [root(v1)],
    });

    const v2 = randomUUID();
    await persist.persist({
      document: {
        id: documentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "Civil Code",
        documentNumber: "CC-1",
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: "2002-01-01T00:00:00.000Z",
        canonicalUrl: `https://legalinfo.mn/law/${documentId}`,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: v2,
        documentId,
        versionNumber: 2,
        effectiveFrom: "2020-01-01T00:00:00.000Z",
        effectiveTo: null,
        contentHash: `${stored.record.sha256}v2`,
        parserId: "legalinfo-html-v1",
        status: VersionStatus.PUBLISHED,
        amendmentDocumentId: null,
        archiveRecordId: stored.record.archiveId,
      },
      nodes: [root(v2)],
    });

    const versions = await repos.versions.listByDocumentId(documentId);
    expect(versions.map((item) => item.versionNumber)).toEqual([1, 2]);
    expect(versions[0]?.status).toBe(VersionStatus.SUPERSEDED);
    expect(versions[1]?.status).toBe(VersionStatus.PUBLISHED);

    await expect(
      persist.persist({
        document: {
          id: documentId,
          sourceId: source.id,
          documentType: DocumentType.LAW,
          title: "Civil Code",
          documentNumber: "CC-1",
          issuingAuthority: "Parliament",
          jurisdiction: "MN",
          adoptedAt: "2002-01-01T00:00:00.000Z",
          canonicalUrl: `https://legalinfo.mn/law/${documentId}`,
          status: DocumentStatus.IN_FORCE,
        },
        version: {
          documentId,
          versionNumber: 3,
          effectiveFrom: "2018-01-01T00:00:00.000Z",
          effectiveTo: null,
          contentHash: `${stored.record.sha256}v3`,
          parserId: "legalinfo-html-v1",
          status: VersionStatus.PUBLISHED,
          amendmentDocumentId: null,
          archiveRecordId: stored.record.archiveId,
        },
        nodes: [root(randomUUID())],
      }),
    ).rejects.toBeInstanceOf(InvariantError);
  });

  it("persists archive metadata by SHA-256 and is idempotent after restart", async () => {
    const source = await seedSource();
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-pg-archive-"));
    dirs.push(dir);
    const archive = createArchive(dir);
    const bytes = new TextEncoder().encode("immutable-bytes");
    const first = await archive.store(bytes, {
      originalUrl: "https://legalinfo.mn/a",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      mimeType: "text/plain",
      originalFileName: "a.txt",
      sourceId: source.id,
    });
    const second = await archive.store(bytes, {
      originalUrl: "https://legalinfo.mn/mirror",
      retrievedAt: "2026-02-01T00:00:00.000Z",
      mimeType: "text/plain",
      originalFileName: "mirror.txt",
      sourceId: source.id,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.archiveId).toBe(first.record.archiveId);

    const restarted = createTestPrismaClient();
    const afterRestart = new PrismaArchiveRecordRepository(restarted);
    const found = await afterRestart.findBySha256(first.record.sha256);
    await restarted.$disconnect();
    expect(found?.archiveId).toBe(first.record.archiveId);
    expect(found?.originalUrl).toBe("https://legalinfo.mn/a");
  });

  it("persists citations and resolves VALID / UNRESOLVED / CONFLICT", async () => {
    const source = await seedSource();
    const { stored } = await seedArchive(source.id);
    const documentId = randomUUID();
    const versionId = randomUUID();
    const nodeId = randomUUID();
    await persist.persist({
      document: {
        id: documentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "Civil Code",
        documentNumber: "CC-1",
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: "2002-01-01T00:00:00.000Z",
        canonicalUrl: `https://legalinfo.mn/law/${documentId}`,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: versionId,
        documentId,
        versionNumber: 1,
        effectiveFrom: "2002-01-01T00:00:00.000Z",
        effectiveTo: null,
        contentHash: stored.record.sha256,
        parserId: "legalinfo-html-v1",
        status: VersionStatus.PUBLISHED,
        amendmentDocumentId: null,
        archiveRecordId: stored.record.archiveId,
      },
      nodes: [
        node({
          id: nodeId,
          documentVersionId: versionId,
          nodeType: LegalNodeType.ARTICLE,
          sourceLocator: "art-5",
          article: "5",
          title: "Article 5",
          text: "A person has legal capacity.",
        }),
      ],
    });

    const citation = await repos.citations.save({
      documentVersionId: versionId,
      legalNodeId: nodeId,
      citationKey: "civil-code-art-5",
      locator: "art-5",
      exactText: "A person has legal capacity.",
      sourceUrl: "https://legalinfo.mn/law/civil#5",
      contentHash: "hash-art-5",
      status: CitationStatus.VALID,
    });
    expect(citation.legalNodeId).toBe(nodeId);

    const validator = new CorpusCitationValidator(repos.citations);
    const [valid] = await validator.verify([{ query: "civil-code-art-5" }]);
    expect(valid?.status).toBe(CitationStatus.VALID);
    expect(valid?.nodeId).toBe(nodeId);
    expect(valid?.documentVersionId).toBe(versionId);

    const [unresolved] = await validator.verify([{ query: "missing-key" }]);
    expect(unresolved?.status).toBe(CitationStatus.UNRESOLVED);

    const otherDocumentId = randomUUID();
    const otherVersionId = randomUUID();
    const otherNodeId = randomUUID();
    const { stored: otherArchive } = await seedArchive(source.id);
    await persist.persist({
      document: {
        id: otherDocumentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "Other Code",
        documentNumber: "OC-1",
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: "2002-01-01T00:00:00.000Z",
        canonicalUrl: `https://legalinfo.mn/law/${otherDocumentId}`,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: otherVersionId,
        documentId: otherDocumentId,
        versionNumber: 1,
        effectiveFrom: "2002-01-01T00:00:00.000Z",
        effectiveTo: null,
        contentHash: otherArchive.record.sha256,
        parserId: "legalinfo-html-v1",
        status: VersionStatus.PUBLISHED,
        amendmentDocumentId: null,
        archiveRecordId: otherArchive.record.archiveId,
      },
      nodes: [
        node({
          id: otherNodeId,
          documentVersionId: otherVersionId,
          sourceLocator: "art-5",
        }),
      ],
    });
    await repos.citations.save({
      documentVersionId: otherVersionId,
      legalNodeId: otherNodeId,
      citationKey: "civil-code-art-5",
      locator: "other-art-5",
      exactText: "Different text",
      sourceUrl: "https://legalinfo.mn/law/other#5",
      contentHash: "hash-other",
      status: CitationStatus.VALID,
    });
    const [conflict] = await validator.verify([{ query: "civil-code-art-5" }]);
    expect(conflict?.status).toBe(CitationStatus.CONFLICT);

    const retrieval = new CorpusRetrieval(repos);
    const byNode = await retrieval.retrieve({
      question: "lookup",
      nodeId,
    });
    expect(byNode.status).toBe("ok");
    expect(byNode.authorities[0]?.nodeId).toBe(nodeId);

    const byDocument = await retrieval.retrieve({
      question: "lookup",
      documentId,
    });
    expect(byDocument.authorities.some((item) => item.nodeId === nodeId)).toBe(true);

    const byKey = await retrieval.retrieve({
      question: "lookup",
      citationKey: "missing-key",
    });
    expect(byKey.authorities).toEqual([]);
  });

  it("tracks ingest job lifecycle and audit events", async () => {
    const source = await seedSource();
    const job = await repos.ingestJobs.create({
      sourceId: source.id,
      jobType: IngestJobType.FETCH,
      url: "https://legalinfo.mn/list",
      metadata: { attempt: 1 },
    });
    expect(job.status).toBe(IngestJobStatus.PENDING);
    const running = await repos.ingestJobs.markRunning(job.id);
    expect(running.status).toBe(IngestJobStatus.RUNNING);
    expect(running.startedAt).toBeTruthy();
    const failed = await repos.ingestJobs.markFailed(job.id, "network");
    expect(failed.status).toBe(IngestJobStatus.FAILED);
    expect(failed.retryCount).toBe(1);
    const succeeded = await repos.ingestJobs.markSucceeded(job.id);
    expect(succeeded.status).toBe(IngestJobStatus.SUCCEEDED);

    const audit = await repos.auditLogs.append({
      actor: "engine:ingest",
      action: "ingest.failed",
      entityType: "IngestJob",
      entityId: job.id,
      metadata: { error: "network" },
    });
    expect(audit.actor).toBe("engine:ingest");
    const listed = await repos.auditLogs.listByEntity("IngestJob", job.id);
    expect(listed).toHaveLength(1);
  });
});
