import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "../infrastructure/config/env.js";
import { createEngine } from "../infrastructure/compose.js";
import { evaluateCorpus } from "../application/evaluation/evaluate-corpus.js";
import { CorpusCitationValidator } from "../application/citations/corpus-citation-validator.js";
import { CitationStatus, VersionStatus } from "../domain/enums.js";

function applyDotEnv(): void {
  if (!existsSync(".env")) {
    return;
  }
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

applyDotEnv();

async function main(): Promise<void> {
  const env = loadEnv();
  const parsed = new URL(env.DATABASE_URL);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] ?? "");
  const schema = parsed.searchParams.get("schema")?.trim() || "public";
  if (/(?:^|[_-])test(?:[_-]|$)/i.test(name) || /(?:^|[_-])test(?:[_-]|$)/i.test(schema)) {
    throw new Error("evaluate:corpus refuses TEST_DATABASE_URL / test schema");
  }
  const engine = createEngine(env);
  const documents = await engine.prisma.legalDocument.findMany();
  const versions = await engine.prisma.legalDocumentVersion.findMany();
  const nodes = await engine.prisma.legalNode.findMany();
  const citations = await engine.prisma.citationEntry.findMany();
  const archives = await engine.prisma.archiveRecord.findMany();
  const validator = new CorpusCitationValidator(engine.repos.citations);

  const report = await evaluateCorpus({
    documents: documents.map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      documentType: row.documentType,
      title: row.title,
      documentNumber: row.documentNumber,
      issuingAuthority: row.issuingAuthority,
      jurisdiction: row.jurisdiction,
      adoptedAt: row.adoptedAt?.toISOString() ?? null,
      canonicalUrl: row.canonicalUrl,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      versions: [],
    })),
    versions: versions.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      versionNumber: row.versionNumber,
      effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      contentHash: row.contentHash,
      parserId: row.parserId,
      status: row.status,
      amendmentDocumentId: row.amendmentDocumentId,
      archiveRecordId: row.archiveRecordId,
      nodes: [],
    })),
    nodes: nodes.map((row) => ({
      id: row.id,
      documentVersionId: row.documentVersionId,
      parentId: row.parentId,
      nodeType: row.nodeType,
      book: row.book,
      part: row.part,
      chapter: row.chapter,
      section: row.section,
      article: row.article,
      paragraph: row.paragraph,
      clause: row.clause,
      subClause: row.subClause,
      number: row.number,
      title: row.title,
      text: row.text,
      sourceLocator: row.sourceLocator,
      contentHash: row.contentHash,
    })),
    citations: citations.map((row) => ({
      id: row.id,
      documentVersionId: row.documentVersionId,
      legalNodeId: row.legalNodeId,
      citationKey: row.citationKey,
      locator: row.locator,
      exactText: row.exactText,
      sourceUrl: row.sourceUrl,
      contentHash: row.contentHash,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    archives: archives.map((row) => ({
      archiveId: row.id,
      sha256: row.sha256,
      originalUrl: row.originalUrl,
      retrievedAt: row.retrievedAt.toISOString(),
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      storageKey: row.storageKey,
      originalFileName: row.originalFileName,
      encoding: row.encoding ?? undefined,
      sourceId: row.sourceId,
    })),
    archiveBytesExist: async (sha256) => {
      const bytes = await engine.archive.get(sha256);
      return Boolean(bytes && bytes.byteLength > 0);
    },
    resolveLocator: async ({ documentId, locator }) => {
      const [verdict] = await validator.verify([{ query: locator, documentId, locator }]);
      if (verdict?.status === CitationStatus.VALID) {
        return "VALID";
      }
      if (verdict?.status === CitationStatus.CONFLICT) {
        return "AMBIGUOUS";
      }
      return "UNRESOLVED";
    },
  });

  const publishedCount = versions.filter((row) => row.status === VersionStatus.PUBLISHED).length;
  process.stdout.write(
    `${JSON.stringify({ ok: true, publishedVersions: publishedCount, ...report }, null, 2)}\n`,
  );
  await engine.prisma.$disconnect();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "evaluate_failed";
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(1);
});
