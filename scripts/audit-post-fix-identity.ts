/**
 * READ-ONLY, post-fix reconciliation of every legacy source article against
 * its destination LegalNode. Satisfies both:
 *   - reports/post-fix-node-identity-audit.json (technical identity check)
 *   - reports/overnight-content-integrity.json  (content/provenance check)
 * from a single pass, since both need the same source<->destination join.
 *
 * Reads BOTH databases. Writes to NEITHER. Uses the exact same
 * assignSourceLocators() function the migration script itself uses (imported,
 * not reimplemented), so this audit is checking real migration behavior, not
 * a parallel guess at it.
 *
 * Document matching: uses EngineAuditLog rows the migration itself writes
 * (action: "legacy_backfill", metadata.sourceLegacyId) as the provenance
 * anchor back to the exact tore document — this is the auditable link
 * legal-data-migration.md §4 describes, not a guess by URL/title matching.
 *
 * USAGE: npx tsx scripts/audit-post-fix-identity.ts
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assignSourceLocators } from "../src/domain/services/legacy-article-locator.js";

function applyDotEnv(): void {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
applyDotEnv();

const sourceDatabaseUrl = process.env.TORE_SOURCE_DATABASE_URL;
if (!sourceDatabaseUrl) {
  throw new Error("TORE_SOURCE_DATABASE_URL is not set.");
}
const sourceDb = new PrismaClient({ datasourceUrl: sourceDatabaseUrl });
const engineDb = new PrismaClient(); // DATABASE_URL — engine DB, read-only use in this script

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

type ArticleRow = {
  id: string;
  document_id: string;
  article_number: string | null;
  title: string | null;
  text: string;
  order: number;
};

async function main(): Promise<void> {
  const articles = await sourceDb.$queryRawUnsafe<ArticleRow[]>(
    `SELECT id, document_id, article_number, title, text, "order"
     FROM legal_knowledge_articles
     ORDER BY document_id ASC, "order" ASC`,
  );
  const articlesByDoc = new Map<string, ArticleRow[]>();
  for (const a of articles) {
    if (!articlesByDoc.has(a.document_id)) articlesByDoc.set(a.document_id, []);
    articlesByDoc.get(a.document_id)!.push(a);
  }

  // sourceLegacyId -> engine LegalDocument id, via the audit trail the
  // migration itself wrote (read-only findMany, not a raw query).
  const backfillLogs = await engineDb.engineAuditLog.findMany({
    where: { actor: "migrate-legacy-tore-data", action: "legacy_backfill", entityType: "LegalDocument" },
  });
  const engineDocIdBySourceId = new Map<string, string>();
  for (const log of backfillLogs) {
    const meta = log.metadata as { sourceLegacyId?: string } | null;
    if (meta?.sourceLegacyId && log.entityId) {
      engineDocIdBySourceId.set(meta.sourceLegacyId, log.entityId);
    }
  }

  const allVersions = await engineDb.legalDocumentVersion.findMany({
    where: { parserId: "tore-legacy-import-v1" },
  });
  const versionByDocId = new Map(allVersions.map((v) => [v.documentId, v]));

  const allNodes = await engineDb.legalNode.findMany({
    where: { documentVersionId: { in: allVersions.map((v) => v.id) } },
  });
  const nodesByVersionAndLocator = new Map<string, (typeof allNodes)[number]>();
  const nodeCountByVersion = new Map<string, number>();
  for (const node of allNodes) {
    nodesByVersionAndLocator.set(`${node.documentVersionId}::${node.sourceLocator}`, node);
    nodeCountByVersion.set(
      node.documentVersionId,
      (nodeCountByVersion.get(node.documentVersionId) ?? 0) + 1,
    );
  }

  let matched = 0;
  let missing = 0;
  let mismatched = 0;
  let documentsNotFoundInDestination = 0;
  let baseArticleNumberCollisionGroups = 0;
  const missingDetails: Array<{ sourceArticleId: string; documentId: string; expectedLocator: string }> = [];
  const mismatchDetails: Array<{ sourceArticleId: string; expectedLocator: string; reason: string }> = [];
  const collisionGroupDetails: Array<{ documentId: string; baseLocator: string; articleIds: string[]; resolvedLocators: string[] }> = [];

  for (const [documentId, docArticles] of articlesByDoc) {
    const engineDocId = engineDocIdBySourceId.get(documentId);
    if (!engineDocId) {
      documentsNotFoundInDestination += 1;
      continue;
    }
    const version = versionByDocId.get(engineDocId);
    if (!version) {
      documentsNotFoundInDestination += 1;
      continue;
    }

    const { locatorById, collisions } = assignSourceLocators(
      docArticles.map((a) => ({ id: a.id, articleNumber: a.article_number, order: a.order })),
    );
    if (collisions.length > 0) {
      baseArticleNumberCollisionGroups += collisions.length;
      for (const c of collisions) {
        collisionGroupDetails.push({
          documentId,
          baseLocator: c.baseLocator,
          articleIds: c.articleIds,
          resolvedLocators: c.articleIds.map((id) => locatorById.get(id)!),
        });
      }
    }

    for (const article of docArticles) {
      const expectedLocator = locatorById.get(article.id)!;
      const node = nodesByVersionAndLocator.get(`${version.id}::${expectedLocator}`);
      if (!node) {
        missing += 1;
        missingDetails.push({ sourceArticleId: article.id, documentId, expectedLocator });
        continue;
      }
      const expectedHash = sha256(article.text);
      if (node.contentHash !== expectedHash) {
        mismatched += 1;
        mismatchDetails.push({ sourceArticleId: article.id, expectedLocator, reason: "contentHash mismatch" });
        continue;
      }
      if ((node.article ?? null) !== (article.article_number ?? null)) {
        mismatched += 1;
        mismatchDetails.push({ sourceArticleId: article.id, expectedLocator, reason: "article number mismatch" });
        continue;
      }
      matched += 1;
    }
  }

  // Technical identity collisions: two DIFFERENT source articles resolving to
  // the SAME destination node. Detected by checking whether any node was the
  // "matched" target for more than one source article id.
  const nodeIdHits = new Map<string, string[]>();
  for (const [documentId, docArticles] of articlesByDoc) {
    const engineDocId = engineDocIdBySourceId.get(documentId);
    const version = engineDocId ? versionByDocId.get(engineDocId) : undefined;
    if (!version) continue;
    const { locatorById } = assignSourceLocators(
      docArticles.map((a) => ({ id: a.id, articleNumber: a.article_number, order: a.order })),
    );
    for (const article of docArticles) {
      const expectedLocator = locatorById.get(article.id)!;
      const node = nodesByVersionAndLocator.get(`${version.id}::${expectedLocator}`);
      if (!node) continue;
      if (!nodeIdHits.has(node.id)) nodeIdHits.set(node.id, []);
      nodeIdHits.get(node.id)!.push(article.id);
    }
  }
  const duplicateSourceMappings = [...nodeIdHits.values()].filter((ids) => ids.length > 1);
  const technicalIdentityCollisions = duplicateSourceMappings.length;

  const totalDestinationNodes = allNodes.length;
  const totalSourceArticles = articles.length;

  const report = {
    generatedAt: new Date().toISOString(),
    source: { documents: articlesByDoc.size, articles: totalSourceArticles },
    destination: { legalNodes: totalDestinationNodes, documentsMatched: articlesByDoc.size - documentsNotFoundInDestination },
    identity: {
      sourceArticles: totalSourceArticles,
      distinctDestinationIdentities: totalDestinationNodes,
      missingSourceMappings: missing,
      duplicateSourceMappings: duplicateSourceMappings.length,
      technicalIdentityCollisions,
      baseArticleNumberCollisions: baseArticleNumberCollisionGroups,
    },
    contentIntegrity: { matched, missing, mismatched },
    documentsNotFoundInDestination,
    missingDetails,
    mismatchDetails,
    collisionGroupDetails,
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/post-fix-node-identity-audit.json", JSON.stringify(report, null, 2), "utf8");
  writeFileSync("reports/overnight-content-integrity.json", JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sourceDb.$disconnect();
    await engineDb.$disconnect();
  });
