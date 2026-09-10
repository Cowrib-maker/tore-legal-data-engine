/**
 * READ-ONLY AUDIT — explains the 16419 vs 16404 LegalNode discrepancy.
 *
 * Only issues SELECTs against the `tore` source DB (via TORE_SOURCE_DATABASE_URL,
 * same read-only connection pattern as scripts/migrate-legacy-tore-data.ts). Never
 * touches the engine DB — no writes anywhere, on either side.
 *
 * HYPOTHESIS BEING TESTED:
 * scripts/migrate-legacy-tore-data.ts computes, for every source article:
 *   sourceLocator = `article-${article.article_number ?? article.order}`
 * and upserts a LegalNode on `@@unique([documentVersionId, sourceLocator])` with
 * `update: {}` (no-op on match). The script increments its `nodesUpserted` summary
 * counter once per article PROCESSED, regardless of whether that upsert created a
 * new row or matched an existing one. So if two articles belonging to the same
 * tore document happen to compute the SAME sourceLocator (e.g. duplicate/legacy
 * article_number values, or a null article_number colliding with another row's
 * order value), the second one silently no-ops against the first — both get
 * counted in nodesUpserted, but only one row ever exists in legalNode.
 *
 * Since documentsUpserted (1003) and legalDocumentVersion (1003) both match 1:1
 * against documentsSeen — no document- or version-level collapsing happened —
 * any deficit has to be explained at the node/locator level, which is exactly
 * what this script checks, directly against the source data.
 *
 * USAGE: npx tsx scripts/audit-node-locator-collisions.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

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
  throw new Error(
    "TORE_SOURCE_DATABASE_URL is not set (same env var the migration script uses).",
  );
}
const sourceDb = new PrismaClient({ datasourceUrl: sourceDatabaseUrl });

type ArticleRow = {
  id: string;
  document_id: string;
  article_number: string | null;
  order: number;
};

type DocRow = { id: string; title: string; source_url: string };

async function main(): Promise<void> {
  const articles = await sourceDb.$queryRawUnsafe<ArticleRow[]>(
    `SELECT id, document_id, article_number, "order"
     FROM legal_knowledge_articles
     ORDER BY document_id ASC, "order" ASC`,
  );

  const allDocs = await sourceDb.$queryRawUnsafe<DocRow[]>(
    `SELECT id, title, source_url FROM legal_knowledge_documents`,
  );
  const docById = new Map(allDocs.map((d) => [d.id, d]));

  // documentId -> locator -> rows that computed that locator
  const byDoc = new Map<string, Map<string, ArticleRow[]>>();
  for (const a of articles) {
    const locator = `article-${a.article_number ?? a.order}`;
    if (!byDoc.has(a.document_id)) byDoc.set(a.document_id, new Map());
    const locMap = byDoc.get(a.document_id)!;
    if (!locMap.has(locator)) locMap.set(locator, []);
    locMap.get(locator)!.push(a);
  }

  let totalArticles = 0;
  let collisionGroups = 0;
  let excessArticles = 0; // rows beyond the first in each colliding group — these never got their own LegalNode

  const details: Array<{
    document_id: string;
    documentTitle: string | null;
    documentSourceUrl: string | null;
    locator: string;
    count: number;
    article_ids: string[];
    article_numbers: (string | null)[];
    orders: number[];
  }> = [];

  for (const [documentId, locMap] of byDoc) {
    for (const [locator, rows] of locMap) {
      totalArticles += rows.length;
      if (rows.length > 1) {
        collisionGroups += 1;
        excessArticles += rows.length - 1;
        const doc = docById.get(documentId);
        details.push({
          document_id: documentId,
          documentTitle: doc?.title ?? null,
          documentSourceUrl: doc?.source_url ?? null,
          locator,
          count: rows.length,
          article_ids: rows.map((r) => r.id),
          article_numbers: rows.map((r) => r.article_number),
          orders: rows.map((r) => r.order),
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        totalArticlesSeen: totalArticles,
        collisionGroups,
        excessArticles,
        note:
          "excessArticles should equal 16419 - 16404 = 15 if locator collisions " +
          "within a document fully explain the discrepancy. Each `details` entry " +
          "is one document+locator where >1 source article computed the same " +
          "sourceLocator — only the first-processed (lowest `order`) article's " +
          "text ever became a LegalNode row; the rest no-op'd against it.",
        details,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sourceDb.$disconnect();
  });
