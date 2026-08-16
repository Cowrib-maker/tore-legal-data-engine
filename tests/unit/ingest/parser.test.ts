import { describe, expect, it } from "vitest";

import { LegalNodeType } from "../../../src/domain/enums.js";
import { flattenLegalNodes } from "../../../src/domain/services/legal-node-hierarchy.js";
import { LegalInfoHtmlParser } from "../../../src/parsers/legalinfo/legalinfo-html.parser.js";
import { assessParseConfidence } from "../../../src/parsers/legalinfo/confidence.js";
import { LAW_HTML_FIXTURE, MALFORMED_HTML_FIXTURE } from "../../fixtures/legalinfo/pages.js";

const NM_SIBLING_HTML = `<!DOCTYPE html>
<html>
  <head><title>N.M sibling paragraphs</title></head>
  <body>
    <div id="bordered-tab1">
      <div class="law_content">
        <p>6 дугаар зүйл.Авлигаас урьдчилан сэргийлэх үйл ажиллагаа</p>
        <p>6.1.Төрийн байгууллага дараах үүрэг хүлээнэ:</p>
        <p>6.1.1.нийтлэг үүрэг;</p>
        <p>6.6.Шаардлагыг биелүүлнэ.</p>
        <p>6.7.Тушаалыг дахин хянана.</p>
        <p>6.8.Сахилгын шийтгэл хүлээлгэнэ.</p>
        <p>6.9.Энэ хуулийн 6.6-д заасныг зөрчсөн албан тушаалтныг торгоно.</p>
      </div>
    </div>
  </body>
</html>`;

