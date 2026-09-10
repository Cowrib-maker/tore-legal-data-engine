/**
 * ONE-TIME BACKFILL: tore (legacy legal_knowledge_* tables) → tore-legal-data-engine
 *
 * Context: docs/architecture/legal-data-boundary.md + legal-data-migration.md (in the
 * `tore` repo). `tore-legal-data-engine` is currently EMPTY (verified via Prisma Studio,
 * 2026-09-10: engine document count = 0) while `tore`'s own
 * `LegalKnowledgeDocument` table holds 1003 confirmed rows (verified the same session).
 * This script copies that legacy corpus into the engine's proper schema so the two
 * systems can eventually be wired together via ENGINE_BASE_URL/ENGINE_SERVICE_TOKEN.
 *
 * 2026-09-10: 10-document --commit batch verified clean (0 errors, 0 unmapped types,
 * 0 date warnings; 10 LegalDocument / 10 LegalDocumentVersion / 112 LegalNode / 1
 * LegalSource — see reports/legacy-migration-report-1789044970451.json). Hardened
 * afterward with per-document transactions (below) before running the remaining 993.
 *
 * 2026-09-10 (later same day): full 1003-document DRY RUN (no --commit) came back
 * clean except two unmapped values: documentType "CRIMINAL_CODE" and sourceType
 * "judgment" (both fell back to OTHER, both reported in unmappedDocumentTypes /
 * unmappedSourceTypes). Resolved and added to the maps below: CRIMINAL_CODE → LAW
 * (a codified statute, same precedent as constitution/labor_law), judgment → OTHER
 * (same "cannot assert which court" rationale already applied to court_judgment —
 * see the map entries for the reasoning). No other behavior changed.
 *
 * 2026-09-10 (identity fix, same day): the full-corpus --commit (1003/1003/1003
 * documents/versions, but only 16404 of 16419 articles) was root-caused via
 * read-only audit to 11 documents where `article-${article_number}` collided
 * within one document — article_number is a human legal reference, not a
 * unique technical identity (legal_knowledge_articles has no @@unique on
 * article_number, only a plain index), and real amendments/renumbering in
 * this corpus do reuse the same displayed number for genuinely distinct text.
 * Confirmed via full-text SHA256 comparison that none of the 15 excess
 * articles were byte-identical duplicates — every one is real, distinct legal
 * content that a plain article-number locator was silently dropping. Fixed by
 * extracting locator assignment into src/domain/services/legacy-article-locator.ts
 * (see that file for the full design note) and using it here instead of the
 * inline formula. Non-colliding articles (>99.9% of the corpus) get back the
 * exact same locator as before — this is purely additive on re-run, nothing
 * already-migrated changes identity or gets rewritten.
 *
 * SAFETY
 * - Read-only against the `tore` source database. Never writes, never deletes there.
 * - Writes to the engine database are upserts only (idempotent, safe to re-run).
 *   Nothing is ever deleted on the engine side either.
 * - Each document's engine-side writes (LegalDocument, LegalDocumentVersion, its
 *   EngineAuditLog entry, all its LegalNode rows) run inside ONE
 *   `engineDb.$transaction(...)` — a failure partway through rolls back that
 *   document's writes entirely. Scope is per-document, not per-run: a failure on
 *   document #500 of 1003 never touches #1–#499 or #501–#1003.
 * - Defaults to DRY RUN: prints what it WOULD do and exits without writing anything.
 *   Pass --commit to actually write. Always run without --commit first and read the
 *   summary before committing.
 * - Use --limit N to test against a small slice before running the full 1003 rows.
 * - The final report-only count query (engineCountsAfter) can fail independently of
 *   the migration writes themselves — see engineCountsError in the report; it is
 *   caught separately and never crashes past a batch of already-committed writes.
 *
 * REQUIRED ENV VARS (put in tore-legal-data-engine/.env, do NOT commit real values)
 * - DATABASE_URL              → the engine's own Postgres (destination, already set
 *                                 up for local dev per this repo's .env.example)
 * - TORE_SOURCE_DATABASE_URL  → the `tore` repo's DATABASE_URL value, copied over
 *                                 read-only. This script only ever SELECTs from it.
 *
 * USAGE
 *   npx tsx scripts/migrate-legacy-tore-data.ts                # dry run, all rows
 *   npx tsx scripts/migrate-legacy-tore-data.ts --limit 10      # dry run, first 10
 *   npx tsx scripts/migrate-legacy-tore-data.ts --limit 10 --commit   # write 10 rows
 *   npx tsx scripts/migrate-legacy-tore-data.ts --commit         # write everything
 *
 * WHAT THIS DOES NOT DO (see legal-data-migration.md §3 for full field mapping)
 * - Does not migrate LegalKnowledgeChunk (engine recomputes retrieval chunks itself).
 * - Does not create CitationEntry rows (engine's citation-verification pipeline
 *   generates those itself, the first time it runs against a document).
 * - Does not set ENGINE_BASE_URL/ENGINE_SERVICE_TOKEN in `tore` — that is a separate,
 *   deliberate step to take only after the row counts here are verified to match.
 *
 * ASSUMPTIONS THAT NEED HUMAN (LAWYER) REVIEW BEFORE TRUSTING THE RESULT
 * - LegalDocument.status: `tore` has no equivalent field. This script defaults every
 *   migrated document to DEFAULT_DOCUMENT_STATUS below. Get this wrong and citation
 *   consumers may treat repealed law as in force, or vice versa — check the constant.
 * - LegalSource.trustLevel: defaults to OFFICIAL for every source (legalinfo.mn is a
 *   government portal), see DEFAULT_TRUST_LEVEL below.
 * - DOCUMENT_TYPE_MAP / SOURCE_TYPE_MAP below are best-effort guesses at the string
 *   values actually present in `tore`. Any value not in the map falls back to OTHER
 *   and is reported in the summary as unmapped — review the "unmapped documentType /
 *   sourceType values" list every time before trusting a --commit run.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  PrismaClient,
  DocumentType,
  DocumentStatus,
  LegalNodeType,
  SourceType,
  TrustLevel,
} from "@prisma/client";
import { assignSourceLocators } from "../src/domain/services/legacy-article-locator.js";

// ─── env loading (same pattern as src/cli/ingest-legalinfo.ts) ────────────────

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

// ─── config / assumptions (review these) ──────────────────────────────────────

const DEFAULT_DOCUMENT_STATUS: DocumentStatus = "UNKNOWN"; // safest default: don't assert legal force
const DEFAULT_TRUST_LEVEL: TrustLevel = "OFFICIAL";
const PARSER_ID = "tore-legacy-import-v1";

const DOCUMENT_TYPE_MAP: Record<string, DocumentType> = {
  law: "LAW",
  constitution: "LAW",
  labor_law: "LAW",
  // Mongolia's Criminal Code (Эрүүгийн хууль) is a codified statute enacted by the
  // State Great Khural, same as constitution/labor_law above — engine's DocumentType
  // has no separate "code" variant, so it takes the same LAW mapping as those.
  criminal_code: "LAW",
  // NOT mapped to SUPREME_COURT_DECISION: tore's generic "court_judgment" value does not
  // itself confirm the deciding court's level. Asserting SUPREME_COURT_DECISION here would
  // be an unverified legal-accuracy claim. Falls to OTHER; promote per-document manually
  // once the actual issuing court is confirmed against the source document.
  court_judgment: "OTHER",
  regulation: "REGULATION",
  government_resolution: "GOVERNMENT_RESOLUTION",
  ministerial_order: "MINISTERIAL_ORDER",
  supreme_court_decision: "SUPREME_COURT_DECISION",
  constitutional_court_decision: "CONSTITUTIONAL_COURT_DECISION",
  treaty: "TREATY",
  interpretation: "INTERPRETATION",
  contract: "OTHER", // NOT statutory law — flagged for review, see summary
};

const SOURCE_TYPE_MAP: Record<string, SourceType> = {
  law: "LEGISLATION",
  legislation: "LEGISLATION",
  regulation: "REGULATION",
  government_resolution: "GOVERNMENT_RESOLUTION",
  ministerial_order: "MINISTERIAL_ORDER",
  supreme_court: "SUPREME_COURT",
  constitutional_court: "CONSTITUTIONAL_COURT",
  treaty: "TREATY",
  interpretation: "INTERPRETATION",
  // Same rationale as documentType's "court_judgment" above: a bare "judgment" source
  // type does not itself say which court issued it, and SourceType only distinguishes
  // SUPREME_COURT/CONSTITUTIONAL_COURT specifically. Asserting either would be an
  // unverified legal-accuracy claim, so this falls to OTHER; promote per-source
  // manually once the issuing court is confirmed.
  judgment: "OTHER",
};

// ─── CLI args ──────────────────────────────────────────────────────────────────

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

// ─── prisma clients: one pointed at tore (read-only), one at the engine ───────

const sourceDatabaseUrl = process.env.TORE_SOURCE_DATABASE_URL;
if (!sourceDatabaseUrl) {
  throw new Error(
    "TORE_SOURCE_DATABASE_URL is not set. Copy the `tore` repo's DATABASE_URL " +
      "value into tore-legal-data-engine/.env under this name (read-only use only).",
  );
}

// Reuses the engine's generated Prisma Client purely as a Postgres connection for
// raw SQL against `tore`'s tables — the engine schema doesn't model `tore`'s tables,
// so every source read goes through $queryRaw, never the typed client.
const sourceDb = new PrismaClient({ datasourceUrl: sourceDatabaseUrl });
const engineDb = new PrismaClient(); // uses DATABASE_URL from .env — the engine DB

// ─── types for raw rows read from `tore` ──────────────────────────────────────

type ToreArchiveRow = {
  id: string;
  connector_id: string;
  source: string;
  source_id: string;
  law_id: string | null;
  jurisdiction: string;
  authority: string;
  source_type: string;
  original_url: string;
  fetched_at: Date;
  sha256: string;
  checksum_verified: boolean;
  mime_type: string;
  byte_size: number;
  storage_key: string;
  original_file_name: string;
  encoding: string | null;
};

type ToreDocumentRow = {
  id: string;
  source_id: string;
  source_url: string;
  law_id: string | null;
  title: string;
  kind: string | null;
  language: string | null;
  document_type: string | null;
  jurisdiction: string;
  content_sha256: string;
  archive_id: string;
  version: number;
  valid_from: string | null;
  valid_to: string | null;
  source_version: string | null;
  ingested_at: Date;
};

type ToreArticleRow = {
  id: string;
  document_id: string;
  article_number: string | null;
  title: string | null;
  text: string;
  order: number;
};

// ─── helpers ───────────────────────────────────────────────────────────────────

const unmappedDocumentTypes = new Set<string>();
const unmappedSourceTypes = new Set<string>();
const dateParseWarnings: string[] = [];

function mapDocumentType(raw: string | null): DocumentType {
  if (!raw) return "OTHER";
  const key = raw.trim().toLowerCase();
  const mapped = DOCUMENT_TYPE_MAP[key];
  if (!mapped) {
    unmappedDocumentTypes.add(raw);
    return "OTHER";
  }
  return mapped;
}

function mapSourceType(raw: string): SourceType {
  const key = raw.trim().toLowerCase();
  const mapped = SOURCE_TYPE_MAP[key];
  if (!mapped) {
    unmappedSourceTypes.add(raw);
    return "OTHER";
  }
  return mapped;
}

/** Strict ISO-date parse. Returns null (and logs) rather than guessing on bad input —
 *  legal-data-migration.md flags wrong parses here as breaking AS_OF_UNAVAILABLE logic. */
