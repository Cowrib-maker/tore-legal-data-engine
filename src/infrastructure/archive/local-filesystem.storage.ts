import { LocalFilesystemByteStore } from "./local-filesystem-byte-store.js";
import type {
  ArchiveMetadata,
  ArchiveRecord,
  ArchiveStorage,
  ArchiveStoreResult,
} from "../../domain/ports/archive-storage.js";
import { sha256Hex, storageKeyForHash } from "../../application/archive/hash.js";

type Stored = ArchiveRecord;

/**
 * Dev/unit adapter: original bytes on disk, metadata in memory.
 * Production Phase 2 uses PostgresIndexedArchiveStorage.
 */
export class LocalFilesystemArchiveStorage implements ArchiveStorage {
  private readonly records = new Map<string, Stored>();
  private readonly bytes: LocalFilesystemByteStore;

  constructor(rootDir: string) {
    this.bytes = new LocalFilesystemByteStore(rootDir);
  }

  async putIfAbsent(
    bytes: Uint8Array,
    metadata: ArchiveMetadata,
  ): Promise<ArchiveStoreResult> {
    const sha256 = sha256Hex(bytes);
    const existing = this.records.get(sha256);
    if (existing) {
      return { record: existing, created: false };
    }

    const storageKey = storageKeyForHash(sha256);
    await this.bytes.writeIfAbsent(storageKey, bytes);

    const record: Stored = {
      archiveId: `arc_${sha256.slice(0, 16)}`,
      sha256,
      originalUrl: metadata.originalUrl,
      retrievedAt: metadata.retrievedAt,
      mimeType: metadata.mimeType,
      byteSize: bytes.byteLength,
      storageKey,
      originalFileName: metadata.originalFileName,
      encoding: metadata.encoding,
      sourceId: metadata.sourceId ?? null,
    };
    this.records.set(sha256, record);
    return { record, created: true };
  }

  async get(sha256: string): Promise<Uint8Array | null> {
    const record = this.records.get(sha256);
    if (!record) {
      return null;
    }
    return this.bytes.read(record.storageKey);
  }

  async findByHash(sha256: string): Promise<ArchiveRecord | null> {
    return this.records.get(sha256) ?? null;
  }

  async health(): Promise<{ ok: boolean; storage: string; detail: string }> {
    return this.bytes.health();
  }
}
