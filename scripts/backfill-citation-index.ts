/**
 * ONE-TIME BACKFILL: populate CitationEntry rows for LegalNode rows that
 * predate citation-index population.
 *
 * WHY THIS EXISTS
 * migrate-legacy-tore-data.ts (the legacy `tore` → engine backfill, 1003
 * documents / 16419 LegalNode rows, completed 2026-09-10) deliberately did
 * NOT create CitationEntry rows — see that script's own header comment:
 * "Does not create CitationEntry rows (engine's citation-verification
 * pipeline generates those itself, the first time it runs against a
 * document)." That "citation-verification pipeline" is
 * IngestLegalInfoService.publishCitations() (src/application/ingest/
 * ingest-legalinfo.service.ts), which runs automatically on every LIVE
 * ingest publish — proven by tests/unit/ingest/pipeline.test.ts ("archives
 * by hash, publishes citations, and is idempotent"). But the legacy
 * migration never goes through IngestLegalInfoService — it writes
 * LegalNode rows directly with raw Prisma calls — so the entire migrated
 * legacy corpus has zero CitationEntry rows, and citation-key/locator-based
 * retrieval (CorpusRetrieval.lookup()'s citationKey/locator path,
 * CorpusCitationValidator) is a no-op for all 16419 of those nodes.
 *
 * WHAT THIS SCRIPT DOES
 * Mirrors publishCitations()'s exact field mapping (same citationKey
 * formula via the same citationKeyForNode() helper, same
 * locator/exactText/sourceUrl/contentHash/status fields) and applies it,
 * after the fact, to every LegalNode that doesn't already have a matching
 * CitationEntry — regardless of which pipeline created the node. This is
 * intentionally NOT limited to parserId "tore-legacy-import-v1": running it
 * against an already-fully-indexed live-ingested version is a safe,
 * detected no-op (see versionsAlreadyFullyIndexed in the report), so this
 * one script also works as a general "catch up the citation index" tool if
 * any other gap is ever found.
 *
 * SCOPE / SAFETY
 * - Engine database only (DATABASE_URL). Does NOT connect to `tore` at all —
 *   no TORE_SOURCE_DATABASE_URL needed, no source-DB read or write of any kind.
 * - Every LegalNode's own text/contentHash/sourceLocator is read as-is and
 *   copied into its CitationEntry verbatim — no legal text is invented,
 *   summarized, or modified.
 * - Idempotent: upserts on CitationEntry's own @@unique([documentVersionId,
 *   legalNodeId]) constraint. Re-running after a --commit is a no-op.
 * - Defaults to DRY RUN. Pass --commit to write. Use --limit N to sanity
 *   check a handful of versions first.
 *
 * USAGE
 *   npx tsx scripts/backfill-citation-index.ts                 # dry run, all versions
 *   npx tsx scripts/backfill-citation-index.ts --limit 5        # dry run, first 5 versions
 *   npx tsx scripts/backfill-citation-index.ts --limit 5 --commit
 *   npx tsx scripts/backfill-citation-index.ts --commit         # write everything
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient, CitationStatus } from "@prisma/client";
import { citationKeyForNode } from "../src/application/citations/parse-citation-query.js";

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

const db = new PrismaClient(); // DATABASE_URL — the engine DB. No source DB involved.

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const limitArgIndex = args.indexOf("--limit");
const LIMIT =
  limitArgIndex >= 0 && args[limitArgIndex + 1]
    ? Number.parseInt(args[limitArgIndex + 1], 10)
    : undefined;
if (LIMIT !== undefined && (!Number.isFinite(LIMIT) || LIMIT < 0)) {
  throw new Error(`--limit must be a non-negative integer, got "${args[limitArgIndex + 1]}"`);
}

/**
 * Same extraction ingest-legalinfo.service.ts's own (private, unexported)
 * lawIdFromUrl() performs: legalinfo.mn detail URLs carry the official law
 * id as a `lawId` query parameter, which is what citationKeyForNode() uses
 * to prefix the citationKey (e.g. "1622:art-17" — see
 * tests/unit/ingest/pipeline.test.ts). Falls back to the document's own
 * documentNumber field (which, for the legacy corpus, migrate-legacy-tore-
 * data.ts populated directly from tore's `law_id` column — the same
 * concept by a different name) when the URL doesn't parse or carry one.
 */
