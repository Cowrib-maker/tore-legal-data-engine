import { CitationStatus } from "../../domain/enums.js";
import type {
  CitationCandidate,
  CitationVerdict,
} from "../../domain/entities.js";
import type { CitationValidator } from "../../domain/ports/citation-validator.js";
import type { CitationRepository } from "../../domain/ports/repositories.js";
import {
  classifyCitationMatches,
  refuseIfNotValid,
} from "../../domain/services/citation-status.js";
import { parseExactCitationQuery } from "./parse-citation-query.js";

/**
 * Deterministic citation check against published corpus rows.
 * Does not call a language model.
 */
export class CorpusCitationValidator implements CitationValidator {
  constructor(private readonly citations: CitationRepository) {}

  async verify(candidates: readonly CitationCandidate[]): Promise<CitationVerdict[]> {
    const results: CitationVerdict[] = [];
    for (const candidate of candidates) {
      results.push(await this.verifyOne(candidate));
    }
    return results;
  }

  private async verifyOne(candidate: CitationCandidate): Promise<CitationVerdict> {
    const parsed = parseExactCitationQuery(candidate.query);
    const matches = await this.citations.findPublishedMatches({
      query: candidate.query,
      nodeId: candidate.nodeId,
      documentId: candidate.documentId,
      locator: candidate.locator ?? parsed.locator,
      titleHint: parsed.titleHint,
      article: parsed.article,
      paragraph: parsed.paragraph,
      asOf: candidate.asOf,
    });
    const status = classifyCitationMatches(matches);
    const first = matches[0];
    const reasons =
      status === CitationStatus.UNRESOLVED
        ? candidate.asOf
          ? ["citation_unresolved", "as_of_unavailable"]
          : ["citation_unresolved"]
        : status === CitationStatus.CONFLICT
          ? ["citation_conflict"]
          : ["citation_unique"];

    return refuseIfNotValid({
      query: candidate.query,
      status,
      nodeId: first?.nodeId ?? null,
      documentVersionId: first?.documentVersionId ?? null,
      locator: first?.locator ?? null,
      reasons,
    });
  }
}
