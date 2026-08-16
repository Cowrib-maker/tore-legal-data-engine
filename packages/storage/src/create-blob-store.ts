import { AzureBlobStore } from "./azure-blob-store.js";
import { LocalBlobStore } from "./local-blob-store.js";
import { S3BlobStore } from "./s3-blob-store.js";
import type { BlobStore, StorageConfig } from "./types.js";

export function createBlobStore(config: StorageConfig): BlobStore {
  switch (config.backend) {
    case "local":
      return new LocalBlobStore(config.rootDir);
    case "s3":
      return new S3BlobStore(config.s3);
    case "azure_blob":
      return new AzureBlobStore(config.azure);
    default: {
      const unexpected: never = config;
      throw new Error(`unsupported storage backend: ${JSON.stringify(unexpected)}`);
    }
  }
}

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const backend = (env["STORAGE_BACKEND"] ?? "local").trim().toLowerCase();
  if (backend === "local") {
    return {
      backend: "local",
      rootDir: env["STORAGE_LOCAL_ROOT"] ?? "data/archive",
    };
  }
  if (backend === "s3") {
    return {
      backend: "s3",
      s3: {
        bucket: required(env["STORAGE_S3_BUCKET"], "STORAGE_S3_BUCKET"),
        region: emptyToUndefined(env["STORAGE_S3_REGION"]),
        endpoint: emptyToUndefined(env["STORAGE_S3_ENDPOINT"]),
        prefix: emptyToUndefined(env["STORAGE_S3_PREFIX"]),
      },
    };
  }
  if (backend === "azure" || backend === "azure_blob") {
    return {
      backend: "azure_blob",
      azure: {
        account: required(env["STORAGE_AZURE_ACCOUNT"], "STORAGE_AZURE_ACCOUNT"),
        container: required(env["STORAGE_AZURE_CONTAINER"], "STORAGE_AZURE_CONTAINER"),
        prefix: emptyToUndefined(env["STORAGE_AZURE_PREFIX"]),
      },
    };
  }
  throw new Error(`unsupported STORAGE_BACKEND: ${backend}`);
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}
