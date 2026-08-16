import type { LegalDocument, LegalNode } from "../../domain/entities.js";
import { LegalNodeType } from "../../domain/enums.js";
import {
  assertLegalNodeHierarchy,
  flattenLegalNodes,
} from "../../domain/services/legal-node-hierarchy.js";
import { evaluateVersionStructure } from "../evaluation/evaluate-version.js";
import { assessParseConfidence } from "../../parsers/legalinfo/confidence.js";

const LOCATOR_RE =
  /^(doc|ch-\d+(?:\^\d+)?|art-\d+(?:\.\d+)?(?:\^\d+)?(?:\/p-\d+(?:\/c-\d+(?:\/sc-\d+)?)?)?|annex-\d+)$/;
const CHROME_ONLY_RE =
  /^(хэвлэх|pdf|word|сонсох(?:\s*\/\s*сонгосон.*)?|хуваалцах|-->)$/i;
const STRUCTURAL_TYPES = new Set<string>([
  LegalNodeType.BOOK,
  LegalNodeType.PART,
  LegalNodeType.SECTION,
]);

export type PublicationGateResult =
  | { ok: true; warnings: string[] }
  | { ok: false; reasons: string[]; warnings: string[] };

export function assessPublicationGate(input: {
  document: LegalDocument;
  archiveSha256: string;
  bytesSha256: string;
  lawId: string | null;
}): PublicationGateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const confidence = assessParseConfidence(input.document);
  if (!confidence.ok) {
    reasons.push(...confidence.reasons);
  }
  if (input.archiveSha256 !== input.bytesSha256) {
    reasons.push("archive_hash_mismatch");
  }

  const version = input.document.versions[0];
  const tree = version?.nodes ?? [];
  try {
    assertLegalNodeHierarchy(tree);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "broken_article_hierarchy");
  }

  const flat = flattenLegalNodes(tree);
  const structure = evaluateVersionStructure(
    input.document.id,
    version?.id ?? "gate",
    flat.map(({ children: _children, ...node }) => node),
  );
  if (structure.result === "FAIL") {
    if (structure.duplicateLocators.length) {
      reasons.push("duplicate_locators");
    }
    if (structure.orphans.length) {
      reasons.push("orphan_nodes");
    }
    if (structure.invalidParents.length || structure.incompatibleTypes.length) {
      reasons.push("invalid_parent_relationships");
    }
    if (structure.documentParents !== 1) {
      reasons.push("broken_article_hierarchy");
    }
  }

  const citationLocators = new Set<string>();
  for (const node of flat) {
    if (node.nodeType === LegalNodeType.DOCUMENT) {
      continue;
    }
    if (citationLocators.has(node.sourceLocator)) {
      reasons.push("duplicate_citation_locators");
      break;
    }
    citationLocators.add(node.sourceLocator);
  }

  for (const node of flat) {
    if (!LOCATOR_RE.test(node.sourceLocator)) {
      reasons.push("invented_locator");
      break;
    }
  }
  if (flat.some((node) => node.chapter === "0" || node.sourceLocator === "ch-0")) {
    reasons.push("invented_locator");
  }
  if (flat.some((node) => STRUCTURAL_TYPES.has(node.nodeType))) {
    reasons.push("invented_structural_level");
  }
  if (
    flat.some(
      (node) =>
        node.nodeType !== LegalNodeType.DOCUMENT &&
        (CHROME_ONLY_RE.test(node.text.trim()) || CHROME_ONLY_RE.test((node.title ?? "").trim())),
    )
  ) {
    reasons.push("chrome_or_toc_node");
  }

  if (version?.effectiveTo) {
    reasons.push("unsafe_effective_to");
  }

  reasons.push(...specialLawReasons(input.lawId, input.document, flat));

  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, warnings }
    : { ok: true, warnings };
}

