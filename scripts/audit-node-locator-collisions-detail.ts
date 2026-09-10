/**
 * READ-ONLY, DETAILED follow-up to scripts/audit-node-locator-collisions.ts.
 *
 * Re-detects the same 11 (documentId, sourceLocator) collision groups (mirrors
 * scripts/migrate-legacy-tore-data.ts's exact locator formula:
 * `article-${article_number ?? order}`), but this time also pulls each
 * colliding article's full `title`/`text`, a SHA256 of the text (for exact
 * duplicate-vs-different detection without eyeballing long strings), and the
 * parent document's title/source_url/document_type for context.
 *
 * Only SELECTs against the `tore` source DB (TORE_SOURCE_DATABASE_URL). Never
 * touches the engine DB. No writes anywhere.
 *
 * USAGE: npx tsx scripts/audit-node-locator-collisions-detail.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  title: string | null;
  text: string;
  order: number;
};

type DocRow = {
  id: string;
  title: string;
  source_url: string;
  document_type: string | null;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Keep the report readable but don't cut off the evidence that matters: full
// text if short, otherwise head+tail with the true length recorded so identical
// vs merely similar-looking text is never ambiguous from the hash+length pair.
function previewText(text: string): { length: number; sha256: string; preview: string } {
  const len = text.length;
  const hash = sha256(text);
  if (len <= 2000) return { length: len, sha256: hash, preview: text };
  return {
    length: len,
    sha256: hash,
    preview: `${text.slice(0, 1000)}\n…[${len - 2000} chars omitted]…\n${text.slice(-1000)}`,
  };
}

async function main(): Promise<void> {
  const articles = await sourceDb.$queryRawUnsafe<ArticleRow[]>(
    `SELECT id, document_id, article_number, title, text, "order"
     FROM legal_knowledge_articles
     ORDER BY document_id ASC, "order" ASC`,
  );

  const allDocs = await sourceDb.$queryRawUnsafe<DocRow[]>(
    `SELECT id, title, source_url, document_type FROM legal_knowledge_documents`,
  );
  const docById = new Map(allDocs.map((d) => [d.id, d]));

  const byDoc = new Map<string, Map<string, ArticleRow[]>>();
  for (const a of articles) {
    const locator = `article-${a.article_number ?? a.order}`;
    if (!byDoc.has(a.document_id)) byDoc.set(a.document_id, new Map());
    const locMap = byDoc.get(a.document_id)!;
    if (!locMap.has(locator)) locMap.set(locator, []);
    locMap.get(locator)!.push(a);
  }

  const groups: Array<{
    document_id: string;
    documentTitle: string | null;
    documentSourceUrl: string | null;
    documentType: string | null;
    locator: string;
    count: number;
    // which article (by id) is the one that actually WON the upsert and has a
    // LegalNode row today: migration reads articles ORDER BY "order" ASC, so
    // within a colliding group the article with the lowest `order` is first
    // processed and creates the row; every later one in the group no-ops.
    winningArticleId: string;
    articles: Array<{
      id: string;
      article_number: string | null;
      order: number;
      title: string | null;
      textLength: number;
      textSha256: string;
      textPreview: string;
      isWinner: boolean;
    }>;
    allTextIdentical: boolean;
    allTitlesIdentical: boolean;
  }> = [];

  let excessArticles = 0;

  for (const [documentId, locMap] of byDoc) {
    for (const [locator, rows] of locMap) {
      if (rows.length <= 1) continue;
      excessArticles += rows.length - 1;
      const doc = docById.get(documentId);
      const sorted = [...rows].sort((a, b) => a.order - b.order);
      const winnerId = sorted[0]!.id;
      const withPreview = sorted.map((r) => {
        const p = previewText(r.text);
        return {
          id: r.id,
          article_number: r.article_number,
          order: r.order,
          title: r.title,
          textLength: p.length,
          textSha256: p.sha256,
          textPreview: p.preview,
          isWinner: r.id === winnerId,
        };
      });
      const hashes = new Set(withPreview.map((r) => r.textSha256));
      const titles = new Set(withPreview.map((r) => r.title ?? ""));
      groups.push({
        document_id: documentId,
        documentTitle: doc?.title ?? null,
        documentSourceUrl: doc?.source_url ?? null,
        documentType: doc?.document_type ?? null,
        locator,
        count: rows.length,
        winningArticleId: winnerId,
        articles: withPreview,
        allTextIdentical: hashes.size === 1,
        allTitlesIdentical: titles.size === 1,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        collisionGroups: groups.length,
        excessArticles,
        groups,
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