export function lawIdFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("lawId");
  } catch {
    return null;
  }
}

/**
 * lawId resolution order for a document: URL query param first, then the
 * legacy-populated documentNumber field (see lawIdFromUrl's own comment
 * above for why both exist), else null.
 */
export function resolveLawId(document: {
  canonicalUrl: string;
  documentNumber: string | null;
}): string | null {
  return lawIdFromUrl(document.canonicalUrl) ?? document.documentNumber ?? null;
}

type BackfillNode = {
  id: string;
  sourceLocator: string;
  text: string;
  contentHash: string | null;
};
type BackfillVersion = { id: string; contentHash: string };
type BackfillDocument = { canonicalUrl: string };

export function buildCitationEntryData(
  node: BackfillNode,
  version: BackfillVersion,
  document: BackfillDocument,
  lawId: string | null,
) {
  return {
    documentVersionId: version.id,
    legalNodeId: node.id,
    citationKey: citationKeyForNode(lawId, node.sourceLocator),
    locator: node.sourceLocator,
    exactText: node.text,
    sourceUrl: document.canonicalUrl,
    contentHash: node.contentHash || version.contentHash,
    status: CitationStatus.VALID,
  };
}

async function main(): Promise<void> {
  process.stdout.write(
    `${JSON.stringify({
      start: { mode: COMMIT ? "COMMIT (will write)" : "DRY RUN (no writes)", limit: LIMIT ?? "all" },
    })}\n`,
  );

  const versions = await db.legalDocumentVersion.findMany({
    include: { document: true },
    orderBy: { createdAt: "asc" },
    ...(LIMIT !== undefined ? { take: LIMIT } : {}),
  });

  const summary = {
    dryRun: !COMMIT,
    limit: LIMIT ?? null,
    versionsSeen: versions.length,
    versionsAlreadyFullyIndexed: 0,
    versionsTouched: 0,
    nodesSeen: 0,
    citationsUpserted: 0,
    errors: [] as string[],
  };

  for (const version of versions) {
    try {
      const nodes = await db.legalNode.findMany({
        where: { documentVersionId: version.id, nodeType: { not: "DOCUMENT" } },
      });
      if (nodes.length === 0) {
        continue;
      }

      const existingCount = await db.citationEntry.count({
        where: { documentVersionId: version.id },
      });
      if (existingCount === nodes.length) {
        summary.versionsAlreadyFullyIndexed += 1;
        continue;
      }

      const lawId = resolveLawId(version.document);
      let touchedThisVersion = false;

      for (const node of nodes) {
        summary.nodesSeen += 1;
        const data = buildCitationEntryData(node, version, version.document, lawId);
        if (COMMIT) {
          await db.citationEntry.upsert({
            where: {
              documentVersionId_legalNodeId: {
                documentVersionId: version.id,
                legalNodeId: node.id,
              },
            },
            create: data,
            update: data,
          });
        }
        summary.citationsUpserted += 1;
        touchedThisVersion = true;
      }
      if (touchedThisVersion) {
        summary.versionsTouched += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`version ${version.id}: ${message}`);
    }
  }

  const report = { ...summary, finishedAt: new Date().toISOString() };

  mkdirSync("reports", { recursive: true });
  const reportPath = `reports/citation-backfill-report-${Date.now()}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  process.stdout.write(`${JSON.stringify({ done: report, reportPath }, null, 2)}\n`);

  if (!COMMIT) {
    process.stdout.write(
      `${JSON.stringify({
        note:
          "This was a DRY RUN — nothing was written. Review versionsSeen/nodesSeen/" +
          "citationsUpserted above, then re-run with --commit (start with --limit 5 " +
          "--commit to sanity-check a small batch first).",
      })}\n`,
    );
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
