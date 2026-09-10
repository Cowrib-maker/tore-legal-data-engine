# TORE Legal Data Engine — Node Identity & Provenance

Status: 2026-09-10. Written after the legacy `tore` backfill (see `legal-data-migration.md`) surfaced a 15-article identity collision, root-caused, and fixed. This document records the resulting design rules so future ingestion (legacy backfill or live parsing) doesn't reintroduce the same class of bug.

## 1. Legal citation ≠ technical identity

A legal citation (`article`, `number`, `paragraph`, `clause` on `LegalNode`) is what a human or a citation-query parser (`parseExactCitationQuery`) reads and searches by. `LegalNode.sourceLocator` is a *technical* identity value: its only job is to be unique within a `documentVersionId` so `@@unique([documentVersionId, sourceLocator])` can do its work as an idempotent upsert key. Nothing in `src/application` or `src/infrastructure` parses the *contents* of `sourceLocator` (verified by repository-wide inspection before this fix was written) — every consumer treats it as an opaque string. That separation is what made this fix possible without touching citation, retrieval, or evaluation code at all: changing what a locator *contains* is safe as long as it stays unique and opaque.

Two different locator conventions coexist by design and must never be conflated:
- Live HTML-parsing ingestion (`legalinfo-html.parser.ts`) produces hierarchical locators like `art-1/p-2/c-3`.
- Legacy backfill (`migrate-legacy-tore-data.ts`) produces flat locators like `article-181` (or, since this fix, `article-181__legacyId-<id>` when disambiguated).

Both are valid, unrelated namespaces scoped per `documentVersionId` — there is no cross-pipeline collision risk.

## 2. Article number is not unique — id is

`legal_knowledge_articles` (the legacy source table) indexes `(document_id, article_number)` but never uniquely constrains it. Real Mongolian legal corpora reuse a displayed article number for genuinely distinct provisions — renumbering after amendment, footnoted insertions (`29^1`), or straightforward legacy data-entry duplication. The only field the source schema *does* guarantee unique is the row's own `id` (cuid primary key).

Rule going forward: any locator-generation logic for legacy data must be prepared for `article_number` collisions within one document and must fall back to the source row's `id` to disambiguate — never assume `article_number` (or any other human-facing reference) is a safe technical key. See `src/domain/services/legacy-article-locator.ts` for the current implementation (`assignSourceLocators`).

## 3. Historical/amended records must remain distinguishable

When a collision is genuine distinct content — not a duplicate — silently overwriting or merging one into the other in a citation-grade legal product is worse than an ugly technical locator. The fix here chooses to *preserve both* rather than pick a "winner" and discard the loser: the first (deterministically, by `order` then `id`) keeps the clean `article-N` locator; every other colliding article gets its own `article-N__legacyId-<id>` locator, with full text, hash, and provenance intact. No legal text is ever dropped to resolve a naming collision.

## 4. Provenance anchor: `EngineAuditLog`

Every migrated `LegalDocument` has a paired `EngineAuditLog` row (`actor: "migrate-legacy-tore-data"`, `action: "legacy_backfill"`, `entityType: "LegalDocument"`, `metadata.sourceLegacyId`) linking it back to the exact `legal_knowledge_documents.id` it came from. This is the auditable answer to "exactly which source record produced this data" at the document level. At the article/node level, the pairing is `(documentVersionId, sourceLocator)` deterministically derived from `(article.id, article.article_number, article.order)` — reproducible by re-running `assignSourceLocators` against the same source rows, which is exactly what `scripts/audit-post-fix-identity.ts` does to verify it.

## 5. Migration must stay idempotent and read-only on the source

Unchanged by this fix, restated because it's load-bearing for everything above: the migration only ever `SELECT`s from `tore`; every engine-side write is an `upsert` (`update: {}` on match) inside a per-document transaction. The locator fix is itself idempotent — non-colliding articles get back the exact same locator they always had, so re-running the corrected migration against an already-migrated corpus only *adds* the 15 previously-missing rows; it does not rewrite, move, or duplicate anything already committed.

## 6. Opaque locators must never reach human-facing output

`CorpusRetrieval.toAuthority()` (`src/application/legal-corpus/corpus-retrieval.ts`) is the
consumer that turns a `LegalNode` into what a citation-facing caller sees. Some legacy
articles have a null `title` in the source data (e.g. the Constitution article-19 collision
group — both colliding articles have `title: null`), so a title fallback is unavoidable. That
fallback prefers the real legal citation (`Article ${node.article}`) and only falls back to
the raw `sourceLocator` when even the article number is absent — it must never fall back to
`sourceLocator` first, because a disambiguated locator (`article-19__legacyId-<cuid>`) is
opaque technical identity, not something a human should ever read as a citation. Regression
test: `tests/unit/legal-corpus/corpus-retrieval.test.ts`.

## 7. No fabricated hierarchy

The legacy source has no sub-article structure (no paragraph/clause/subsection table or column, confirmed against both the current Prisma schema and the full raw migration DDL history for `legal_knowledge_articles`). The backfill therefore only ever creates `LegalNodeType.ARTICLE` rows, flat, with `parentId` unset. It does not — and must not — invent a PARAGRAPH/CLAUSE hierarchy that doesn't exist in the source. If deeper structure for this corpus is ever needed, it has to come from re-parsing the original archived text (a separate, larger effort, explicitly out of scope for this backfill), not from guessing structure into the migration.
