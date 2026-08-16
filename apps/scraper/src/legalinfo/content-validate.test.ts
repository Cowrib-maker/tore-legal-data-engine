import { describe, expect, it } from "vitest";

import { validateDownloadedContent } from "./content-validate.js";

describe("downloaded content validation", () => {
  it("accepts HTML by content-type or sniffing", () => {
    const html = Buffer.from("<!DOCTYPE html><html><p>хууль</p></html>", "utf8");
    expect(validateDownloadedContent("html", html, "text/html; charset=utf-8")).toEqual({
      ok: true,
      mimeType: "text/html; charset=utf-8",
    });
    expect(validateDownloadedContent("html", html, "application/octet-stream").ok).toBe(true);
  });

  it("accepts PDF by %PDF magic even when content-type is wrong", () => {
    const pdf = Buffer.from("%PDF-1.4 fixture\n%%EOF", "utf8");
    expect(validateDownloadedContent("pdf", pdf, "application/octet-stream")).toEqual({
      ok: true,
      mimeType: "application/pdf",
    });
  });

  it("rejects MIME/content mismatches", () => {
    const html = Buffer.from("<html>not a pdf</html>", "utf8");
    const pdf = Buffer.from("%PDF-1.4 no", "utf8");
    expect(validateDownloadedContent("pdf", html, "text/html").ok).toBe(false);
    expect(validateDownloadedContent("html", pdf, "application/pdf").ok).toBe(false);
    expect(validateDownloadedContent("html", Buffer.from("plain"), "text/plain").ok).toBe(false);
  });
});
