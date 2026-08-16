import { CitationStatus } from "../enums.js";
import type { CitationVerdict } from "../entities.js";

export function isAuthoritativeCitation(status: CitationStatus): boolean {
  return status === CitationStatus.VALID;
}

export function classifyCitationMatches(
  matches: readonly { documentVersionId: string; nodeId: string }[],
): CitationStatus {
  if (matches.length === 0) {
    return CitationStatus.UNRESOLVED;
  }
  const unique = new Set(
    matches.map((match) => `${match.documentVersionId}:${match.nodeId}`),
  );
  if (unique.size === 1) {
    return CitationStatus.VALID;
  }
  return CitationStatus.CONFLICT;
}

export function refuseIfNotValid(verdict: CitationVerdict): CitationVerdict {
  if (verdict.status !== CitationStatus.VALID) {
    return {
      ...verdict,
      nodeId: null,
      documentVersionId: null,
      locator: null,
    };
  }
  return verdict;
}
