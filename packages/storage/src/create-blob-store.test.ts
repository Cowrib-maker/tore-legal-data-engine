import { describe, expect, it } from "vitest";

import { AzureBlobStore } from "./azure-blob-store.js";
import { createBlobStore, loadStorageConfig } from "./create-blob-store.js";
import { StorageNotImplementedError } from "./errors.js";
import { LocalBlobStore } from "./local-blob-store.js";
import { S3BlobStore } from "./s3-blob-store.js";

describe("blob store factory", () => {
  it("creates a local store by default", () => {
    const store = createBlobStore(loadStorageConfig({}));
    expect(store).toBeInstanceOf(LocalBlobStore);
    expect(store.backend).toBe("local");
  });

  it("creates S3 and Azure stores as unimplemented interfaces", async () => {
    const s3 = createBlobStore(
      loadStorageConfig({
        STORAGE_BACKEND: "s3",
        STORAGE_S3_BUCKET: "legal-archive",
      }),
    );
    const azure = createBlobStore(
      loadStorageConfig({
        STORAGE_BACKEND: "azure_blob",
        STORAGE_AZURE_ACCOUNT: "tore",
        STORAGE_AZURE_CONTAINER: "archive",
      }),
    );
    expect(s3).toBeInstanceOf(S3BlobStore);
    expect(azure).toBeInstanceOf(AzureBlobStore);
    await expect(s3.put({ bytes: Buffer.from("x"), mimeType: "text/html" })).rejects.toBeInstanceOf(
      StorageNotImplementedError,
    );
    await expect(
      azure.put({ bytes: Buffer.from("x"), mimeType: "application/pdf" }),
    ).rejects.toBeInstanceOf(StorageNotImplementedError);
  });
});
