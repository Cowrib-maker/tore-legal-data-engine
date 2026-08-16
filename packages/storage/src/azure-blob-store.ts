import { StorageNotImplementedError } from "./errors.js";
import type { AzureBlobStoreConfig, BlobStore, StoredBlob } from "./types.js";

export class AzureBlobStore implements BlobStore {
  readonly backend = "azure_blob" as const;

  constructor(readonly config: AzureBlobStoreConfig) {
    if (!config.account.trim() || !config.container.trim()) {
      throw new Error("Azure Blob account and container are required");
    }
  }

  put(): Promise<StoredBlob> {
    return Promise.reject(new StorageNotImplementedError("Azure Blob"));
  }

  exists(): Promise<boolean> {
    return Promise.reject(new StorageNotImplementedError("Azure Blob"));
  }

  get(): Promise<Buffer> {
    return Promise.reject(new StorageNotImplementedError("Azure Blob"));
  }
}
