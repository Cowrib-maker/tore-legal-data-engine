import { createHash } from "node:crypto";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function storageKeyForHash(sha256: string): string {
  const prefix = sha256.slice(0, 2);
  return `archive/${prefix}/${sha256}`;
}
