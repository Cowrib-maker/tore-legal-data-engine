/**
 * READ-ONLY data-quality sweep of the engine destination DB, scoped to the
 * legacy-backfill parserId ("tore-legacy-import-v1"). No writes anywhere.
 *
 * USAGE: npx tsx scripts/audit-data-quality.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main(): Promise<void> {
  const versions = await db.legalDocumentVersion.findMany({
    where: { parserId: "tore-legacy-import-v1" },
  });
  const versionIds = versions.map((v) => v.id);

  const nodes = await db.legalNode.findMany({
    where: { documentVersionId: { in: versionIds } },
  });

  // duplicate (documentVersionId, sourceLocator) — should be structurally
  // impossible under @@unique([documentVersionId, sourceLocator]); verify anyway.
  const locatorKeyCounts = new Map<string, number>();
  for (const n of nodes) {
    const key = `${n.documentVersionId}::${n.sourceLocator}`;
    locatorKeyCounts.set(key, (locatorKeyCounts.get(key) ?? 0) + 1);
  }
  const duplicateLocators = [...locatorKeyCounts.entries()].filter(([, c]) => c > 1);

  const emptyText = nodes.filter((n) => !n.text || n.text.trim().length === 0);
  const malformedLocators = nodes.filter((n) => !/^article-/.test(n.sourceLocator));

  // orphan check: every node's documentVersionId must resolve to a version we
  // already fetched (in-set by construction), and every version's documentId
  // must resolve to a real LegalDocument.
  const documentIds = [...new Set(versions.map((v) => v.documentId))];
  const documents = await db.legalDocument.findMany({ where: { id: { in: documentIds } } });
  const documentIdSet = new Set(documents.map((d) => d.id));
  const orphanVersions = versions.filter((v) => !documentIdSet.has(v.documentId));

  // duplicate document versions: (documentId, versionNumber) should be unique
  // per @@unique([documentId, versionNumber]); verify anyway.
  const versionKeyCounts = new Map<string, number>();
  for (const v of versions) {
    const key = `${v.documentId}::${v.versionNumber}`;
    versionKeyCounts.set(key, (versionKeyCounts.get(key) ?? 0) + 1);
  }
  const duplicateVersions = [...versionKeyCounts.entries()].filter(([, c]) => c > 1);

  const report = {
    scope: { versions: versions.length, nodes: nodes.length, documents: documents.length },
    duplicateLocators: duplicateLocators.length,
    duplicateLocatorSamples: duplicateLocators.slice(0, 5),
    emptyTextNodes: emptyText.length,
    emptyTextSamples: emptyText.slice(0, 5).map((n) => n.id),
    malformedLocators: malformedLocators.length,
    malformedLocatorSamples: malformedLocators.slice(0, 5).map((n) => n.sourceLocator),
    orphanVersions: orphanVersions.length,
    orphanVersionSamples: orphanVersions.slice(0, 5).map((v) => v.id),
    duplicateDocumentVersions: duplicateVersions.length,
    duplicateDocumentVersionSamples: duplicateVersions.slice(0, 5),
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
