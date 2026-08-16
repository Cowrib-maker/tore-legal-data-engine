import type { CitationCandidate, CitationVerdict } from "../entities.js";

/**
 * Deterministic citation check against the structured corpus.
 * Never calls a language model.
 */
export interface CitationValidator {
  verify(candidates: readonly CitationCandidate[]): Promise<CitationVerdict[]>;
}
