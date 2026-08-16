import { describe, expect, it } from "vitest";

import {
  UnsafeRedirectError,
  allowedRedirectHost,
  resolveSafeRedirect,
} from "./redirects.js";

describe("safe redirects", () => {
  it("allows same-host and LegalInfo subdomain hops", () => {
    expect(
      resolveSafeRedirect({
        fromUrl: "https://legalinfo.mn/mn/pdfExport",
        location: "/storage/uploads/process/202607/file_fixture.pdf",
        originHostname: "legalinfo.mn",
      }),
    ).toBe("https://legalinfo.mn/storage/uploads/process/202607/file_fixture.pdf");
    expect(allowedRedirectHost("storage.legalinfo.mn", "legalinfo.mn")).toBe(true);
  });

  it("rejects missing Location, non-http schemes, and off-origin hosts", () => {
    expect(() =>
      resolveSafeRedirect({
        fromUrl: "https://legalinfo.mn/mn/detail?lawId=1",
        location: null,
        originHostname: "legalinfo.mn",
      }),
    ).toThrow(UnsafeRedirectError);

    expect(() =>
      resolveSafeRedirect({
        fromUrl: "https://legalinfo.mn/mn/detail?lawId=1",
        location: "file:///etc/passwd",
        originHostname: "legalinfo.mn",
      }),
    ).toThrow(UnsafeRedirectError);

    expect(() =>
      resolveSafeRedirect({
        fromUrl: "https://legalinfo.mn/mn/detail?lawId=1",
        location: "https://evil.example/steal",
        originHostname: "legalinfo.mn",
      }),
    ).toThrow(UnsafeRedirectError);
  });
});
