import type { CitationRecord, LegalNode } from "../../domain/entities.js";
import { LegalNodeType } from "../../domain/enums.js";
import { parentTypeAllowed } from "./parent-types.js";

export type FlatEvalNode = Omit<LegalNode, "children">;

export type VersionStructureReport = {
  documentId: string;
  versionId: string;
  nodes: number;
  documentParents: number;
  orphans: string[];
  cycles: string[];
  invalidParents: string[];
  wrongVersion: string[];
  incompatibleTypes: string[];
  duplicateLocators: string[];
  result: "PASS" | "FAIL";
};

export type CitationRoundTripFailure = {
  citationId: string;
  reason: string;
  locator: string;
};

export function evaluateVersionStructure(
  documentId: string,
  versionId: string,
  nodes: readonly FlatEvalNode[],
): VersionStructureReport {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const orphans: string[] = [];
  const invalidParents: string[] = [];
  const wrongVersion: string[] = [];
  const incompatibleTypes: string[] = [];
  const seenLocators = new Map<string, string>();
  const duplicateLocators: string[] = [];
  let documentParents = 0;

  for (const node of nodes) {
    if (node.documentVersionId !== versionId) {
      wrongVersion.push(node.sourceLocator);
    }
    if (node.nodeType === LegalNodeType.DOCUMENT && node.parentId === null) {
      documentParents += 1;
    }
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (!parent) {
        orphans.push(node.sourceLocator);
        invalidParents.push(node.sourceLocator);
      } else if (!parentTypeAllowed(node.nodeType, parent.nodeType)) {
        incompatibleTypes.push(node.sourceLocator);
      }
    } else if (!parentTypeAllowed(node.nodeType, null)) {
      invalidParents.push(node.sourceLocator);
    }
    const previous = seenLocators.get(node.sourceLocator);
    if (previous) {
      duplicateLocators.push(node.sourceLocator);
    } else {
      seenLocators.set(node.sourceLocator, node.id);
    }
  }

  const cycles = detectCycles(nodes, byId);
  const result =
    documentParents === 1 &&
    orphans.length === 0 &&
    cycles.length === 0 &&
    invalidParents.length === 0 &&
    wrongVersion.length === 0 &&
    incompatibleTypes.length === 0 &&
    duplicateLocators.length === 0
      ? "PASS"
      : "FAIL";

  return {
    documentId,
    versionId,
    nodes: nodes.length,
    documentParents,
    orphans,
    cycles,
    invalidParents,
    wrongVersion,
    incompatibleTypes,
    duplicateLocators,
    result,
  };
}

export function evaluateCitationRoundTrip(
  nodes: readonly FlatEvalNode[],
  citations: readonly CitationRecord[],
): { failures: CitationRoundTripFailure[]; ok: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const failures: CitationRoundTripFailure[] = [];
  for (const citation of citations) {
    const node = byId.get(citation.legalNodeId);
    if (!node) {
      failures.push({
        citationId: citation.id,
        reason: "missing_node",
        locator: citation.locator,
      });
      continue;
    }
    if (node.sourceLocator !== citation.locator) {
      failures.push({
        citationId: citation.id,
        reason: "locator_mismatch",
        locator: citation.locator,
      });
    }
    if (node.documentVersionId !== citation.documentVersionId) {
      failures.push({
        citationId: citation.id,
        reason: "version_mismatch",
        locator: citation.locator,
      });
    }
    if (expectsLegalText(node.nodeType) && !node.text.trim()) {
      failures.push({
        citationId: citation.id,
        reason: "empty_source_text",
        locator: citation.locator,
      });
    }
    if (!citation.exactText.trim()) {
      failures.push({
        citationId: citation.id,
        reason: "empty_citation_text",
        locator: citation.locator,
      });
    }
    if (!citation.contentHash.trim() || !node.contentHash.trim()) {
      failures.push({
        citationId: citation.id,
        reason: "missing_content_hash",
        locator: citation.locator,
      });
    }
  }
  return { failures, ok: citations.length - new Set(failures.map((item) => item.citationId)).size };
}

function expectsLegalText(type: LegalNode["nodeType"]): boolean {
  return (
    type === LegalNodeType.ARTICLE ||
    type === LegalNodeType.PARAGRAPH ||
    type === LegalNodeType.CLAUSE ||
    type === LegalNodeType.SUB_CLAUSE
  );
}

function detectCycles(
  nodes: readonly FlatEvalNode[],
  byId: Map<string, FlatEvalNode>,
): string[] {
  const cycles: string[] = [];
  for (const node of nodes) {
    const seen = new Set<string>();
    let current: FlatEvalNode | undefined = node;
    while (current?.parentId) {
      if (seen.has(current.id)) {
        cycles.push(node.sourceLocator);
        break;
      }
      seen.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  return [...new Set(cycles)];
}