function specialLawReasons(
  lawId: string | null,
  document: LegalDocument,
  flat: LegalNode[],
): string[] {
  const locators = new Set(flat.map((node) => node.sourceLocator));
  const has = (locator: string) => locators.has(locator);
  const articles = flat.filter((node) => node.nodeType === LegalNodeType.ARTICLE);
  const chapters = flat.filter((node) => node.nodeType === LegalNodeType.CHAPTER);
  const annexes = flat.filter((node) => node.nodeType === LegalNodeType.ANNEX);
  const parts = flat.filter((node) => node.nodeType === LegalNodeType.PART);
  const textBlob = flat.map((node) => node.text).join("\n");

  switch (lawId) {
    case "11634": {
      const failed: string[] = [];
      if (!articles.some((node) => /^\d+\.\d+/.test(node.article ?? ""))) {
        failed.push("compound_articles_missing");
      }
      if (!has("ch-11") || !has("ch-30")) {
        failed.push("chapter_11_plus_missing");
      }
      if (articles.length < 200) {
        failed.push("criminal_article_count_low");
      }
      return failed;
    }
    case "299": {
      const failed: string[] = [];
      if (!has("art-42^1")) {
        failed.push("inserted_article_42^1_missing");
      }
      if (parts.length > 0) {
        failed.push("invented_part_nodes");
      }
      return failed;
    }
    case "14403": {
      const failed: string[] = [];
      if (!flat.some((node) => node.nodeType === LegalNodeType.SUB_CLAUSE)) {
        failed.push("sub_clause_missing");
      }
      if (!flat.some((node) => /\/p-\d+\/c-\d+$/.test(node.sourceLocator))) {
        failed.push("nm_k_missing");
      }
      if (document.versions[0]?.effectiveFrom) {
        failed.push("delayed_effect_date_inferred");
      }
      if (!/2027/.test(textBlob)) {
        failed.push("delayed_effect_text_missing");
      }
      return failed;
    }
    case "216": {
      const failed: string[] = [];
      if (!has("art-44^1")) {
        failed.push("inserted_article_44^1_missing");
      }
      if (!/хүчингүй/.test(textBlob)) {
        failed.push("repeal_notes_missing");
      }
      return failed;
    }
    case "302": {
      const failed: string[] = [];
      if (!has("ch-7^1") || !has("ch-12^1")) {
        failed.push("inserted_chapters_missing");
      }
      if (!articles.some((node) => /\^/.test(node.article ?? ""))) {
        failed.push("inserted_articles_missing");
      }
      if (!/хүчингүй/.test(textBlob)) {
        failed.push("repeal_notes_missing");
      }
      return failed;
    }
    case "209": {
      const failed: string[] = [];
      if (annexes.length > 0) {
        failed.push("invented_annex_nodes");
      }
      if (parts.length > 0) {
        failed.push("invented_part_nodes");
      }
      return failed;
    }
    case "28": {
      const failed: string[] = [];
      if (chapters.length > 0) {
        failed.push("unexpected_chapters");
      }
      if (articles.length !== 9) {
        failed.push("unexpected_article_count");
      }
      if (annexes.length > 0) {
        failed.push("invented_annex_nodes");
      }
      if (
        articles.some((node) => {
          const n = Number.parseInt((node.article ?? "").split("^")[0] ?? "0", 10);
          return n > 9;
        })
      ) {
        failed.push("rate_table_became_hierarchy");
      }
      return failed;
    }
    case "218": {
      const failed: string[] = [];
      if (!has("art-8^1") && !has("art-41^1")) {
        failed.push("inserted_articles_missing");
      }
      if (flat.some((node) => /^хэвлэх\b/i.test(node.text.trim()))) {
        failed.push("chrome_or_toc_node");
      }
      return failed;
    }
    case "12656": {
      if (!has("ch-6") || !has("ch-10")) {
        return ["revised_chapter_structure_missing"];
      }
      return [];
    }
    case "11259": {
      if (parts.length > 0) {
        return ["invented_part_nodes"];
      }
      if (articles.length < 50) {
        return ["admin_article_count_low"];
      }
      return [];
    }
    default:
      return [];
  }
}
