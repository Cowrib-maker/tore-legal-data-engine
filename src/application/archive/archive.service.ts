import type {
  ArchiveMetadata,
  ArchiveRecord,
  ArchiveStorage,
  ArchiveStoreResult,
} from "../../domain/ports/archive-storage.js";
import { sha256Hex, storageKeyForHash } from "./hash.js";

/**
 * Content-addressed archive: identity is SHA-256 of original bytes.
 * Duplicate bytes return the existing record (created: false).
 */
export class ArchiveService {
  constructor(private readonly storage: ArchiveStorage) {}

  async store(
    bytes: Uint8Array,
    metadata: ArchiveMetadata,
  ): Promise<ArchiveStoreResult> {
    if (bytes.byteLength === 0) {
      throw new Error("Archive payload must not be empty");
    }
    const digest = sha256Hex(bytes);
    const existing = await this.storage.findByHash(digest);
    if (existing) {
      return { record: existing, created: false };
    }
    return this.storage.putIfAbsent(bytes, {
      ...metadata,
    });
  }

  async get(sha256: string): Promise<Uint8Array | null> {
    return this.storage.get(sha256);
  }

  async findByHash(sha256: string): Promise<ArchiveRecord | null> {
    return this.storage.findByHash(sha256);
  }

  storageKey(bytes: Uint8Array): string {
    return storageKeyForHash(sha256Hex(bytes));
  }
}
