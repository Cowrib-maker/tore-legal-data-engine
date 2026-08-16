import { disconnectPrisma, getPrisma } from "@tore-legal-data-engine/db";
import type { Logger } from "@tore-legal-data-engine/logger";
import { createRawArchiveFromEnv, type RawArchive } from "@tore-legal-data-engine/storage";

import type { DownloadConfig } from "../config.js";
import { UnsafeRedirectError } from "../http/redirects.js";
import { HttpError } from "../http/retry.js";
import {
  type BinaryHttpResponse,
  type DownloadHttpClient,
  LegalInfoClient,
  RobotsDisallowError,
} from "./client.js";
import { looksLikeHtml, validateDownloadedContent } from "./content-validate.js";
import {
  extractPdfFileUrl,
  extractPdfSource,
  pdfExportFields,
  pdfExportPath,
  type PdfDownloadTarget,
} from "./detail-links.js";
import { PrismaDownloadStore, type DownloadStore, type DownloadTarget } from "./download-store.js";
import { ensureLegalInfoSource } from "./persist.js";

export type DownloadReport = {
  jobId: string;
  documentId: string;
  lawId: string;
  downloaded: number;
  failed: number;
  htmlArchived: boolean;
  pdfArchived: boolean;
  htmlReused: boolean;
  pdfReused: boolean;
};

export async function runDownload(config: DownloadConfig, logger: Logger): Promise<DownloadReport> {
  const prisma = getPrisma();
  try {
    const source = await ensureLegalInfoSource();
    const store = new PrismaDownloadStore(prisma);
    const document = await store.findDocument({
      sourceId: source.id,
      lawId: config.lawId,
      documentId: config.documentId,
    });
    if (!document) {
      throw new Error(
        "No discovered LegalInfo document matched the download request. Run discover first.",
      );
    }
    const client = await LegalInfoClient.create(config, logger);
    const archive = createRawArchiveFromEnv(logger);
    return await downloadOneDocument({ config, logger, client, archive, store, document });
  } finally {
    await disconnectPrisma();
  }
}