describe("LegalInfo HTML parser", () => {
  it("builds an article / paragraph / clause tree from a fixture", async () => {
    const parser = new LegalInfoHtmlParser();
    const document = await parser.parse({
      html: LAW_HTML_FIXTURE,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=1622",
      mimeType: "text/html",
    });
    expect(document.title).toContain("ЭРҮҮГИЙН");
    const nodes = flattenLegalNodes(document.versions[0]?.nodes ?? []);
    expect(nodes.some((node) => node.nodeType === LegalNodeType.ARTICLE && node.article === "1")).toBe(
      true,
    );
    expect(nodes.some((node) => node.nodeType === LegalNodeType.CLAUSE)).toBe(true);
    expect(nodes.some((node) => node.sourceLocator === "art-17")).toBe(true);
    const byLocator = new Map(nodes.map((node) => [node.sourceLocator, node]));
    expect(byLocator.get("art-1/p-1")?.nodeType).toBe(LegalNodeType.PARAGRAPH);
    expect(byLocator.get("art-1/p-1/c-1")?.nodeType).toBe(LegalNodeType.CLAUSE);
    expect(byLocator.get("art-1/p-1/c-2")?.nodeType).toBe(LegalNodeType.CLAUSE);
    expect(byLocator.get("art-1/p-1/c-1")?.parentId).toBe(byLocator.get("art-1/p-1")?.id);
    expect(assessParseConfidence(document).ok).toBe(true);
  });

  it("keeps LegalInfo N.M siblings as paragraphs after N.N, not clauses of paragraph N", async () => {
    const parser = new LegalInfoHtmlParser();
    const document = await parser.parse({
      html: NM_SIBLING_HTML,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=8928",
      mimeType: "text/html",
    });
    const nodes = flattenLegalNodes(document.versions[0]?.nodes ?? []);
    const byLocator = new Map(nodes.map((node) => [node.sourceLocator, node]));
    const article = byLocator.get("art-6");

    expect(byLocator.get("art-6/p-1/c-1")?.nodeType).toBe(LegalNodeType.CLAUSE);
    expect(byLocator.get("art-6/p-1/c-1")?.parentId).toBe(byLocator.get("art-6/p-1")?.id);

    for (const paragraph of ["6", "7", "8", "9"]) {
      const node = byLocator.get(`art-6/p-${paragraph}`);
      expect(node?.nodeType).toBe(LegalNodeType.PARAGRAPH);
      expect(node?.parentId).toBe(article?.id);
      expect(node?.article).toBe("6");
      expect(node?.paragraph).toBe(paragraph);
      expect(node?.clause).toBeNull();
    }
    expect(byLocator.get("art-6/p-6/c-7")).toBeUndefined();
    expect(byLocator.get("art-6/p-6/c-8")).toBeUndefined();
    expect(byLocator.get("art-6/p-6/c-9")).toBeUndefined();
    expect(byLocator.get("art-6/p-9")?.text).toContain("6.6-д");
    expect(assessParseConfidence(document).ok).toBe(true);
  });

  it("treats LegalInfo spaced numbering 11 .1. as paragraph 11.1, not an empty container", async () => {
    const html = `<!DOCTYPE html>
<html>
  <head><title>Spaced numbering 11 .1.</title></head>
  <body>
    <div id="bordered-tab1">
      <div class="law_content">
        <p>11 дүгээр зүйл.Тээвэрлүүлэгч, зорчигчийн эрх, үүрэг</p>
        <p>11 .1.Тээвэрлүүлэгч, зорчигч нь дараахь эрх эдэлнэ:</p>
        <p>11.1.1.тээвэрлэлтийн нөхцөл;</p>
        <p>11.2.Тээвэрлүүлэгч, зорчигч нь дараахь үүрэг хүлээнэ:</p>
      </div>
    </div>
  </body>
</html>`;
    const parser = new LegalInfoHtmlParser();
    const document = await parser.parse({
      html,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=29",
      mimeType: "text/html",
    });
    const nodes = flattenLegalNodes(document.versions[0]?.nodes ?? []);
    const byLocator = new Map(nodes.map((node) => [node.sourceLocator, node]));
    expect(byLocator.get("art-11/p-1")?.nodeType).toBe(LegalNodeType.PARAGRAPH);
    expect(byLocator.get("art-11/p-1")?.text).toContain("дараахь эрх эдэлнэ");
    expect(byLocator.get("art-11/p-1")?.text).not.toBe("");
    expect(byLocator.get("art-11/p-1/c-1")?.text).toContain("тээвэрлэлтийн нөхцөл");
    expect(byLocator.get("art-11/p-2")?.text).toContain("үүрэг хүлээнэ");
    expect(document.adoptedAt).toBeNull();
    expect(document.versions[0]?.effectiveFrom).toBeNull();
    expect(assessParseConfidence(document).ok).toBe(true);
  });

  it("rejects malformed pages that lack provisions", async () => {
    const parser = new LegalInfoHtmlParser();
    const document = await parser.parse({
      html: MALFORMED_HTML_FIXTURE,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=0",
      mimeType: "text/html",
    });
    const confidence = assessParseConfidence(document);
    expect(confidence.ok).toBe(false);
    if (!confidence.ok) {
      expect(confidence.reasons).toContain("no_recognizable_provisions");
    }
  });

  it("parses Criminal Code N.M article headings without retargeting 1.1 clauses onto article 1.1", async () => {
    const html = `<!DOCTYPE html>
<html>
  <head><title>ЭРҮҮГИЙН ХУУЛЬ</title></head>
  <body>
    <div id="bordered-tab1">
      <div class="law_content">
        <p>НЭГДҮГЭЭР БҮЛЭГ</p>
        <p>1.1 дүгээр зүйл.Хуулийн зорилго</p>
        <p>Энэ хуулийн зорилго нь гэмт хэрэгтэй тэмцэхэд оршино.</p>
        <p>1.10 дугаар зүйл.Гэмт хэргийг хөөн хэлэлцэх хугацаа</p>
        <p>1.Гэмт хэрэг үйлдсэнээс хойш дараах хугацаа өнгөрсөн бол:</p>
        <p>1.1.энэ хуулийн тусгай ангид хорих ялын дээд хэмжээг нэг жил;</p>
        <p>АРВАН НЭГДҮГЭЭР БҮЛЭГ</p>
        <p>2.1 дүгээр зүйл.Гэмт хэргийн ойлголт, шинж</p>
        <p>1.Гэмт хэрэг гэдэг нь хуульд заасан үйлдэл мөн.</p>
      </div>
    </div>
  </body>
</html>`;
    const parser = new LegalInfoHtmlParser();
    const document = await parser.parse({
      html,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=11634",
      mimeType: "text/html",
    });
    const nodes = flattenLegalNodes(document.versions[0]?.nodes ?? []);
    const byLocator = new Map(nodes.map((node) => [node.sourceLocator, node]));
    expect(byLocator.get("art-1.1")?.nodeType).toBe(LegalNodeType.ARTICLE);
    expect(byLocator.get("art-1.10")?.nodeType).toBe(LegalNodeType.ARTICLE);
    expect(byLocator.get("art-1.10/p-1")?.text).toContain("дараах хугацаа");
    expect(byLocator.get("art-1.10/p-1/c-1")?.text).toContain("хорих ялын дээд хэмжээг");
    expect(byLocator.get("art-1.1/p-1/c-1")).toBeUndefined();
    expect(byLocator.get("ch-11")?.nodeType).toBe(LegalNodeType.CHAPTER);
    expect(byLocator.get("art-2.1")?.parentId).toBe(byLocator.get("ch-11")?.id);
    expect(assessParseConfidence(document).ok).toBe(true);
  });

  it("recognizes ЗУРГААДУГААР, inserted chapter locators, and leftover text-align chrome", async () => {
    const html = `<!DOCTYPE html>
<html>
  <head><title>Chapter ordinals</title></head>
  <body>
    <div id="bordered-tab1">
      <div class="law_content">
        <p>ЗУРГААДУГААР БҮЛЭГ</p>
        <p>1 дүгээр зүйл.Нэг</p>
        <p>1.1.Текст.</p>
        <p>ДОЛДУГААР^1 БҮЛЭГ</p>
        <p>2 дугаар зүйл.Хоёр</p>
        <p>2.1.Текст.</p>
        <p>text-align:center">АРВАН ХОЁРДУГААР БҮЛЭГ</p>
        <p>3 дугаар зүйл.Гурав</p>
        <p>3.1.Текст.</p>
      </div>
    </div>
  </body>
</html>`;
    const parser = new LegalInfoHtmlParser();
    const document = await parser.parse({
      html,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=12656",
      mimeType: "text/html",
    });
    const nodes = flattenLegalNodes(document.versions[0]?.nodes ?? []);
    const byLocator = new Map(nodes.map((node) => [node.sourceLocator, node]));
    expect(byLocator.get("ch-6")?.nodeType).toBe(LegalNodeType.CHAPTER);
    expect(byLocator.get("ch-7^1")?.nodeType).toBe(LegalNodeType.CHAPTER);
    expect(byLocator.get("ch-12")?.nodeType).toBe(LegalNodeType.CHAPTER);
    expect(byLocator.get("art-3")?.parentId).toBe(byLocator.get("ch-12")?.id);
  });
});
