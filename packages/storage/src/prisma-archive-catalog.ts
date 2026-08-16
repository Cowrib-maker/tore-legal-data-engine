import { Prisma, type PrismaClient, type StorageBackend } from "@tore-legal-data-engine/db";

import type { ArchiveCatalog, ArchiveObject, AttachArchiveInput } from "./archive-catalog.js";
import { CHECKSUM_ALGORITHM } from "./cas.js";
import { ArchiveConflictError, ArchiveIntegrityError } from "./errors.js";
import type { StorageBackendName } from "./types.js";

export class PrismaArchiveCatalog implements ArchiveCatalog {
  constructor(private readonly prisma: PrismaClient) {}

  async findByChecksum(checksum: string): Promise<ArchiveObject | null> {
    const row = await this.prisma.rawObject.findUnique({
      where: {
        algorithm_checksum: {
          algorithm: CHECKSUM_ALGORITHM,
          checksum,
        },
      },
    });
    return row ? toArchiveObject(row) : null;
  }

  async create(object: Omit<ArchiveObject, "id">): Promise<ArchiveObject> {
    try {
      const row = await this.prisma.rawObject.create({
        data: {
          algorithm: object.algorithm,
          checksum: object.checksum,
          storageKey: object.storageKey,
          backend: toPrismaBackend(object.backend),
          mimeType: object.mimeType,
          byteSize: object.byteSize,
          archivedAt: object.archivedAt,
        },
      });
      return toArchiveObject(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findByChecksum(object.checksum);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async attachToDocument(input: AttachArchiveInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: input.documentId },
        data:
          input.kind === "html"
            ? {
                rawHtmlObjectId: input.object.id,
                rawHtmlPath: input.object.storageKey,
              }
            : {
                rawPdfObjectId: input.object.id,
                rawPdfPath: input.object.storageKey,
              },
      });

      if (!input.crawlResultId) {
        return;
      }

      const crawlResult = await tx.crawlResult.findUnique({
        where: { id: input.crawlResultId },
        select: { id: true, documentId: true },
      });
      if (!crawlResult) {
        throw new ArchiveConflictError(`crawl result not found: ${input.crawlResultId}`);
      }
      if (crawlResult.documentId && crawlResult.documentId !== input.documentId) {
        throw new ArchiveConflictError("crawl result document does not match archive document");
      }

      await tx.crawlResult.update({
        where: { id: input.crawlResultId },
        data: {
          documentId: input.documentId,
          rawObjectId: input.object.id,
          checksum: input.object.checksum,
          contentType: input.object.mimeType,
          contentLength: input.object.byteSize,
          downloadedAt: input.downloadedAt,
        },
      });
    });
  }
}

function toArchiveObject(row: {
  id: string;
  algorithm: string;
  checksum: string;
  storageKey: string;
  backend: StorageBackend;
  mimeType: string;
  byteSize: bigint;
  archivedAt: Date;
}): ArchiveObject {
  if (row.algorithm !== CHECKSUM_ALGORITHM) {
    throw new ArchiveIntegrityError(`unsupported checksum algorithm: ${row.algorithm}`);
  }
  return {
    id: row.id,
    algorithm: CHECKSUM_ALGORITHM,
    checksum: row.checksum,
    storageKey: row.storageKey,
    backend: fromPrismaBackend(row.backend),
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    archivedAt: row.archivedAt,
  };
}

function toPrismaBackend(backend: StorageBackendName): StorageBackend {
  switch (backend) {
    case "local":
      return "LOCAL";
    case "s3":
      return "S3";
    case "azure_blob":
      return "AZURE_BLOB";
    default: {
      const unexpected: never = backend;
      throw new Error(`unsupported backend: ${unexpected}`);
    }
  }
}

function fromPrismaBackend(backend: StorageBackend): StorageBackendName {
  switch (backend) {
    case "LOCAL":
      return "local";
    case "S3":
      return "s3";
    case "AZURE_BLOB":
      return "azure_blob";
    default: {
      const unexpected: never = backend;
      throw new Error(`unsupported backend: ${unexpected}`);
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
