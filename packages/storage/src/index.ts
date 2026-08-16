export const PACKAGE_NAME = "@tore-legal-data-engine/storage" as const;

export { CHECKSUM_ALGORITHM, contentAddressKey, sha256Hex } from "./cas.js";
export { createBlobStore, loadStorageConfig } from "./create-blob-store.js";
export { LocalBlobStore } from "./local-blob-store.js";
export { S3BlobStore } from "./s3-blob-store.js";
export { AzureBlobStore } from "./azure-blob-store.js";
export { PrismaArchiveCatalog } from "./prisma-archive-catalog.js";
export { RawArchive, createRawArchive, createRawArchiveFromEnv } from "./raw-archive.js";
export {
  ArchiveConflictError,
  ArchiveIntegrityError,
  StorageNotImplementedError,
} from "./errors.js";

export type {
  ArchiveKind,
  AzureBlobStoreConfig,
  BlobStore,
  PutBlobInput,
  S3BlobStoreConfig,
  StorageBackendName,
  StorageConfig,
  StoredBlob,
} from "./types.js";
export type { ArchiveCatalog, ArchiveObject, AttachArchiveInput } from "./archive-catalog.js";
export type { ArchiveSourceInput, ArchivedSource } from "./raw-archive.js";
