import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CorpusRetrieval } from "../../src/application/legal-corpus/corpus-retrieval.js";
import {
  DocumentStatus,
  DocumentType,
  LegalNodeType,
  SourceType,
  TrustLevel,
  VersionStatus,
} from "../../src/domain/enums.js";
import type { LegalNode } from "../../src/domain/entities.js";
import { createArchive, persist, prisma, repos, resetDatabase } from "./helpers.js";

/**
 * P0-2B: real PostgreSQL FTS + pg_trgm verification. Unlike the unit-level
 * open-question tests (which use an in-memory substring stand-in), this
 * exercises the actual generated search_vector column, GIN indexes, and
 * raw SQL in PrismaLegalNodeRepository.searchCandidates against the
 * repo's own isolated integration-test schema (TEST_DATABASE_URL, guarded
 * by assertSafeTestDatabaseUrl — never the corpus/dev database).
 */
describe("open-question retrieval (PostgreSQL FTS + pg_trgm)", () => {
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
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-open-question-"));
    dirs.push(dir);
    const archive = createArchive(dir);
    const stored = await archive.store(
      new TextEncoder().encode(`<law>${randomUUID()}</law>`),
      {
        originalUrl: "https://legalinfo.mn/law",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        mimeType: "text/html",
        originalFileName: "law.html",
        sourceId,
      },
    );
    return stored;
  }

  function node(partial: Partial<LegalNode> & Pick<LegalNode, "id" | "documentVersionId" | "sourceLocator">): LegalNode {
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

  async function seedDocumentWithNode(input: {
    status: VersionStatus;
    title: string;
    text: string;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }) {
    const source = await seedSource();
    const stored = await seedArchive(source.id);
    const documentId = randomUUID();
    const versionId = randomUUID();
    await persist.persist({
      document: {
        id: documentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "Хөдөлмөрийн тухай хууль",
        documentNumber: null,
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: null,
        canonicalUrl: `https://legalinfo.mn/law/${documentId}`,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: versionId,
        documentId,
        versionNumber: 1,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
        contentHash: stored.record.sha256,
        parserId: "legalinfo-html-v1",
        status: input.status,
        amendmentDocumentId: null,
        archiveRecordId: stored.record.archiveId,
      },
      nodes: [
        node({
          id: randomUUID(),
          documentVersionId: versionId,
          sourceLocator: "art-40",
          article: "40",
          title: input.title,
          text: input.text,
        }),
      ],
    });
    return { documentId, versionId };
  }

  it("finds a PUBLISHED node via full-text search on its body text", async () => {
    await seedDocumentWithNode({
      status: VersionStatus.PUBLISHED,
      title: "Ажлаас үндэслэлгүй халах",
      text: "Ажил олгогч ажилтныг үндэслэлгүйгээр ажлаас халах эрхгүй.",
    });

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "Намайг ажлаас үндэслэлгүй халсан",
    });

    expect(response.status).toBe("ok");
    expect(response.authorities.length).toBeGreaterThanOrEqual(1);
    expect(response.authorities[0]?.title).toBe("Ажлаас үндэслэлгүй халах");
  });

  it("never returns a DRAFT version for a current-law question", async () => {
    await seedDocumentWithNode({
      status: VersionStatus.DRAFT,
      title: "Ажлаас үндэслэлгүй халах",
      text: "Ажил олгогч ажилтныг үндэслэлгүйгээр ажлаас халах эрхгүй.",
    });

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "Намайг ажлаас үндэслэлгүй халсан",
    });

    expect(response.authorities).toHaveLength(0);
  });

  it("never returns a WITHDRAWN version for a current-law question", async () => {
    await seedDocumentWithNode({
      status: VersionStatus.WITHDRAWN,
      title: "Ажлаас үндэслэлгүй халах",
      text: "Ажил олгогч ажилтныг үндэслэлгүйгээр ажлаас халах эрхгүй.",
    });

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "Намайг ажлаас үндэслэлгүй халсан",
    });

    expect(response.authorities).toHaveLength(0);
  });

  it("matches a slightly misspelled title via trigram similarity", async () => {
    await seedDocumentWithNode({
      status: VersionStatus.PUBLISHED,
      title: "Гэрлэлт цуцлах журам",
      text: "Гэрлэлтийг цуцлахад шүүхэд нэхэмжлэл гаргана.",
    });

    const retrieval = new CorpusRetrieval(repos);
    // Intentional single-character typo in "цуцлах" -> "цуцлахх".
    const response = await retrieval.retrieve({
      question: "Гэрлэлт цуцлаххад ямар журам байдаг вэ",
    });

    expect(response.status).toBe("ok");
    expect(response.authorities.length).toBeGreaterThanOrEqual(1);
  });

  it("returns nothing for a genuinely unrelated question (never invents a source)", async () => {
    await seedDocumentWithNode({
      status: VersionStatus.PUBLISHED,
      title: "Ажлаас үндэслэлгүй халах",
      text: "Ажил олгогч ажилтныг үндэслэлгүйгээр ажлаас халах эрхгүй.",
    });

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "quantum physics unrelated nonsense zzqqxx",
    });

    expect(response.status).toBe("ok");
    expect(response.authorities).toHaveLength(0);
  });

  it("historical asOf: returns the SUPERSEDED version covering the instant, not the current one", async () => {
    const source = await seedSource();
    const oldArchive = await seedArchive(source.id);
    const newArchive = await seedArchive(source.id);
    const documentId = randomUUID();
    const oldVersionId = randomUUID();
    const newVersionId = randomUUID();

    await persist.persist({
      document: {
        id: documentId,
        sourceId: source.id,
        documentType: DocumentType.LAW,
        title: "Хөдөлмөрийн тухай хууль",
        documentNumber: null,
        issuingAuthority: "Parliament",
        jurisdiction: "MN",
        adoptedAt: null,
        canonicalUrl: `https://legalinfo.mn/law/${documentId}`,
        status: DocumentStatus.IN_FORCE,
      },
      version: {
        id: oldVersionId,
        documentId,
        versionNumber: 1,
        effectiveFrom: "2015-01-01T00:00:00.000Z",
        effectiveTo: "2020-01-01T00:00:00.000Z",
        contentHash: oldArchive.record.sha256,
        parserId: "legalinfo-html-v1",
        status: VersionStatus.SUPERSEDED,
        amendmentDocumentId: null,
        archiveRecordId: oldArchive.record.archiveId,
      },
      nodes: [
        node({
          id: randomUUID(),
          documentVersionId: oldVersionId,
          sourceLocator: "art-40",
          article: "40",
          title: "Ажлаас халах эрх",
          text: "Хуучин зохицуулалт: ажлаас халах журам.",
        }),
      ],
    });

    // Document already exists (created by the first persist() call above) —
    // add the second version + its node directly through the repository
    // ports, exactly like PersistLegalDocumentService does internally.
    await repos.versions.save({
      id: newVersionId,
      documentId,
      versionNumber: 2,
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: null,
      contentHash: newArchive.record.sha256,
      parserId: "legalinfo-html-v1",
      status: VersionStatus.PUBLISHED,
      amendmentDocumentId: null,
      archiveRecordId: newArchive.record.archiveId,
    });
    await repos.nodes.replaceForVersion(newVersionId, [
      node({
        id: randomUUID(),
        documentVersionId: newVersionId,
        sourceLocator: "art-40",
        article: "40",
        title: "Ажлаас халах эрх",
        text: "Одоогийн зохицуулалт: ажлаас халах журам.",
      }),
    ]);

    const retrieval = new CorpusRetrieval(repos);
    const response = await retrieval.retrieve({
      question: "ажлаас халах журам",
      asOf: "2017-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe("ok");
    expect(response.authorities).toHaveLength(1);
    expect(response.authorities[0]?.excerpt).toContain("Хуучин");
  });
});
