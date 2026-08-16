import type {
  ArchiveMetadata,
  ArchiveRecord,
  ArchiveStorage,
  ArchiveStoreResult,
} from "../../domain/ports/archive-storage.js";
import type { ArchiveRecordRepository } from "../../domain/ports/repositories.js";
import { sha256Hex, storageKeyForHash } from "../../application/archive/hash.js";
import type { LocalFilesystemByteStore } from "./local-filesystem-byte-store.js";

/**
 * Bytes on the local filesystem; SHA-256 metadata in PostgreSQL.
 * Survives process restart. Not S3.
 */
export class PostgresIndexedArchiveStorage implements ArchiveStorage {
  constructor(
    private readonly bytes: LocalFilesystemByteStore,
    private readonly archives: ArchiveRecordRepository,
  ) {}

  async putIfAbsent(
    bytes: Uint8Array,
    metadata: ArchiveMetadata,
  ): Promise<ArchiveStoreResult> {
    const sha256 = sha256Hex(bytes);
    const existing = await this.archives.findBySha256(sha256);
    if (existing) {
      return { record: existing, created: false };
    }

    const storageKey = storageKeyForHash(sha256);
    await this.bytes.writeIfAbsent(storageKey, bytes);

    try {
      const record = await this.archives.create({
        sourceId: metadata.sourceId ?? null,
        sha256,
        originalUrl: metadata.originalUrl,
        retrievedAt: metadata.retrievedAt,
        mimeType: metadata.mimeType,
        byteSize: bytes.byteLength,
        storageKey,
        originalFileName: metadata.originalFileName,
        encoding: metadata.encoding ?? null,
      });
      return { record, created: true };
    } catch {
      const raced = await this.archives.findBySha256(sha256);
      if (raced) {
        return { record: raced, created: false };
      }
      throw new Error("Failed to persist archive metadata");
    }
  }

  async get(sha256: string): Promise<Uint8Array | null> {
    const record = await this.archives.findBySha256(sha256);
    if (record) {
      return this.bytes.read(record.storageKey);
    }
    return this.bytes.read(storageKeyForHash(sha256));
  }

  async findByHash(sha256: string): Promise<ArchiveRecord | null> {
    return this.archives.findBySha256(sha256);
  }

  async health(): Promise<{ ok: boolean; storage: string; detail: string }> {
    return this.bytes.health();
  }
}
