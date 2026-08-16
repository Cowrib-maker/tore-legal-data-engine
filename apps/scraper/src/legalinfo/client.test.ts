import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@tore-legal-data-engine/logger";

import type { DiscoveryConfig } from "../config.js";
import { UnsafeRedirectError } from "../http/redirects.js";
import { LegalInfoClient } from "./client.js";

const logger = createLogger("scraper-test");

const config: DiscoveryConfig = {
  baseUrl: "https://legalinfo.mn",
  locale: "mn",
  minDelayMs: 1,
  maxRetries: 2,
  requestTimeoutMs: 5_000,
  userAgent: "TORE-Legal-Data-Engine/0.1",
  checkpointPath: "unused",
  isActiveFilters: ["1"],
  resume: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LegalInfoClient binary fetch", () => {
  it("returns original bytes and HTTP metadata", async () => {
    const html = Buffer.from("<!DOCTYPE html><html>эх</html>", "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ETag: '"v1"',
            "Last-Modified": "Wed, 12 Aug 2026 10:00:00 GMT",
            "Content-Length": String(html.byteLength),
          },
        }),
      ),
    );
    const client = LegalInfoClient.createUnchecked(config, logger);
    const response = await client.getBytes("/mn/detail?lawId=1");
    expect(response.status).toBe(200);
    expect(response.bytes.equals(html)).toBe(true);
    expect(response.headers.contentType).toBe("text/html; charset=utf-8");
    expect(response.headers.etag).toBe('"v1"');
    expect(response.headers.lastModified).toBe("Wed, 12 Aug 2026 10:00:00 GMT");
  });

  it("follows a same-host redirect and does not decode PDF bytes as text", async () => {
    const pdf = Buffer.from("%PDF-1.4 binary \x00\xff file", "latin1");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/mn/pdfExport")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/storage/uploads/process/file.pdf" },
        });
      }
      return new Response(pdf, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = LegalInfoClient.createUnchecked(config, logger);
    const response = await client.postFormBytes(
      "/mn/pdfExport",
      { fileid: "1" },
      "https://legalinfo.mn/mn/detail?lawId=1",
    );
    expect(response.status).toBe(200);
    expect(response.bytes.equals(pdf)).toBe(true);
    expect(response.url).toBe("https://legalinfo.mn/storage/uploads/process/file.pdf");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an off-origin redirect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/steal" },
        }),
      ),
    );
    const client = LegalInfoClient.createUnchecked(config, logger);
    await expect(client.getBytes("/mn/detail?lawId=1")).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it("returns non-2xx responses without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    const client = LegalInfoClient.createUnchecked(config, logger);
    const response = await client.getBytes("/mn/detail?lawId=missing");
    expect(response.status).toBe(404);
    expect(response.bytes.toString("utf8")).toBe("missing");
  });

  it("waits on the rate limiter between requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { status: 200 })));
    const client = LegalInfoClient.createUnchecked({ ...config, minDelayMs: 40 }, logger);
    const started = Date.now();
    await client.getBytes("/mn/detail?lawId=1");
    await client.getBytes("/mn/detail?lawId=1");
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });
});
