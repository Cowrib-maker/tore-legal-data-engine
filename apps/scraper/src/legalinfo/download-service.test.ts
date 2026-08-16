import { randomUUID } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger } from "@tore-legal-data-engine/logger";
import {
  LocalBlobStore,
  RawArchive,
  type ArchiveCatalog,
  type ArchiveObject,
  type AttachArchiveInput,
} from "@tore-legal-data-engine/storage";
import { describe, expect, it } from "vitest";

import type { DownloadConfig } from "../config.js";
import { UnsafeRedirectError } from "../http/redirects.js";
import type { BinaryHttpResponse, DownloadHttpClient, DownloadedHeaders } from "./client.js";
import {
  DETAIL_PAGE_WITHOUT_PDF,
  DETAIL_PAGE_WITH_EXPORT_ONLY,
  DETAIL_PAGE_WITH_PDF_HREF,
  PDF_WRAPPER_HTML,
} from "./fixtures.js";
import { downloadOneDocument } from "./download-service.js";
import type {
  CreateCrawlResultInput,
  DownloadStore,
  DownloadTarget,
  FinishJobInput,
} from "./download-store.js";

const logger = createLogger("scraper-test");
const HTML_URL = "https://legalinfo.mn/mn/detail?lawId=1";
const PDF_URL = "https://legalinfo.mn/storage/uploads/process/202607/file_fixture.pdf";
const EXPORT_URL = "https://legalinfo.mn/mn/pdfExport";
const WRAPPED_PDF_URL = "https://legalinfo.mn/storage/uploads/process/202607/file_wrapped.pdf";
const PDF_BYTES = Buffer.from("%PDF-1.4 fixture-bytes\n%%EOF", "utf8");

const config: DownloadConfig = {
  baseUrl: "https://legalinfo.mn",
  locale: "mn",
  minDelayMs: 0,
  maxRetries: 2,
  requestTimeoutMs: 5_000,
  userAgent: "test",
  checkpointPath: "unused",
  isActiveFilters: ["1"],
  resume: false,
  lawId: "1",
};

