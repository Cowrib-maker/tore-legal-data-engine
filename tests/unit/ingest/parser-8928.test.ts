import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DocumentType, LegalNodeType } from "../../../src/domain/enums.js";
import {
  assertLegalNodeHierarchy,
  flattenLegalNodes,
} from "../../../src/domain/services/legal-node-hierarchy.js";
import { LegalInfoHtmlParser } from "../../../src/parsers/legalinfo/legalinfo-html.parser.js";
import { assessParseConfidence } from "../../../src/parsers/legalinfo/confidence.js";

type GoldenNode = {
  locator: string;
  type: string;
  parentLocator: string | null;
  article: string | null;
  paragraph: string | null;
  clause: string | null;
};

type GoldenFile = {
  sha256: string;
  counts: {
    nodes: number;
    articles: number;
    chapters: number;
    paragraphs: number;
    clauses: number;
    annexes: number;
  };
  nodes: GoldenNode[];
};

/**
 * Canonical structure is the corrected parse of archived lawId 8928
 * (SHA-256 9639ceb8…aa78f), scoped to `#bordered-tab1 .law_content`.
 * Numbered provisions use article.paragraph[.clause] (e.g. 1.1, 3.1.1).
 * N.M under article N is a sibling paragraph, not a clause of N.N
 * (6.7 is art-6/p-7, not art-6/p-6/c-7). Published corpus 8928 still has the
 * earlier 130/146 split until an explicit republish.
 */
const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/legalinfo/law-8928-anti-corruption.html",
);
const GOLDEN_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/legalinfo/law-8928-golden.json",
);
const EXPECTED_SHA256 =
  "9639ceb8c45c525c989a96c03fd87f09e64b849a87460f5cf0ad5a77692aa78f";

