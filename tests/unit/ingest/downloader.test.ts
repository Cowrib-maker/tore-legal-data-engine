import { describe, expect, it } from "vitest";

import { IngestError } from "../../../src/domain/errors.js";
import { SafeHttpsDownloader } from "../../../src/infrastructure/http/safe-https-downloader.js";
import { detectFormat, validateSourceBytes } from "../../../src/domain/services/source-document.js";

function htmlResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

describe("SafeHttpsDownloader", () => {
  it("rejects hosts outside the LegalInfo allowlist", async () => {
    const downloader = new SafeHttpsDownloader({
      timeoutMs: 1000,
      maxBytes: 1000,
      maxRetries: 0,
      delayMs: 1,
      maxConcurrency: 1,
      userAgent: "test",
      fetchImpl: async () => htmlResponse("no"),
      resolveHost: async () => ["1.1.1.1"],
    });
    await expect(
      downloader.download({ url: "https://example.com/law" }),
    ).rejects.toMatchObject({ code: "allowlist" } satisfies Partial<IngestError>);
  });

  it("rejects non-HTTPS URLs", async () => {
    const downloader = new SafeHttpsDownloader({
      timeoutMs: 1000,
      maxBytes: 1000,
      maxRetries: 0,
      delayMs: 1,
      maxConcurrency: 1,
      userAgent: "test",
      fetchImpl: async () => htmlResponse("no"),
      resolveHost: async () => ["1.1.1.1"],
    });
    await expect(
      downloader.download({ url: "http://legalinfo.mn/mn/detail?lawId=1" }),
    ).rejects.toMatchObject({ code: "https_only" });
  });

  it("rejects redirects off the allowlist", async () => {
    const downloader = new SafeHttpsDownloader({
      timeoutMs: 1000,
      maxBytes: 1000,
      maxRetries: 0,
      delayMs: 1,
      maxConcurrency: 1,
      userAgent: "test",
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/steal" },
        }),
      resolveHost: async () => ["1.1.1.1"],
    });
    await expect(
      downloader.download({ url: "https://legalinfo.mn/mn/detail?lawId=1" }),
    ).rejects.toMatchObject({ code: "allowlist" });
  });

  it("rejects private resolved addresses (SSRF)", async () => {
    const downloader = new SafeHttpsDownloader({
      timeoutMs: 1000,
      maxBytes: 1000,
      maxRetries: 0,
      delayMs: 1,
      maxConcurrency: 1,
      userAgent: "test",
      fetchImpl: async () => htmlResponse("no"),
      resolveHost: async () => ["127.0.0.1"],
    });
    await expect(
      downloader.download({ url: "https://legalinfo.mn/mn/detail?lawId=1" }),
    ).rejects.toMatchObject({ code: "ssrf_blocked" });
  });

  it("rejects blocked content types", async () => {
    const downloader = new SafeHttpsDownloader({
      timeoutMs: 1000,
      maxBytes: 1000,
      maxRetries: 0,
      delayMs: 1,
      maxConcurrency: 1,
      userAgent: "test",
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "application/zip" },
        }),
      resolveHost: async () => ["1.1.1.1"],
    });
    await expect(
      downloader.download({ url: "https://legalinfo.mn/mn/detail?lawId=1" }),
    ).rejects.toMatchObject({ code: "content_type" });
  });

  it("validates HTML vs PDF bytes", () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html></html>");
    expect(detectFormat("text/html", html)).toBe("html");
    expect(validateSourceBytes("html", html, "text/html").ok).toBe(true);
    const pdf = new TextEncoder().encode("%PDF-1.4");
    expect(validateSourceBytes("html", pdf, "text/html").ok).toBe(false);
  });
});
