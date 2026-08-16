import {
  getPrisma,
  type ImportOperation,
  type Prisma,
  type PrismaClient,
} from "@tore-legal-data-engine/db";

export type DownloadTarget = {
  id: string;
  sourceId: string;
  externalId: string;
  officialUrl: string | null;
  metadataJson: Record<string, unknown>;
};

export type DownloadJobRecord = {
  id: string;
};

export type FinishJobInput = {
  status: "COMPLETED" | "FAILED";
  totalFound: number;
  totalDownloaded: number;
  totalFailed: number;
  errorLog: string | null;
};

export type CreateCrawlResultInput = {
  crawlJobId: string;
  documentId: string;
  url: string;
  httpStatus: number;
  etag?: string | null;
  lastModified?: Date | null;
  contentType?: string | null;
  contentLength?: bigint | null;
  checksum?: string | null;
};

export type DownloadStore = {
  findDocument(query: {
    sourceId: string;
    lawId?: string;
    documentId?: string;
  }): Promise<DownloadTarget | null>;
  createJob(sourceId: string): Promise<DownloadJobRecord>;
  createCrawlResult(input: CreateCrawlResultInput): Promise<{ id: string }>;
  updateDocumentAvailability(
    documentId: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
  writeImportLog(documentId: string, details: Record<string, unknown>): Promise<void>;
  finishJob(jobId: string, input: FinishJobInput): Promise<void>;
};

export class PrismaDownloadStore implements DownloadStore {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async findDocument(query: {
    sourceId: string;
    lawId?: string;
    documentId?: string;
  }): Promise<DownloadTarget | null> {
    const row = query.documentId
      ? await this.prisma.document.findFirst({
          where: { id: query.documentId, sourceId: query.sourceId, deletedAt: null },
        })
      : query.lawId
        ? await this.prisma.document.findFirst({
            where: { sourceId: query.sourceId, externalId: query.lawId, deletedAt: null },
            orderBy: { version: "desc" },
          })
        : await this.prisma.document.findFirst({
            where: { sourceId: query.sourceId, deletedAt: null, rawHtmlObjectId: null },
            orderBy: { createdAt: "asc" },
          });
    return row ? toTarget(row) : null;
  }

  async createJob(sourceId: string): Promise<DownloadJobRecord> {
    return this.prisma.crawlJob.create({
      data: {
        sourceId,
        startedAt: new Date(),
        status: "RUNNING",
        totalFound: 1,
      },
      select: { id: true },
    });
  }

  async createCrawlResult(input: CreateCrawlResultInput): Promise<{ id: string }> {
    return this.prisma.crawlResult.create({
      data: {
        crawlJobId: input.crawlJobId,
        documentId: input.documentId,
        url: truncate(input.url, 2048),
        httpStatus: input.httpStatus,
        etag: input.etag ? truncate(input.etag, 255) : null,
        lastModified: input.lastModified ?? null,
        contentType: input.contentType ? truncate(input.contentType, 255) : null,
        contentLength: input.contentLength ?? null,
        checksum: input.checksum ?? null,
        downloadedAt: new Date(),
      },
      select: { id: true },
    });
  }

  async updateDocumentAvailability(
    documentId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { metadataJson: true },
    });
    const current = asJsonObject(existing?.metadataJson);
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        metadataJson: {
          ...current,
          ...metadata,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async writeImportLog(documentId: string, details: Record<string, unknown>): Promise<void> {
    const operation: ImportOperation = "UPDATE";
    await this.prisma.importLog.create({
      data: {
        documentId,
        operation,
        detailsJson: details as Prisma.InputJsonValue,
      },
    });
  }

  async finishJob(jobId: string, input: FinishJobInput): Promise<void> {
    await this.prisma.crawlJob.update({
      where: { id: jobId },
      data: {
        status: input.status,
        finishedAt: new Date(),
        totalFound: input.totalFound,
        totalDownloaded: input.totalDownloaded,
        totalFailed: input.totalFailed,
        errorLog: input.errorLog,
      },
    });
  }
}

function toTarget(row: {
  id: string;
  sourceId: string;
  externalId: string;
  officialUrl: string | null;
  metadataJson: Prisma.JsonValue;
}): DownloadTarget {
  return {
    id: row.id,
    sourceId: row.sourceId,
    externalId: row.externalId,
    officialUrl: row.officialUrl,
    metadataJson: asJsonObject(row.metadataJson),
  };
}

function asJsonObject(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
