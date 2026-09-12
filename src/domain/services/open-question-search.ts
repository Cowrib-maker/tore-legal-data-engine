import { versionCoversInstant } from "./document-version.js";
import type { LegalNodeSearchCandidate } from "../entities.js";

/** SQL LIMIT for open-question candidate retrieval. Small and deliberate:
 * this is a source list for a legal-grounding pipeline, not a search results page. */
export const MAX_OPEN_QUESTION_CANDIDATES = 20;

/** Same whitespace normalization already used for exact-citation queries. */
export function normalizeOpenQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

/**
 * Applies asOf interval containment (reusing the same versionCoversInstant
 * rule as exact-citation retrieval — never guesses when bounds are
 * incomplete) and deduplicates by (documentId, sourceLocator), keeping the
 * first (highest-ranked, since candidates arrive pre-sorted by score) hit
 * per provision.
 */
export function filterAndDedupeCandidates(
  candidates: readonly LegalNodeSearchCandidate[],
  asOf: string | null,
): LegalNodeSearchCandidate[] {
  const seen = new Set<string>();
  const out: LegalNodeSearchCandidate[] = [];
  for (const candidate of candidates) {
    if (
      asOf &&
      !versionCoversInstant(
        {
          effectiveFrom: candidate.effectiveFrom,
          effectiveTo: candidate.effectiveTo,
          status: candidate.versionStatus,
        },
        asOf,
      )
    ) {
      continue;
    }
    const key = `${candidate.documentId}:${candidate.node.sourceLocator}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(candidate);
  }
  return out;
}