describe("document download pipeline", () => {
  it("archives original HTML and PDF and records HTTP metadata", async () => {
    const html = Buffer.from(DETAIL_PAGE_WITH_PDF_HREF, "utf8");
    const { archive, catalog, store, blobRoot } = await setup();
    const client = new FakeClient({
      [`GET ${HTML_URL}`]: ok(html, "text/html; charset=utf-8", {
        url: HTML_URL,
        etag: '"html-1"',
        lastModified: "Wed, 12 Aug 2026 10:00:00 GMT",
      }),
      [`GET ${PDF_URL}`]: ok(PDF_BYTES, "application/pdf", { url: PDF_URL, etag: '"pdf-1"' }),
    });

    const report = await downloadOneDocument({
      config,
      logger,
      client,
      archive,
      store,
      document: target(),
    });

    expect(report.htmlArchived).toBe(true);
    expect(report.pdfArchived).toBe(true);
    expect(report.failed).toBe(0);
    expect(catalog.objects.size).toBe(2);
    expect(store.documentAvailability[0]).toMatchObject({
      htmlAvailable: true,
      pdfAvailable: true,
    });
    expect(store.crawlResults).toHaveLength(2);
    expect(store.crawlResults[0]).toMatchObject({
      url: HTML_URL,
      httpStatus: 200,
      etag: '"html-1"',
      contentType: "text/html; charset=utf-8",
    });
    expect(store.crawlResults[0]?.rawObjectId).toBeTruthy();
    expect(store.crawlResults[1]?.rawObjectId).toBeTruthy();
    expect(store.attachments[0]?.kind).toBe("html");
    expect(store.attachments[1]?.kind).toBe("pdf");
    expect(await countBlobs(blobRoot)).toBe(2);
    expect(client.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${HTML_URL}`,
      `GET ${PDF_URL}`,
    ]);
  });

  it("skips PDF when the detail page has no PDF source", async () => {
    const { archive, catalog, store } = await setup();
    const client = new FakeClient({
      [`GET ${HTML_URL}`]: ok(Buffer.from(DETAIL_PAGE_WITHOUT_PDF, "utf8"), "text/html", {
        url: HTML_URL,
      }),
    });

    const report = await downloadOneDocument({
      config,
      logger,
      client,
      archive,
      store,
      document: target(),
    });

    expect(report.htmlArchived).toBe(true);
    expect(report.pdfArchived).toBe(false);
    expect(catalog.objects.size).toBe(1);
    expect(store.documentAvailability[0]?.pdfAvailable).toBe(false);
    expect(client.calls).toHaveLength(1);
  });

  it("downloads PDF via the official pdfExport POST when only the toolbar exists", async () => {
    const { archive, store } = await setup();
    const client = new FakeClient({
      [`GET https://legalinfo.mn/mn/detail?lawId=42`]: ok(
        Buffer.from(DETAIL_PAGE_WITH_EXPORT_ONLY, "utf8"),
        "text/html",
        { url: "https://legalinfo.mn/mn/detail?lawId=42" },
      ),
      [`POST ${EXPORT_URL}`]: ok(PDF_BYTES, "application/pdf", { url: EXPORT_URL }),
    });

    const report = await downloadOneDocument({
      config: { ...config, lawId: "42" },
      logger,
      client,
      archive,
      store,
      document: target({
        externalId: "42",
        officialUrl: "https://legalinfo.mn/mn/detail?lawId=42",
      }),
    });

    expect(report.pdfArchived).toBe(true);
    expect(client.calls[1]).toEqual({ method: "POST", url: EXPORT_URL });
  });

  it("follows a PDF file URL inside an HTML export wrapper", async () => {
    const { archive, store } = await setup();
    const client = new FakeClient({
      [`GET https://legalinfo.mn/mn/detail?lawId=42`]: ok(
        Buffer.from(DETAIL_PAGE_WITH_EXPORT_ONLY, "utf8"),
        "text/html",
        { url: "https://legalinfo.mn/mn/detail?lawId=42" },
      ),
      [`POST ${EXPORT_URL}`]: ok(Buffer.from(PDF_WRAPPER_HTML, "utf8"), "text/html", {
        url: EXPORT_URL,
      }),
      [`GET ${WRAPPED_PDF_URL}`]: ok(PDF_BYTES, "application/pdf", { url: WRAPPED_PDF_URL }),
    });

    const report = await downloadOneDocument({
      config: { ...config, lawId: "42" },
      logger,
      client,
      archive,
      store,
      document: target({
        externalId: "42",
        officialUrl: "https://legalinfo.mn/mn/detail?lawId=42",
      }),
    });

    expect(report.pdfArchived).toBe(true);
    expect(client.calls.map((call) => call.url)).toContain(WRAPPED_PDF_URL);
  });

  it("records non-2xx HTML downloads and does not archive", async () => {
    const { archive, catalog, store } = await setup();
    const client = new FakeClient({
      [`GET ${HTML_URL}`]: ok(Buffer.from("not found"), "text/html", {
        url: HTML_URL,
        status: 404,
      }),
    });

    const report = await downloadOneDocument({
      config,
      logger,
      client,
      archive,
      store,
      document: target(),
    });

    expect(report.htmlArchived).toBe(false);
    expect(report.failed).toBe(1);
    expect(catalog.objects.size).toBe(0);
    expect(store.crawlResults[0]?.httpStatus).toBe(404);
    expect(store.crawlResults[0]?.rawObjectId).toBeNull();
    expect(store.finished[0]?.status).toBe("FAILED");
    expect(store.finished[0]?.errorLog).toContain("HTTP 404");
  });

  it("records MIME mismatches without archiving the body", async () => {
    const { archive, catalog, store } = await setup();
    const client = new FakeClient({
      [`GET ${HTML_URL}`]: ok(Buffer.from(DETAIL_PAGE_WITH_PDF_HREF, "utf8"), "text/html", {
        url: HTML_URL,
      }),
      [`GET ${PDF_URL}`]: ok(Buffer.from("<html>not a pdf</html>", "utf8"), "text/html", {
        url: PDF_URL,
      }),
    });

    const report = await downloadOneDocument({
      config,
      logger,
      client,
      archive,
      store,
      document: target(),
    });

    expect(report.htmlArchived).toBe(true);
    expect(report.pdfArchived).toBe(false);
    expect(report.failed).toBe(1);
    expect(catalog.objects.size).toBe(1);
    expect(store.finished[0]?.status).toBe("COMPLETED");
    expect(store.finished[0]?.errorLog).toMatch(/expected PDF/i);
  });

  it("reuses an existing content-addressed blob on re-run", async () => {
    const html = Buffer.from(DETAIL_PAGE_WITHOUT_PDF, "utf8");
    const { archive, catalog, store, blobRoot } = await setup();
    const client = new FakeClient({
      [`GET ${HTML_URL}`]: ok(html, "text/html", { url: HTML_URL }),
    });
    const document = target();

    const first = await downloadOneDocument({
      config,
      logger,
      client,
      archive,
      store,
      document,
    });
    const second = await downloadOneDocument({
      config,
      logger,
      client,
      archive,
      store,
      document,
    });

    expect(first.htmlReused).toBe(false);
    expect(second.htmlReused).toBe(true);
    expect(catalog.objects.size).toBe(1);
    expect(await countBlobs(blobRoot)).toBe(1);
  });

  it("records unsafe redirects as download failures", async () => {
    const { archive, catalog, store } = await setup();
    const client: DownloadHttpClient = {
      getBytes: async () => {
        throw new UnsafeRedirectError(HTML_URL, "https://evil.example/steal");
      },
      postFormBytes: async () => {
        throw new Error("pdf should not be requested");
      },
    };

    const report = await downloadOneDocument({
      config,
      logger,
      client,
      archive,
      store,
      document: target(),
    });

    expect(report.htmlArchived).toBe(false);
    expect(report.failed).toBe(1);
    expect(catalog.objects.size).toBe(0);
    expect(store.crawlResults[0]?.httpStatus).toBe(0);
    expect(store.finished[0]?.errorLog).toMatch(/Unsafe redirect/i);
  });
});

