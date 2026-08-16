import { describe, expect, it } from "vitest";

import { assessPublicationGate } from "../../../src/application/ingest/publication-gate.js";
import {
  DocumentStatus,
  DocumentType,
  LegalNodeType,
  VersionStatus,
} from "../../../src/domain/enums.js";
import type { LegalDocument, LegalNode } from "../../../src/domain/entities.js";
import { LegalInfoHtmlParser } from "../../../src/parsers/legalinfo/legalinfo-html.parser.js";
import { LAW_HTML_FIXTURE } from "../../fixtures/legalinfo/pages.js";

function node(partial: Partial<LegalNode> & Pick<LegalNode, "id" | "sourceLocator" | "nodeType">): LegalNode {
  return {
    documentVersionId: "v1",
    parentId: null,
    book: null,
    part: null,
    chapter: null,
    section: null,
    article: null,
    paragraph: null,
    clause: null,
    subClause: null,
    number: null,
    title: null,
    text: "legal text",
    contentHash: "h",
    children: [],
    ...partial,
  };
}

function documentOf(nodes: LegalNode[], id = "doc-1"): LegalDocument {
  return {
    id,
    sourceId: "mn.legalinfo",
    documentType: DocumentType.LAW,
    title: "TEST LAW",
    documentNumber: null,
    issuingAuthority: "State Great Khural",
    jurisdiction: "MN",
    adoptedAt: null,
    canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=28",
    status: DocumentStatus.IN_FORCE,
    versions: [
      {
        id: "v1",
        documentId: id,
        versionNumber: 1,
        effectiveFrom: null,
        effectiveTo: null,
        contentHash: "abc",
        parserId: "legalinfo-html-v1",
        status: VersionStatus.DRAFT,
        amendmentDocumentId: null,
        archiveRecordId: "arc",
        nodes,
      },
    ],
  };
}

describe("publication gate", () => {
  it("passes the LegalInfo fixture tree", async () => {
    const parser = new LegalInfoHtmlParser();
    const parsed = await parser.parse({
      html: LAW_HTML_FIXTURE,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=1622",
      mimeType: "text/html",
    });
    const hash = parsed.versions[0]?.contentHash ?? "x";
    const gate = assessPublicationGate({
      document: parsed,
      archiveSha256: hash,
      bytesSha256: hash,
      lawId: "1622",
    });
    expect(gate.ok).toBe(true);
  });

  it("rejects invented locators, chrome nodes, and archive mismatch", () => {
    const doc = node({
      id: "d",
      sourceLocator: "doc",
      nodeType: LegalNodeType.DOCUMENT,
      text: "TEST LAW",
    });
    const chrome = node({
      id: "c",
      parentId: "d",
      sourceLocator: "art-1",
      nodeType: LegalNodeType.ARTICLE,
      article: "1",
      text: "Хэвлэх",
    });
    doc.children = [chrome];
    const gate = assessPublicationGate({
      document: documentOf([doc]),
      archiveSha256: "aaa",
      bytesSha256: "bbb",
      lawId: "1622",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reasons).toContain("archive_hash_mismatch");
      expect(gate.reasons).toContain("chrome_or_toc_node");
    }
  });

  it("rejects fake PART nodes for civil-code publication", () => {
    const doc = node({
      id: "d",
      sourceLocator: "doc",
      nodeType: LegalNodeType.DOCUMENT,
      text: "ИРГЭНИЙ ХУУЛЬ",
    });
    const part = node({
      id: "p",
      parentId: "d",
      sourceLocator: "part-1",
      nodeType: LegalNodeType.PART,
      text: "I ХЭСЭГ",
    });
    doc.children = [part];
    const gate = assessPublicationGate({
      document: documentOf([doc], "civil"),
      archiveSha256: "abc",
      bytesSha256: "abc",
      lawId: "299",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reasons).toContain("invented_structural_level");
      expect(gate.reasons).toContain("invented_locator");
    }
  });

  it("does not treat legal хэвлэх эрх or Сонсох ажиллагаа as chrome", () => {
    const doc = node({
      id: "d",
      sourceLocator: "doc",
      nodeType: LegalNodeType.DOCUMENT,
      text: "TEST LAW",
    });
    const article = node({
      id: "a",
      parentId: "d",
      sourceLocator: "art-27",
      nodeType: LegalNodeType.ARTICLE,
      article: "27",
      title: "Сонсох ажиллагааг явуулах",
      text: "27 дугаар зүйл.Сонсох ажиллагааг явуулах",
    });
    const paragraph = node({
      id: "p",
      parentId: "a",
      sourceLocator: "art-66/p-2",
      nodeType: LegalNodeType.PARAGRAPH,
      article: "66",
      paragraph: "2",
      text: "intro",
    });
    const clause = node({
      id: "c",
      parentId: "p",
      sourceLocator: "art-66/p-2/c-1",
      nodeType: LegalNodeType.CLAUSE,
      article: "66",
      paragraph: "2",
      clause: "1",
      text: "хэвлэх эрх, хувьцаа болон бусад гуравдагч этгээдийн ашиглаж байгаа хөрөнгийг битүүмжлэх",
    });
    paragraph.children = [clause];
    article.children = [paragraph];
    doc.children = [article];
    const gate = assessPublicationGate({
      document: documentOf([doc]),
      archiveSha256: "abc",
      bytesSha256: "abc",
      lawId: "1622",
    });
    expect(gate.ok).toBe(true);
  });
});