describe("LegalInfo HTML parser — archived law 8928", () => {
  const html = readFileSync(FIXTURE_PATH);
  const sha256 = createHash("sha256").update(html).digest("hex");

  it("uses the exact archived bytes that failed confidence", () => {
    expect(sha256).toBe(EXPECTED_SHA256);
  });

  it("parses title, type, hierarchy, locators, annexes, and exact text", async () => {
    const parser = new LegalInfoHtmlParser();
    const document = await parser.parse({
      html: html.toString("utf8"),
      bytes: html,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=8928",
      mimeType: "text/html",
    });
    const nodes = flattenLegalNodes(document.versions[0]?.nodes ?? []);
    const articles = nodes.filter((node) => node.nodeType === LegalNodeType.ARTICLE);
    const paragraphs = nodes.filter((node) => node.nodeType === LegalNodeType.PARAGRAPH);
    const clauses = nodes.filter((node) => node.nodeType === LegalNodeType.CLAUSE);
    const chapters = nodes.filter((node) => node.nodeType === LegalNodeType.CHAPTER);
    const annexes = nodes.filter((node) => node.nodeType === LegalNodeType.ANNEX);
    const locators = nodes.map((node) => node.sourceLocator);

    expect(document.title).toBe("АВЛИГЫН ЭСРЭГ ХУУЛЬ");
    expect(document.documentType).toBe(DocumentType.LAW);
    expect(articles).toHaveLength(37);
    expect(chapters).toHaveLength(6);
    expect(annexes).toHaveLength(0);
    expect(paragraphs.length).toBe(133);
    expect(clauses.length).toBe(143);
    expect(nodes).toHaveLength(320);

    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenFile;
    expect(golden.sha256).toBe(EXPECTED_SHA256);
    expect(golden.counts).toEqual({
      nodes: 320,
      articles: 37,
      chapters: 6,
      paragraphs: 133,
      clauses: 143,
      annexes: 0,
    });
    const byLocator = new Map(nodes.map((node) => [node.sourceLocator, node]));
    expect(golden.nodes).toHaveLength(nodes.length);
    for (const expected of golden.nodes) {
      const node = byLocator.get(expected.locator);
      expect(node, expected.locator).toBeDefined();
      expect(node?.nodeType).toBe(expected.type);
      expect(node?.article).toBe(expected.article);
      expect(node?.paragraph).toBe(expected.paragraph);
      expect(node?.clause).toBe(expected.clause);
      const parent = node?.parentId ? nodes.find((item) => item.id === node.parentId) : null;
      expect(parent?.sourceLocator ?? null).toBe(expected.parentLocator);
    }

    expect(new Set(locators).size).toBe(locators.length);
    expect(assertLegalNodeHierarchy(document.versions[0]?.nodes ?? [])).toBeUndefined();

    const articleLocators = articles.map((node) => node.sourceLocator);
    expect(articleLocators).toContain("art-1");
    expect(articleLocators).toContain("art-2^1");
    expect(articleLocators).toContain("art-32^1");
    expect(articleLocators).toContain("art-35");

    const paragraph = byLocator.get("art-1/p-1");
    const clause = byLocator.get("art-3/p-1/c-1");
    const article3 = byLocator.get("art-3");
    expect(paragraph?.parentId).toBe(byLocator.get("art-1")?.id);
    expect(clause?.parentId).toBe(byLocator.get("art-3/p-1")?.id);
    expect(byLocator.get("art-3/p-1")?.parentId).toBe(article3?.id);
    expect(article3?.parentId).toBe(byLocator.get("ch-1")?.id);
    expect(byLocator.get("ch-1")?.parentId).toBe(nodes[0]?.id);

    expect(paragraph?.text).toBe(
      "Энэ хуулийн зорилт нь авлигатай тэмцэх үйл ажиллагаа, авлигатай тэмцэх байгууллагын эрх зүйн үндсийг тодорхойлж, тэдгээртэй холбогдсон харилцааг зохицуулахад оршино.",
    );
    expect(clause?.text.startsWith("\"авлига\" гэж")).toBe(true);

    expect(byLocator.get("art-6/p-1/c-1")?.nodeType).toBe(LegalNodeType.CLAUSE);
    expect(byLocator.get("art-6/p-1/c-1")?.parentId).toBe(byLocator.get("art-6/p-1")?.id);
    expect(byLocator.get("art-6/p-6")?.nodeType).toBe(LegalNodeType.PARAGRAPH);
    expect(byLocator.get("art-6/p-6")?.parentId).toBe(byLocator.get("art-6")?.id);
    expect(byLocator.get("art-6/p-6/c-7")).toBeUndefined();
    expect(byLocator.get("art-6/p-7")?.nodeType).toBe(LegalNodeType.PARAGRAPH);
    expect(byLocator.get("art-6/p-7")?.parentId).toBe(byLocator.get("art-6")?.id);
    expect(byLocator.get("art-6/p-7")?.text).toBe(
      "Төрийн байгууллага, албан тушаалтан авлига гарах нөхцөл боломж бүрдүүлсэн гэж үзсэн тушаал, шийдвэр, журам, дүрмийг Авлигатай тэмцэх газраас өгсөн саналын дагуу дахин хянаж хүчингүй болгох буюу өөрчилнө.",
    );
    expect(byLocator.get("art-6/p-8")?.text).toBe(
      "Авлигаас урьдчилан сэргийлэх, түүнтэй тэмцэх үүргээ биелүүлээгүй албан тушаалтанд эрх бүхий албан тушаалтан сахилгын шийтгэл хүлээлгэнэ.",
    );
    expect(byLocator.get("art-6/p-9")?.text).toBe(
      "Энэ хуулийн 6.6-д заасныг зөрчсөн албан тушаалтныг шүүгч нэг сарын хөдөлмөрийн хөлсний доод хэмжээг нэгээс тав дахин нэмэгдүүлсэнтэй тэнцэх хэмжээний төгрөгөөр торгоно. /Энэ хэсэгт 2012 оны 1 дүгээр сарын 19-ний өдрийн хуулиар өөрчлөлт оруулсан/",
    );

    expect(nodes.some((node) => node.nodeType !== LegalNodeType.DOCUMENT && node.text === "Хэвлэх")).toBe(
      false,
    );
    expect(nodes.some((node) => node.text.includes("line-clamp-1"))).toBe(false);
    expect(articles.some((node) => node.text.includes("#_1_#"))).toBe(false);

    const confidence = assessParseConfidence(document);
    expect(confidence.ok).toBe(true);
  });
});
