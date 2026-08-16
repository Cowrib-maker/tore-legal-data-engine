export type StorageBackendName = "local" | "s3" | "azure_blob";

export type ArchiveKind = "html" | "pdf";

export type PutBlobInput = {
  bytes: Buffer;
  mimeType: string;
};

export type StoredBlob = {
  algorithm: "sha256";
  checksum: string;
  storageKey: string;
  mimeType: string;
  byteSize: bigint;
  archivedAt: Date;
  reused: boolean;
};

export interface BlobStore {
  readonly backend: StorageBackendName;
  put(input: PutBlobInput): Promise<StoredBlob>;
  exists(checksum: string): Promise<boolean>;
  get(checksum: string): Promise<Buffer>;
}

export type S3BlobStoreConfig = {
  bucket: string;
  region?: string;
  endpoint?: string;
  prefix?: string;
};

export type AzureBlobStoreConfig = {
  account: string;
  container: string;
  prefix?: string;
};

export type StorageConfig =
  | { backend: "local"; rootDir: string }
  | { backend: "s3"; s3: S3BlobStoreConfig }
  | { backend: "azure_blob"; azure: AzureBlobStoreConfig };
