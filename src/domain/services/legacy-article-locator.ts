/**
 * Pure, deterministic locator assignment for legacy `tore` articles being
 * migrated into `LegalNode.sourceLocator`.
 *
 * WHY THIS EXISTS
 * `legal_knowledge_articles.article_number` is a human legal reference, not a
 * guaranteed-unique technical identity — the legacy schema only indexes
 * (document_id, article_number), it never uniquely constrains it. Real
 * Mongolian legal corpora reuse the same displayed article number for
 * genuinely distinct provisions (renumbering after amendment, footnoted
 * insertions, etc.), so `article-${article_number}` alone can collide within
 * one document. `LegalNode` enforces `@@unique([documentVersionId,
 * sourceLocator])`, so a colliding second article silently no-ops against the
 * first on upsert and never gets its own row.
 *
 * STRATEGY (smallest safe fix — no schema change, no source DB change)
 * - The overwhelming common case (article_number unique within its document)
 *   is untouched: locator stays exactly `article-${article_number ?? order}`,
 *   so nothing already migrated needs to move or change identity.
 * - When two or more articles in the SAME document compute the same base
 *   locator, only the first (by a fixed, DB-order-independent sort — order
 *   ASC, then id ASC as a tiebreaker) keeps the plain base locator. Every
 *   later one gets its own guaranteed-unique locator by suffixing the
 *   article's own legacy primary key: `${base}__legacyId-${id}`.
 * - `id` is the legacy row's cuid primary key — always present, always unique
 *   — so this can never collide, regardless of how messy article_number gets.
 *
 * This intentionally does NOT touch article_number/title/text or any
 * human-facing legal citation value — sourceLocator is a technical identity
 * only. Nothing in src/application or src/infrastructure parses the
 * "article-N" string to extract N (verified by inspection before writing
 * this); every consumer treats it as an opaque unique key, so this change is
 * safe for existing retrieval/citation/evaluation code paths.
 */

export type LegacyArticleForLocator = {
  id: string;
  articleNumber: string | null;
  order: number;
};

export type LocatorAssignment = {
  /** legacy article id -> assigned LegalNode.sourceLocator */
  locatorById: Map<string, string>;
  /** base locators that had more than one article competing for them */
  collisions: Array<{ baseLocator: string; articleIds: string[] }>;
};

/**
 * Assigns a sourceLocator to every article in ONE document's article list.
 * Call once per document with that document's full article set (order does
 * not matter — this sorts internally, deterministically, and never relies on
 * the order the caller's query returned rows in).
 */
export function assignSourceLocators(
  articles: readonly LegacyArticleForLocator[],
): LocatorAssignment {
  const sorted = [...articles].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const baseLocatorOf = (a: LegacyArticleForLocator): string =>
    `article-${a.articleNumber ?? a.order}`;

  // Group by base locator first, in deterministic sorted order, so "first
  // occurrence" is well-defined regardless of how the caller fetched rows.
  const groups = new Map<string, LegacyArticleForLocator[]>();
  for (const article of sorted) {
    const base = baseLocatorOf(article);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(article);
  }

  const locatorById = new Map<string, string>();
  const collisions: Array<{ baseLocator: string; articleIds: string[] }> = [];

  for (const [base, group] of groups) {
    if (group.length === 1) {
      locatorById.set(group[0]!.id, base);
      continue;
    }
    collisions.push({ baseLocator: base, articleIds: group.map((a) => a.id) });
    group.forEach((article, index) => {
      locatorById.set(
        article.id,
        index === 0 ? base : `${base}__legacyId-${article.id}`,
      );
    });
  }

  return { locatorById, collisions };
}
