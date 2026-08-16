import type { LegalDocument, LegalNode } from "../../domain/entities.js";
import { LegalNodeType } from "../../domain/enums.js";
import { flattenLegalNodes } from "../../domain/services/legal-node-hierarchy.js";
import { assertLegalNodeHierarchy } from "../../domain/services/legal-node-hierarchy.js";

export type ConfidenceResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

export function assessParseConfidence(document: LegalDocument): ConfidenceResult {
  const reasons: string[] = [];
  if (!document.title || document.title.trim().length < 3 || document.title === "Untitled") {
    reasons.push("missing_title");
  }
  if (!document.documentType) {
    reasons.push("missing_act_type");
  }
  const version = document.versions[0];
  if (!version) {
    reasons.push("missing_version");
    return { ok: false, reasons };
  }
  try {
    assertLegalNodeHierarchy(version.nodes);
  } catch {
    reasons.push("broken_article_hierarchy");
  }
  const flat = flattenLegalNodes(version.nodes);
  const articles = flat.filter((node) => node.nodeType === LegalNodeType.ARTICLE);
  if (articles.length === 0) {
    reasons.push("no_recognizable_provisions");
  }
  if (flat.length < 2) {
    reasons.push("suspiciously_low_node_count");
  }
  const locators = new Set<string>();
  for (const node of flat) {
    if (locators.has(node.sourceLocator)) {
      reasons.push("duplicate_locators");
      break;
    }
    locators.add(node.sourceLocator);
  }
  if (hasMalformedNumbering(flat)) {
    reasons.push("malformed_numbering");
  }
  const provisionText = flat.filter(
    (node) => node.nodeType !== LegalNodeType.DOCUMENT && node.text.trim().length > 0,
  );
  if (provisionText.length === 0) {
    reasons.push("empty_legal_text");
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

function hasMalformedNumbering(nodes: readonly LegalNode[]): boolean {
  return nodes.some((node) => {
    if (node.nodeType === LegalNodeType.ARTICLE && (!node.article || node.article === "0")) {
      return true;
    }
    return false;
  });
}
