import { CitationStatus } from "../../domain/enums.js";
import type { CitationCandidate, CitationVerdict } from "../../domain/entities.js";
import type { CitationValidator } from "../../domain/ports/citation-validator.js";

/**
 * Phase 1 placeholder: the corpus is empty, so no citation is VALID.
 * Does not call an LLM.
 */
export class UnresolvedCitationValidator implements CitationValidator {
  async verify(candidates: readonly CitationCandidate[]): Promise<CitationVerdict[]> {
    return candidates.map((candidate) => ({
      query: candidate.query,
      status: CitationStatus.UNRESOLVED,
      nodeId: null,
      documentVersionId: null,
      locator: null,
      reasons: ["citation_index_empty"],
    }));
  }
}
