import type { ArchiveKind, StorageBackendName } from "./types.js";

export type ArchiveObject = {
  id: string;
  algorithm: "sha256";
  checksum: string;
  storageKey: string;
  backend: StorageBackendName;
  mimeType: string;
  byteSize: bigint;
  archivedAt: Date;
};

export type AttachArchiveInput = {
  documentId: string;
  kind: ArchiveKind;
  object: ArchiveObject;
  crawlResultId?: string;
  downloadedAt: Date;
};

export interface ArchiveCatalog {
  findByChecksum(checksum: string): Promise<ArchiveObject | null>;
  create(object: Omit<ArchiveObject, "id">): Promise<ArchiveObject>;
  attachToDocument(input: AttachArchiveInput): Promise<void>;
}