class FakeClient implements DownloadHttpClient {
  readonly calls: { method: string; url: string }[] = [];

  constructor(private readonly routes: Record<string, BinaryHttpResponse>) {}

  async getBytes(pathOrUrl: string): Promise<BinaryHttpResponse> {
    return this.dispatch("GET", pathOrUrl);
  }

  async postFormBytes(pathOrUrl: string): Promise<BinaryHttpResponse> {
    return this.dispatch("POST", pathOrUrl);
  }

  private dispatch(method: string, pathOrUrl: string): BinaryHttpResponse {
    const url = new URL(pathOrUrl, "https://legalinfo.mn/").toString();
    this.calls.push({ method, url });
    const response = this.routes[`${method} ${url}`];
    if (!response) {
      throw new Error(`unexpected ${method} ${url}`);
    }
    return response;
  }
}

class MemoryDownloadStore implements DownloadStore {
  readonly crawlResults: Array<
    CreateCrawlResultInput & { id: string; rawObjectId: string | null }
  > = [];
  readonly attachments: AttachArchiveInput[] = [];
  readonly documentAvailability: Record<string, unknown>[] = [];
  readonly importLogs: Record<string, unknown>[] = [];
  readonly finished: Array<FinishJobInput & { jobId: string }> = [];
  private jobs = 0;

  async findDocument(): Promise<DownloadTarget | null> {
    return null;
  }

  async createJob(): Promise<{ id: string }> {
    this.jobs += 1;
    return { id: `job-${this.jobs}` };
  }

  async createCrawlResult(input: CreateCrawlResultInput): Promise<{ id: string }> {
    const id = randomUUID();
    this.crawlResults.push({ ...input, id, rawObjectId: null });
    return { id };
  }

  async updateDocumentAvailability(
    _documentId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.documentAvailability.push(metadata);
  }

  async writeImportLog(_documentId: string, details: Record<string, unknown>): Promise<void> {
    this.importLogs.push(details);
  }

  async finishJob(jobId: string, input: FinishJobInput): Promise<void> {
    this.finished.push({ ...input, jobId });
  }

  attach(input: AttachArchiveInput): void {
    this.attachments.push(input);
    const crawl = this.crawlResults.find((row) => row.id === input.crawlResultId);
    if (crawl) {
      crawl.rawObjectId = input.object.id;
      crawl.checksum = input.object.checksum;
    }
  }
}

class RecordingCatalog implements ArchiveCatalog {
  readonly objects = new Map<string, ArchiveObject>();

  constructor(private readonly store: MemoryDownloadStore) {}

  async findByChecksum(checksum: string): Promise<ArchiveObject | null> {
    return this.objects.get(checksum) ?? null;
  }

  async create(object: Omit<ArchiveObject, "id">): Promise<ArchiveObject> {
    const existing = this.objects.get(object.checksum);
    if (existing) {
      return existing;
    }
    const created = { ...object, id: randomUUID() };
    this.objects.set(object.checksum, created);
    return created;
  }

  async attachToDocument(input: AttachArchiveInput): Promise<void> {
    this.store.attach(input);
  }
}

async function setup(): Promise<{
  archive: RawArchive;
  catalog: RecordingCatalog;
  store: MemoryDownloadStore;
  blobRoot: string;
}> {
  const blobRoot = await mkdtemp(join(tmpdir(), "tore-download-"));
  const store = new MemoryDownloadStore();
  const catalog = new RecordingCatalog(store);
  const archive = new RawArchive(new LocalBlobStore(blobRoot), catalog, logger);
  return { archive, catalog, store, blobRoot };
}

function target(overrides: Partial<DownloadTarget> = {}): DownloadTarget {
  return {
    id: randomUUID(),
    sourceId: randomUUID(),
    externalId: "1",
    officialUrl: HTML_URL,
    metadataJson: { lawId: "1" },
    ...overrides,
  };
}

function ok(
  bytes: Buffer,
  contentType: string,
  extra: Partial<DownloadedHeaders> & { url: string; status?: number },
): BinaryHttpResponse {
  return {
    status: extra.status ?? 200,
    url: extra.url,
    bytes,
    headers: {
      contentType,
      contentLength: bytes.byteLength,
      etag: extra.etag ?? null,
      lastModified: extra.lastModified ?? null,
    },
  };
}

async function countBlobs(rootDir: string): Promise<number> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        files.push(path);
      }
    }
  }
  await walk(rootDir);
  return files.length;
}