export async function downloadOneDocument(params: {
  config: DownloadConfig;
  logger: Logger;
  client: DownloadHttpClient;
  archive: RawArchive;
  store: DownloadStore;
  document: DownloadTarget;
}): Promise<DownloadReport> {
  const { config, logger, client, archive, store, document } = params;
  const job = await store.createJob(document.sourceId);
  const htmlUrl =
    document.officialUrl ??
    `${config.baseUrl}/${config.locale}/detail?lawId=${encodeURIComponent(document.externalId)}`;
  const failures: string[] = [];
  let downloaded = 0;
  let failed = 0;
  let htmlArchived = false;
  let pdfArchived = false;
  let htmlReused = false;
  let pdfReused = false;
  let htmlAvailable = false;
  let pdfAvailable = false;
  let htmlChecksum: string | undefined;
  let pdfChecksum: string | undefined;

  logger.info(
    {
      event: "download.start",
      jobId: job.id,
      documentId: document.id,
      lawId: document.externalId,
      url: htmlUrl,
    },
    "starting LegalInfo document download",
  );

  try {
    const html = await downloadAndArchive({
      kind: "html",
      url: htmlUrl,
      fetch: () => client.getBytes(htmlUrl),
      document,
      jobId: job.id,
      store,
      archive,
      logger,
    });
    downloaded += html.archived ? 1 : 0;
    failed += html.failed ? 1 : 0;
    if (html.failure) {
      failures.push(html.failure);
    }
    htmlArchived = html.archived;
    htmlReused = html.reused;
    htmlAvailable = html.archived;
    htmlChecksum = html.checksum;

    const pdfSource =
      html.response && html.archived
        ? extractPdfSource(
            html.response.bytes.toString("utf8"),
            html.response.url,
            document.externalId,
          )
        : null;

    if (pdfSource) {
      const pdf = await downloadAndArchive({
        kind: "pdf",
        url: pdfUrlForLog(pdfSource, config),
        fetch: () => fetchPdf(client, config, pdfSource, html.response?.url ?? htmlUrl),
        document,
        jobId: job.id,
        store,
        archive,
        logger,
      });
      downloaded += pdf.archived ? 1 : 0;
      failed += pdf.failed ? 1 : 0;
      if (pdf.failure) {
        failures.push(pdf.failure);
      }
      pdfArchived = pdf.archived;
      pdfReused = pdf.reused;
      pdfAvailable = pdf.archived;
      pdfChecksum = pdf.checksum;
    } else {
      logger.info(
        {
          event: "download.pdf",
          jobId: job.id,
          documentId: document.id,
          lawId: document.externalId,
          skipped: true,
        },
        "no PDF available on detail page",
      );
    }

    if (htmlArchived) {
      await store.updateDocumentAvailability(document.id, {
        ...document.metadataJson,
        htmlAvailable,
        pdfAvailable,
      });
      await store.writeImportLog(document.id, {
        sourceUrl: htmlUrl,
        htmlChecksum: htmlChecksum ?? null,
        pdfChecksum: pdfChecksum ?? null,
        htmlReused,
        pdfReused,
        htmlArchived,
        pdfArchived,
      });
    }

    const status = htmlArchived ? "COMPLETED" : "FAILED";
    await store.finishJob(job.id, {
      status,
      totalFound: 1,
      totalDownloaded: downloaded,
      totalFailed: failed,
      errorLog: failures.length ? failures.join("\n") : null,
    });
    logger.info(
      {
        event: "download.completed",
        jobId: job.id,
        documentId: document.id,
        lawId: document.externalId,
        downloaded,
        failed,
        htmlArchived,
        pdfArchived,
        htmlReused,
        pdfReused,
        status,
      },
      "LegalInfo document download finished",
    );
    return {
      jobId: job.id,
      documentId: document.id,
      lawId: document.externalId,
      downloaded,
      failed,
      htmlArchived,
      pdfArchived,
      htmlReused,
      pdfReused,
    };
  } catch (error) {
    failed += 1;
    const reason = formatError(error);
    failures.push(reason);
    logger.error(
      {
        event: "download.failed",
        jobId: job.id,
        documentId: document.id,
        lawId: document.externalId,
        err: error,
      },
      "document download failed",
    );
    await store.finishJob(job.id, {
      status: "FAILED",
      totalFound: 1,
      totalDownloaded: downloaded,
      totalFailed: failed,
      errorLog: failures.join("\n"),
    });
    throw error;
  }
}

