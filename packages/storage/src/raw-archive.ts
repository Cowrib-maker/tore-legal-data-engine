import { getPrisma, type PrismaClient } from "@tore-legal-data-engine/db";
import type { Logger } from "@tore-legal-data-engine/logger";

import type { ArchiveCatalog, ArchiveObject } from "./archive-catalog.js";
import { CHECKSUM_ALGORITHM } from "./cas.js";
import { createBlobStore, loadStorageConfig } from "./create-blob-store.js";
import { PrismaArchiveCatalog } from "./prisma-archive-catalog.js";
import type { ArchiveKind, BlobStore, StoredBlob } from "./types.js";

export type ArchiveSourceInput = {
  documentId: string;
  kind: ArchiveKind;
  bytes: Buffer;
  mimeType?: string;
  crawlResultId?: string;
};

export type ArchivedSource = ArchiveObject & {
  reused: boolean;
  downloadedAt: Date;
};

export class RawArchive {
  constructor(
    private readonly blobStore: BlobStore,
    private readonly catalog: ArchiveCatalog,
    private readonly logger?: Logger,
  ) {}

  async archive(input: ArchiveSourceInput): Promise<ArchivedSource> {
    const mimeType = resolveMimeType(input.kind, input.mimeType);
    const downloadedAt = new Date();
    const stored = await this.blobStore.put({
      bytes: input.bytes,
      mimeType,
    });
    const { object, reused } = await this.ensureCatalog(stored);
    await this.catalog.attachToDocument({
      documentId: input.documentId,
      kind: input.kind,
      object,
      crawlResultId: input.crawlResultId,
      downloadedAt,
    });
    this.logger?.info(
      {
        event: reused ? "archive.reused" : "archive.stored",
        documentId: input.documentId,
        kind: input.kind,
        checksum: object.checksum,
        storageKey: object.storageKey,
        mimeType: object.mimeType,
        byteSize: object.byteSize.toString(),
        downloadedAt: downloadedAt.toISOString(),
        reused,
      },
      reused ? "reused archived source" : "stored archived source",
    );
    return {
      ...object,
      reused,
      downloadedAt,
    };
  }

  private async ensureCatalog(
    stored: StoredBlob,
  ): Promise<{ object: ArchiveObject; reused: boolean }> {
    const existing = await this.catalog.findByChecksum(stored.checksum);
    if (existing) {
      if (existing.byteSize !== stored.byteSize || existing.storageKey !== stored.storageKey) {
        throw new Error(`catalog entry does not match blob for ${stored.checksum}`);
      }
      if (existing.mimeType !== stored.mimeType) {
        this.logger?.warn(
          {
            event: "archive.mime_mismatch",
            checksum: stored.checksum,
            storedMimeType: existing.mimeType,
            incomingMimeType: stored.mimeType,
          },
          "reusing archived blob; keeping original mime type",
        );
      }
      return { object: existing, reused: true };
    }
    const object = await this.catalog.create({
      algorithm: CHECKSUM_ALGORITHM,
      checksum: stored.checksum,
      storageKey: stored.storageKey,
      backend: this.blobStore.backend,
      mimeType: stored.mimeType,
      byteSize: stored.byteSize,
      archivedAt: stored.archivedAt,
    });
    return { object, reused: stored.reused };
  }
}

export function createRawArchive(params: {
  blobStore: BlobStore;
  prisma: PrismaClient;
  logger?: Logger;
}): RawArchive {
  return new RawArchive(params.blobStore, new PrismaArchiveCatalog(params.prisma), params.logger);
}

export function createRawArchiveFromEnv(logger?: Logger): RawArchive {
  return createRawArchive({
    blobStore: createBlobStore(loadStorageConfig()),
    prisma: getPrisma(),
    logger,
  });
}

function resolveMimeType(kind: ArchiveKind, mimeType: string | undefined): string {
  const trimmed = mimeType?.trim();
  if (trimmed) {
    return trimmed;
  }
  return kind === "pdf" ? "application/pdf" : "text/html; charset=utf-8";
}
