import { describe, expect, it } from "vitest";

import { CitationStatus } from "../../src/domain/enums.js";
import {
  classifyCitationMatches,
  isAuthoritativeCitation,
  refuseIfNotValid,
} from "../../src/domain/services/citation-status.js";
import { UnresolvedCitationValidator } from "../../src/application/citations/unresolved-citation-validator.js";

describe("citation status", () => {
  it("treats only VALID as authoritative", () => {
    expect(isAuthoritativeCitation(CitationStatus.VALID)).toBe(true);
    expect(isAuthoritativeCitation(CitationStatus.UNRESOLVED)).toBe(false);
    expect(isAuthoritativeCitation(CitationStatus.CONFLICT)).toBe(false);
  });

  it("strips locators when the verdict is not VALID", () => {
    const stripped = refuseIfNotValid({
      query: "Art. 5",
      status: CitationStatus.UNRESOLVED,
      nodeId: "n1",
      documentVersionId: "v1",
      locator: "art-5",
      reasons: ["citation_unresolved"],
    });
    expect(stripped.nodeId).toBeNull();
    expect(stripped.locator).toBeNull();
    expect(stripped.documentVersionId).toBeNull();
  });

  it("placeholder validator returns UNRESOLVED without calling a model", async () => {
    const validator = new UnresolvedCitationValidator();
    const [verdict] = await validator.verify([{ query: "Иргэний хууль 5" }]);
    expect(verdict?.status).toBe(CitationStatus.UNRESOLVED);
    expect(verdict?.reasons).toContain("citation_index_empty");
  });

  it("classifies unique, missing, and incompatible matches", () => {
    expect(classifyCitationMatches([])).toBe(CitationStatus.UNRESOLVED);
    expect(
      classifyCitationMatches([
        { documentVersionId: "v1", nodeId: "n1" },
        { documentVersionId: "v1", nodeId: "n1" },
      ]),
    ).toBe(CitationStatus.VALID);
    expect(
      classifyCitationMatches([
        { documentVersionId: "v1", nodeId: "n1" },
        { documentVersionId: "v2", nodeId: "n2" },
      ]),
    ).toBe(CitationStatus.CONFLICT);
  });
});
