import { describe, expect, it } from "vitest";

import { uniqueCategories, documentTypeForCategory } from "./catalog.js";
import { CATEGORY_INDEX_FIXTURE, LIST_PAGE_FIXTURE } from "./fixtures.js";
import {
  canonicalizeDocumentUrl,
  extractCategories,
  extractCodeValue,
  extractLawId,
  parseListHtml,
} from "./metadata.js";
describe("LegalInfo list metadata", () => {
  it("extracts metadata from index cards without fetching documents", () => {
    const documents = parseListHtml({
      html: LIST_PAGE_FIXTURE,
      categoryId: "27",
      locale: "mn",
      baseUrl: "https://legalinfo.mn",
    });

    expect(documents).toHaveLength(3);

    expect(documents[0]).toMatchObject({
      lawId: "1",
      title: "АВЛИГЫН ЭСРЭГ ХУУЛИЙН ЗАРИМ ЗААЛТЫГ ДАГАЖ МӨРДӨХ ЖУРМЫН ТУХАЙ",
      documentNumber: "Төрийн мэдээлэл эмхэтгэл: 2007 он, №9",
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=1",
      documentType: "LAW",
      status: "ACTIVE",
      language: "mn",
      htmlAvailable: true,
      pdfAvailable: false,
    });
    expect(documents[0]?.issuedDate?.toISOString()).toBe("2007-02-06T00:00:00.000Z");
    expect(documents[0]?.effectiveDate?.toISOString()).toBe("2007-02-06T00:00:00.000Z");

    expect(documents[1]).toMatchObject({
      lawId: "8928",
      status: "ARCHIVED",
      pdfAvailable: false,
      sourceUrl: "https://legalinfo.mn/mn/detail?lawId=8928",
    });

    expect(documents[2]).toMatchObject({
      lawId: "15585",
      pdfAvailable: true,
      htmlAvailable: true,
    });
  });

  it("extracts category ids from the index sidebar", () => {
    const categories = uniqueCategories(
      extractCategories(CATEGORY_INDEX_FIXTURE, "https://legalinfo.mn"),
    );
    expect(categories.map((category) => category.id)).toEqual(["26", "27", "29"]);
    expect(extractCodeValue(CATEGORY_INDEX_FIXTURE)).toBe("1");
  });

  it("maps category ids to document types", () => {
    expect(documentTypeForCategory("26")).toBe("CONSTITUTION");
    expect(documentTypeForCategory("27")).toBe("LAW");
    expect(documentTypeForCategory("31")).toBe("COURT_DECISION");
    expect(documentTypeForCategory("999")).toBe("OTHER");
  });

  it("canonicalizes document urls and law ids", () => {
    expect(extractLawId("https://legalinfo.mn/mn/detail?lawId=8928&type=2")).toBe("8928");
    expect(extractLawId("https://legalinfo.mn/mn/detail/15585")).toBe("15585");
    expect(
      canonicalizeDocumentUrl(
        "https://legalinfo.mn/mn/detail?lawId=8928&type=2",
        "https://legalinfo.mn",
        "mn",
      ),
    ).toBe("https://legalinfo.mn/mn/detail?lawId=8928");
  });
});
