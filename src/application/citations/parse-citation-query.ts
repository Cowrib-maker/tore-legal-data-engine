export type ParsedCitationQuery = {
  titleHint: string | null;
  article: string | null;
  paragraph: string | null;
  locator: string | null;
};

/**
 * Deterministic citation phrase parser. Not NLP / not a model.
 * Understands patterns like "Эрүүгийн хуулийн 17.1 дүгээр зүйл".
 */
export function parseExactCitationQuery(query: string): ParsedCitationQuery {
  const normalized = query.replace(/\s+/g, " ").trim();
  const titleHint = extractTitleHint(normalized);
  const articleMatch = normalized.match(
    /(\d+)\s*(?:\.\s*(\d+))?\s*(?:дүгээр|дугаар|дэх)?\s*зүйл/i,
  );
  const dotted = normalized.match(/\b(\d+)\.(\d+)\b/);
  const article = articleMatch?.[1] ?? dotted?.[1] ?? null;
  const paragraph = articleMatch?.[2] ?? dotted?.[2] ?? null;
  const locator =
    article && paragraph
      ? `art-${article}/p-${paragraph}`
      : article
        ? `art-${article}`
        : null;
  return { titleHint, article, paragraph, locator };
}

function extractTitleHint(query: string): string | null {
  const match = query.match(/^(.+?)\s+хуулийн\b/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return null;
}

export function citationKeyForNode(lawId: string | null, locator: string): string {
  return lawId ? `${lawId}:${locator}` : locator;
}
