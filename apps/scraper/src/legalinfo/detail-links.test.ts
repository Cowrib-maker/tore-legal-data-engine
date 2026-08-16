import { describe, expect, it } from "vitest";

import {
  DETAIL_PAGE_WITHOUT_PDF,
  DETAIL_PAGE_WITH_EXPORT_ONLY,
  DETAIL_PAGE_WITH_PDF_HREF,
} from "./fixtures.js";
import { extractPdfSource } from "./detail-links.js";

describe("detail PDF identification", () => {
  const pageUrl = "https://legalinfo.mn/mn/detail?lawId=1";

  it("prefers a direct .pdf file URL over the Pdf toolbar export", () => {
    expect(extractPdfSource(DETAIL_PAGE_WITH_PDF_HREF, pageUrl, "1")).toEqual({
      type: "url",
      url: "https://legalinfo.mn/storage/uploads/process/202607/file_fixture.pdf",
    });
  });

  it("uses downloadlaw('1') as the official PDF export when no file URL exists", () => {
    expect(
      extractPdfSource(DETAIL_PAGE_WITH_EXPORT_ONLY, "https://legalinfo.mn/mn/detail?lawId=42", "99"),
    ).toEqual({
      type: "export",
      lawId: "42",
    });
  });

  it("does not treat amendment type=2 links as PDFs", () => {
    expect(extractPdfSource(DETAIL_PAGE_WITHOUT_PDF, pageUrl, "1")).toBeNull();
  });
});
