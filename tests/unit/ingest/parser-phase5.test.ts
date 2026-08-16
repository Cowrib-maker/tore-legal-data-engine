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

const LAW1_PATH = path.resolve(process.cwd(), "tests/fixtures/legalinfo/law-1-implementing.html");
const PATTERNS_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/legalinfo/phase5-patterns.html",
);
const LAW1_SHA256 = "d4279175e824c8dca51631d36ab01f12c52d3e37e67e93edb3766d7951dd15c5";

describe("LegalInfo HTML parser — Phase 5 structural patterns", () => {
  const parser = new LegalInfoHtmlParser();

  it("parses archived law 1 slash-clauses and does not invent dates", async () => {
    const html = readFileSync(LAW1_PATH);
    expect(createHash("sha256").update(html).digest("hex")).toBe(LAW1_SHA256);
    const document = await parser.parse({
      html: html.toString("utf8"),
      bytes: html,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=1",
      mimeType: "text/html",
    });
    const nodes = flattenLegalNodes(document.versions[0]?.nodes ?? []);
    const locators = nodes.map((node) => node.sourceLocator);
    expect(document.title).toBe("АВЛИГЫН ЭСРЭГ ХУУЛИЙН ЗАРИМ ЗААЛТЫГ ДАГАЖ МӨРДӨХ ЖУРМЫН ТУХАЙ");
    expect(document.documentType).toBe(DocumentType.LAW);
    expect(nodes.filter((node) => node.nodeType === LegalNodeType.ARTICLE)).toHaveLength(1);
    expect(nodes.filter((node) => node.nodeType === LegalNodeType.CHAPTER)).toHaveLength(0);
    expect(nodes.filter((node) => node.nodeType === LegalNodeType.PARAGRAPH)).toHaveLength(2);
    expect(new Set(locators).size).toBe(locators.length);
    expect(assertLegalNodeHierarchy(document.versions[0]?.nodes ?? [])).toBeUndefined();
    expect(assessParseConfidence(document).ok).toBe(true);
    expect(document.versions[0]?.effectiveFrom).toBeNull();
    const byLocator = new Map(nodes.map((node) => [node.sourceLocator, node]));
    expect(byLocator.get("art-1/p-1")?.text).toContain("хөрөнгө, орлогын мэдүүлэг гаргах хугацааг");
    expect(byLocator.get("art-1/p-2")?.text).toContain("хэвлэн нийтлэх хугацааг");
    expect(nodes.some((node) => node.nodeType !== LegalNodeType.DOCUMENT && node.text === "Хэвлэх")).toBe(
      false,
    );
  });

  it("handles print chrome, ДОЛДУГААР chapters, N.M siblings, and 19^2 inserts", async () => {
    const html = readFileSync(PATTERNS_PATH);
    const document = await parser.parse({
      html: html.toString("utf8"),
      bytes: html,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=phase5",
      mimeType: "text/html",
    });
    const nodes = flattenLegalNodes(document.versions[0]?.nodes ?? []);
    const locators = nodes.map((node) => node.sourceLocator);
    const byLocator = new Map(nodes.map((node) => [node.sourceLocator, node]));

    expect(new Set(locators).size).toBe(locators.length);
    expect(assertLegalNodeHierarchy(document.versions[0]?.nodes ?? [])).toBeUndefined();
    expect(assessParseConfidence(document).ok).toBe(true);

    expect(byLocator.get("art-1/p-1")?.text.startsWith("Энэ хуулийн зорилт")).toBe(true);
    expect(byLocator.get("art-1/p-1")?.text.includes("Хэвлэх")).toBe(false);
    expect(byLocator.get("art-1/p-2")?.nodeType).toBe(LegalNodeType.PARAGRAPH);
    expect(byLocator.has("art-1/p-1/c-2")).toBe(false);

    expect(byLocator.get("art-2/p-1")?.text).toContain("эхний заалт");
    expect(byLocator.get("art-2/p-2")?.text).toContain("дараагийн заалт");

    expect(byLocator.get("ch-7")?.text).toContain("ДОЛДУГААР БҮЛЭГ");
    expect(byLocator.get("art-29^1")?.article).toBe("29^1");
    expect(byLocator.get("art-19^2")?.article).toBe("19^2");
    expect(byLocator.get("art-19^2")?.parentId).toBe(byLocator.get("ch-7")?.id);
    expect(byLocator.get("art-19^2/p-1")?.text.includes("2012")).toBe(true);
    expect(document.adoptedAt).toBeNull();
    expect(document.versions[0]?.effectiveFrom).toBeNull();
    expect(nodes.some((node) => node.text.includes("line-clamp-1"))).toBe(false);
  });
});