async function downloadAndArchive(params: {
  kind: "html" | "pdf";
  url: string;
  fetch: () => Promise<BinaryHttpResponse>;
  document: DownloadTarget;
  jobId: string;
  store: DownloadStore;
  archive: RawArchive;
  logger: Logger;
}): Promise<{
  archived: boolean;
  failed: boolean;
  reused: boolean;
  checksum?: string;
  failure?: string;
  response?: BinaryHttpResponse;
}> {
  let response: BinaryHttpResponse | undefined;
  try {
    response = await params.fetch();
  } catch (error) {
    const failure = formatError(error);
    await params.store.createCrawlResult({
      crawlJobId: params.jobId,
      documentId: params.document.id,
      url: params.url,
      httpStatus: statusFromError(error),
    });
    params.logger.error(
      {
        event: "download.failed",
        kind: params.kind,
        jobId: params.jobId,
        documentId: params.document.id,
        lawId: params.document.externalId,
        url: params.url,
        reason: failure,
      },
      `${params.kind} download failed`,
    );
    return { archived: false, failed: true, reused: false, failure };
  }

  const crawl = await params.store.createCrawlResult({
    crawlJobId: params.jobId,
    documentId: params.document.id,
    url: response.url,
    httpStatus: response.status,
    etag: response.headers.etag,
    lastModified: parseLastModified(response.headers.lastModified),
    contentType: response.headers.contentType,
    contentLength: BigInt(response.bytes.byteLength),
  });

  if (response.status < 200 || response.status >= 300) {
    const failure = `HTTP ${response.status} for ${response.url}`;
    params.logger.error(
      {
        event: "download.failed",
        kind: params.kind,
        jobId: params.jobId,
        documentId: params.document.id,
        lawId: params.document.externalId,
        url: response.url,
        httpStatus: response.status,
        contentType: response.headers.contentType,
        etag: response.headers.etag,
        lastModified: response.headers.lastModified,
        contentLength: response.bytes.byteLength,
        reason: failure,
      },
      `${params.kind} download failed`,
    );
    return { archived: false, failed: true, reused: false, failure, response };
  }

  const validation = validateDownloadedContent(
    params.kind,
    response.bytes,
    response.headers.contentType,
  );
  if (!validation.ok) {
    params.logger.error(
      {
        event: "download.failed",
        kind: params.kind,
        jobId: params.jobId,
        documentId: params.document.id,
        lawId: params.document.externalId,
        url: response.url,
        httpStatus: response.status,
        contentType: response.headers.contentType,
        reason: validation.reason,
      },
      `${params.kind} content validation failed`,
    );
    return {
      archived: false,
      failed: true,
      reused: false,
      failure: validation.reason,
      response,
    };
  }

  const archived = await params.archive.archive({
    documentId: params.document.id,
    kind: params.kind,
    bytes: response.bytes,
    mimeType: validation.mimeType,
    crawlResultId: crawl.id,
  });
  params.logger.info(
    {
      event: params.kind === "html" ? "download.html" : "download.pdf",
      jobId: params.jobId,
      documentId: params.document.id,
      lawId: params.document.externalId,
      url: response.url,
      httpStatus: response.status,
      contentType: response.headers.contentType,
      etag: response.headers.etag,
      lastModified: response.headers.lastModified,
      contentLength: response.bytes.byteLength,
      checksum: archived.checksum,
      storageKey: archived.storageKey,
      reused: archived.reused,
    },
    params.kind === "html" ? "archived original HTML" : "archived original PDF",
  );
  return {
    archived: true,
    failed: false,
    reused: archived.reused,
    checksum: archived.checksum,
    response,
  };
}

async function fetchPdf(
  client: DownloadHttpClient,
  config: DownloadConfig,
  source: PdfDownloadTarget,
  referer: string,
): Promise<BinaryHttpResponse> {
  if (source.type === "url") {
    return client.getBytes(source.url);
  }
  const response = await client.postFormBytes(
    pdfExportPath(config.locale),
    pdfExportFields(source.lawId),
    referer,
  );
  if (isHtmlWrapper(response)) {
    const nestedUrl = extractPdfFileUrl(response.bytes.toString("utf8"), response.url);
    if (nestedUrl) {
      return client.getBytes(nestedUrl);
    }
  }
  return response;
}

function isHtmlWrapper(response: BinaryHttpResponse): boolean {
  return (
    response.status >= 200 &&
    response.status < 300 &&
    looksLikeHtml(response.bytes) &&
    !response.bytes.subarray(0, 5).toString("latin1").startsWith("%PDF")
  );
}

function pdfUrlForLog(source: PdfDownloadTarget, config: DownloadConfig): string {
  if (source.type === "url") {
    return source.url;
  }
  return new URL(pdfExportPath(config.locale), `${config.baseUrl}/`).toString();
}

function formatError(error: unknown): string {
  if (error instanceof HttpError) {
    return `HTTP ${error.status} for ${error.url}`;
  }
  if (error instanceof UnsafeRedirectError || error instanceof RobotsDisallowError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function statusFromError(error: unknown): number {
  if (error instanceof HttpError) {
    return error.status;
  }
  return 0;
}

function parseLastModified(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
