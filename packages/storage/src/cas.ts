import { createHash } from "node:crypto";

export const CHECKSUM_ALGORITHM = "sha256" as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function contentAddressKey(checksum: string): string {
  if (!SHA256_HEX.test(checksum)) {
    throw new Error("checksum must be a lowercase sha256 hex digest");
  }
  return `${CHECKSUM_ALGORITHM}/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}`;
}
