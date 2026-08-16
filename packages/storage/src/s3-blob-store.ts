import { StorageNotImplementedError } from "./errors.js";
import type { BlobStore, S3BlobStoreConfig, StoredBlob } from "./types.js";

export class S3BlobStore implements BlobStore {
  readonly backend = "s3" as const;

  constructor(readonly config: S3BlobStoreConfig) {
    if (!config.bucket.trim()) {
      throw new Error("S3 bucket is required");
    }
  }

  put(): Promise<StoredBlob> {
    return Promise.reject(new StorageNotImplementedError("S3-compatible"));
  }

  exists(): Promise<boolean> {
    return Promise.reject(new StorageNotImplementedError("S3-compatible"));
  }

  get(): Promise<Buffer> {
    return Promise.reject(new StorageNotImplementedError("S3-compatible"));
  }
}