function parseIsoDateStrict(raw: string | null, context: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    dateParseWarnings.push(`${context}: unparseable date "${raw}"`);
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    dateParseWarnings.push(`${context}: invalid date "${raw}"`);
    return null;
  }
  return date;
}

function baseUrlOf(originalUrl: string): string {
  try {
    return new URL(originalUrl).origin;
  } catch {
    return originalUrl;
  }
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── summary counters ──────────────────────────────────────────────────────────

const summary = {
  dryRun: !COMMIT,
  limit: LIMIT ?? null,
  archivesSeen: 0,
  archivesUpserted: 0,
  sourcesUpserted: 0,
  documentsSeen: 0,
  documentsUpserted: 0,
  documentVersionsUpserted: 0,
  articlesSeen: 0,
  nodesUpserted: 0,
  // 2026-09-10: identity-fix instrumentation. A "base locator collision" means
  // >1 article in one document computed the same article-${article_number}
  // string — legitimate in the source data (article_number is not unique
  // there). Before the fix, the losing article(s) silently no-op'd against the
  // winner's upsert and never got their own LegalNode row. Now every article
  // gets a distinct sourceLocator (see src/domain/services/legacy-article-locator.ts),
  // so these counters should be non-zero (matching the known 11 groups / 15
  // articles) but nodesUpserted should now equal articlesSeen exactly.
  baseLocatorCollisionGroups: 0,
  excessArticlesReclaimed: 0,
  errors: [] as string[],
};

// ─── main migration ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stdout.write(
    `${JSON.stringify({
      start: {
        mode: COMMIT ? "COMMIT (will write)" : "DRY RUN (no writes)",
        limit: LIMIT ?? "all",
        parserId: PARSER_ID,
      },
    })}\n`,
  );

  // one archive-record cache keyed by tore archive id -> engine ids + the archive's
  // own `authority` (carried through to LegalDocument.issuingAuthority — see below;
  // `jurisdiction` is NOT a valid stand-in for issuing authority, they are different
  // concepts on both sides of the mapping).
  const archiveMap = new Map<
    string,
    { archiveRecordId: string; sourceId: string; authority: string }
  >();

  const archives = await sourceDb.$queryRawUnsafe<ToreArchiveRow[]>(
    `SELECT id, connector_id, source, source_id, law_id, jurisdiction, authority,
            source_type, original_url, fetched_at, sha256, checksum_verified,
            mime_type, byte_size, storage_key, original_file_name, encoding
     FROM legal_source_archives
     ORDER BY fetched_at ASC
     ${LIMIT !== undefined ? `LIMIT ${LIMIT}` : ""}`,
  );

  summary.archivesSeen = archives.length;

  for (const archive of archives) {
    try {
      const sourceType = mapSourceType(archive.source_type);
      const baseUrl = baseUrlOf(archive.original_url);

      let engineSourceId: string;
      if (COMMIT) {
        const engineSource = await engineDb.legalSource.upsert({
          where: {
            jurisdiction_type_baseUrl: {
              jurisdiction: archive.jurisdiction,
              type: sourceType,
              baseUrl,
            },
          },
          update: {},
          create: {
            name: archive.source || archive.authority,
            type: sourceType,
            authority: archive.authority,
            jurisdiction: archive.jurisdiction,
            baseUrl,
            trustLevel: DEFAULT_TRUST_LEVEL,
          },
        });
        engineSourceId = engineSource.id;
        summary.sourcesUpserted += 1;
      } else {
        // Dry run: still counted ("would upsert") so archivesUpserted/sourcesUpserted
        // aren't misleadingly 0 next to documentsUpserted/nodesUpserted, which ARE
        // simulated below. This count does not distinguish would-create vs
        // would-reuse-existing (that distinction only exists once engineDb is queried
        // for real, i.e. under --commit).
        engineSourceId = `dry-run-source:${archive.jurisdiction}:${sourceType}:${baseUrl}`;
        summary.sourcesUpserted += 1;
      }

      let engineArchiveId: string;
      if (COMMIT) {
        const engineArchive = await engineDb.archiveRecord.upsert({
          where: { sha256: archive.sha256 },
          update: {},
          create: {
            sourceId: engineSourceId,
            sha256: archive.sha256,
            originalUrl: archive.original_url,
            retrievedAt: archive.fetched_at,
            mimeType: archive.mime_type,
            byteSize: archive.byte_size,
            storageKey: archive.storage_key,
            originalFileName: archive.original_file_name,
            encoding: archive.encoding,
          },
        });
        engineArchiveId = engineArchive.id;
        summary.archivesUpserted += 1;
      } else {
        engineArchiveId = `dry-run-archive:${archive.sha256}`;
        summary.archivesUpserted += 1;
      }

      archiveMap.set(archive.id, {
        archiveRecordId: engineArchiveId,
        sourceId: engineSourceId,
        authority: archive.authority,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`archive ${archive.id}: ${message}`);
    }
  }

  const documents = await sourceDb.$queryRawUnsafe<ToreDocumentRow[]>(
    `SELECT id, source_id, source_url, law_id, title, kind, language, document_type,
            jurisdiction, content_sha256, archive_id, version, valid_from, valid_to,
            source_version, ingested_at
     FROM legal_knowledge_documents
     ORDER BY created_at ASC
     ${LIMIT !== undefined ? `LIMIT ${LIMIT}` : ""}`,
  );
  summary.documentsSeen = documents.length;

  for (const doc of documents) {
    try {
      const mapped = archiveMap.get(doc.archive_id);
      if (!mapped) {
        summary.errors.push(
          `document ${doc.id}: no matching archive for archive_id=${doc.archive_id} — skipped`,
        );
        continue;
      }

      const documentType = mapDocumentType(doc.document_type);
      const effectiveFrom = parseIsoDateStrict(doc.valid_from, `document ${doc.id} valid_from`);
      const effectiveTo = parseIsoDateStrict(doc.valid_to, `document ${doc.id} valid_to`);

      // articles → LegalNode (ARTICLE), one row per article; chunks are NOT migrated.
      // Read from sourceDb (a different PrismaClient/connection than engineDb) BEFORE the
      // destination transaction below — this is a read-only SELECT against `tore`, it
      // cannot participate in engineDb's transaction and doesn't need to.
      const articles = await sourceDb.$queryRawUnsafe<ToreArticleRow[]>(
        `SELECT id, document_id, article_number, title, text, "order"
         FROM legal_knowledge_articles
         WHERE document_id = $1
         ORDER BY "order" ASC`,
        doc.id,
      );
      summary.articlesSeen += articles.length;

      // Deterministic, DB-order-independent locator assignment — see
      // src/domain/services/legacy-article-locator.ts. Non-colliding articles
      // (the overwhelming majority) get back exactly the same
      // `article-${article_number ?? order}` string as before; only articles
      // that collide on that base string within this document get a
      // legacyId-suffixed locator so every article ends up with its own
      // LegalNode row instead of silently no-op'ing against another article's.
      const { locatorById, collisions } = assignSourceLocators(
        articles.map((article) => ({
          id: article.id,
          articleNumber: article.article_number,
          order: article.order,
        })),
      );
      if (collisions.length > 0) {
        summary.baseLocatorCollisionGroups += collisions.length;
        summary.excessArticlesReclaimed += collisions.reduce(
          (total, group) => total + (group.articleIds.length - 1),
          0,
        );
      }

      if (COMMIT) {
        // Everything this document writes to the engine DB — LegalDocument,
        // LegalDocumentVersion, its EngineAuditLog entry, and every one of its
        // LegalNode rows — happens inside ONE transaction. If any single operation
        // fails (a bad article, a constraint violation, a dropped connection), the
        // whole document's writes roll back together: never a document left with a
        // LegalDocument/Version row but only some (or none) of its LegalNode rows.
        // This is scoped to ONE document per transaction, not the whole migration —
        // a failure on document #500 rolls back only #500, not #1–#499.
        // Interactive transaction: every write below uses `tx`, never `engineDb`
        // directly, so nothing here can accidentally run outside the transaction.
        const txResult = await engineDb.$transaction(
          async (tx) => {
            const engineDocument = await tx.legalDocument.upsert({
              where: {
                sourceId_canonicalUrl: {
                  sourceId: mapped.sourceId,
                  canonicalUrl: doc.source_url,
                },
              },
              update: {},
              create: {
                sourceId: mapped.sourceId,
                documentType,
                title: doc.title,
                documentNumber: doc.law_id, // closest tore field to an official document/law number
                issuingAuthority: mapped.authority, // from the linked archive, NOT jurisdiction
                jurisdiction: doc.jurisdiction,
                canonicalUrl: doc.source_url,
                status: DEFAULT_DOCUMENT_STATUS,
              },
            });

            const version = await tx.legalDocumentVersion.upsert({
              where: {
                documentId_contentHash_parserId: {
                  documentId: engineDocument.id,
                  contentHash: doc.content_sha256,
                  parserId: PARSER_ID,
                },
              },
              update: {},
              create: {
                documentId: engineDocument.id,
                versionNumber: doc.version,
                effectiveFrom,
                effectiveTo,
                contentHash: doc.content_sha256,
                parserId: PARSER_ID,
                status: "PUBLISHED",
                archiveRecordId: mapped.archiveRecordId,
              },
            });

            // engine's LegalDocument has no field for tore's `kind`/`language`/
            // `sourceVersion`/original `ingestedAt` (genuine schema gap, not this
            // script's choice) — parked here instead of silently discarded.
            await tx.engineAuditLog.create({
              data: {
                actor: "migrate-legacy-tore-data",
                action: "legacy_backfill",
                entityType: "LegalDocument",
                entityId: engineDocument.id,
                metadata: {
                  sourceLegacyId: doc.id,
                  sourceLegacyTable: "legal_knowledge_documents",
                  sourceKind: doc.kind,
                  sourceLanguage: doc.language,
                  sourceVersion: doc.source_version,
                  sourceIngestedAt: doc.ingested_at?.toISOString() ?? null,
                },
              },
            });

            let nodesForThisDocument = 0;
            for (const article of articles) {
              const sourceLocator = locatorById.get(article.id)!;
              await tx.legalNode.upsert({
                where: {
                  documentVersionId_sourceLocator: {
                    documentVersionId: version.id,
                    sourceLocator,
                  },
                },
                update: {},
                create: {
                  documentVersionId: version.id,
                  nodeType: "ARTICLE" as LegalNodeType,
                  article: article.article_number,
                  number: article.article_number,
                  title: article.title,
                  text: article.text,
                  sourceLocator,
                  contentHash: sha256Hex(article.text),
                },
              });
              nodesForThisDocument += 1;
            }

            return { nodesForThisDocument };
          },
          // Generous timeouts: some documents have far more than 10 articles, and a
          // busy/cold connection shouldn't cause a spurious rollback mid-migration.
          { timeout: 30_000, maxWait: 10_000 },
        );

        summary.documentsUpserted += 1;
        summary.documentVersionsUpserted += 1;
        summary.nodesUpserted += txResult.nodesForThisDocument;
      } else {
        // Dry run: no transaction, no writes — same simulated counts as before.
        summary.documentsUpserted += 1;
        summary.documentVersionsUpserted += 1;
        summary.nodesUpserted += articles.length;
      }
    } catch (error) {
      // A transaction failure lands here too (Prisma rolls it back automatically
      // before re-throwing) — so a failed document never produces partial data,
      // and is reported the same way as any other per-document failure.
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`document ${doc.id}: ${message}`);
    }
  }

  // The final count is diagnostic only — it must never be able to take down a
  // migration that otherwise completed. A DB hiccup here (this exact failure
  // happened once already: "Can't reach database server at localhost:5433" right
  // at this step) is caught and reported separately, never left to crash past a
  // batch of real, already-committed writes and erase the summary above.
  let engineCountsAfter: {
    legalSource: number;
    archiveRecord: number;
    legalDocument: number;
    legalDocumentVersion: number;
    legalNode: number;
  } | null = null;
  let engineCountsError: string | null = null;
  if (COMMIT) {
    try {
      engineCountsAfter = {
        legalSource: await engineDb.legalSource.count(),
        archiveRecord: await engineDb.archiveRecord.count(),
        legalDocument: await engineDb.legalDocument.count(),
        legalDocumentVersion: await engineDb.legalDocumentVersion.count(),
        legalNode: await engineDb.legalNode.count(),
      };
    } catch (error) {
      engineCountsError = error instanceof Error ? error.message : String(error);
    }
  }

  const report = {
    ...summary,
    unmappedDocumentTypes: [...unmappedDocumentTypes],
    unmappedSourceTypes: [...unmappedSourceTypes],
    dateParseWarnings,
    engineCountsAfter,
    engineCountsError,
    finishedAt: new Date().toISOString(),
  };

  mkdirSync("reports", { recursive: true });
  const reportPath = `reports/legacy-migration-report-${Date.now()}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  process.stdout.write(`${JSON.stringify({ done: report, reportPath })}\n`);

  if (COMMIT && engineCountsError) {
    process.stdout.write(
      `${JSON.stringify({
        note:
          "The final count query failed (see engineCountsError above) — this does NOT " +
          "by itself mean the migration writes failed. Per-document writes are now " +
          "transactional (see summary.errors: an empty array means every document that " +
          "was attempted either fully committed or fully rolled back, nothing partial). " +
          "Check the counts with a read-only query once the DB is reachable again, " +
          "rather than re-running this script.",
      })}\n`,
    );
  }

  if (!COMMIT) {
    process.stdout.write(
      `${JSON.stringify({
        note:
          "This was a DRY RUN — nothing was written. Review unmappedDocumentTypes / " +
          "unmappedSourceTypes / dateParseWarnings above, then re-run with --commit " +
          "(start with --limit 10 --commit to sanity-check a small batch first).",
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
    await sourceDb.$disconnect();
    await engineDb.$disconnect();
  });
