import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { contentAddressKey, sha256Hex } from "./cas.js";
import { ArchiveIntegrityError } from "./errors.js";
import type { BlobStore, PutBlobInput, StoredBlob } from "./types.js";

export class LocalBlobStore implements BlobStore {
  readonly backend = "local" as const;

  constructor(private readonly rootDir: string) {
    if (!rootDir.trim()) {
      throw new Error("local archive root directory is required");
    }
  }

  async put(input: PutBlobInput): Promise<StoredBlob> {
    const bytes = toBuffer(input.bytes);
    const mimeType = requireMimeType(input.mimeType);
    const checksum = sha256Hex(bytes);
    const storageKey = contentAddressKey(checksum);
    const dest = this.resolve(storageKey);
    const byteSize = BigInt(bytes.byteLength);

    await mkdir(dirname(dest), { recursive: true });
    const created = await writeExclusive(dest, bytes);
    const archivedAt = new Date();
    if (!created) {
      await assertExistingMatches(dest, checksum, byteSize);
      return {
        algorithm: "sha256",
        checksum,
        storageKey,
        mimeType,
        byteSize,
        archivedAt,
        reused: true,
      };
    }

    return {
      algorithm: "sha256",
      checksum,
      storageKey,
      mimeType,
      byteSize,
      archivedAt,
      reused: false,
    };
  }

  async exists(checksum: string): Promise<boolean> {
    try {
      await stat(this.resolve(contentAddressKey(checksum)));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async get(checksum: string): Promise<Buffer> {
    const path = this.resolve(contentAddressKey(checksum));
    try {
      const bytes = await readFile(path);
      const actual = sha256Hex(bytes);
      if (actual !== checksum) {
        throw new ArchiveIntegrityError(`archived blob checksum mismatch for ${checksum}`);
      }
      return bytes;
    } catch (error) {
      if (isNotFound(error)) {
        throw new ArchiveIntegrityError(`archived blob not found: ${checksum}`);
      }
      throw error;
    }
  }

  private resolve(storageKey: string): string {
    return join(this.rootDir, storageKey);
  }
}

async function writeExclusive(dest: string, bytes: Buffer): Promise<boolean> {
  try {
    const handle = await open(dest, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(dest).catch(() => undefined);
      throw error;
    }
    await handle.close();
    return true;
  } catch (error) {
    if (isAlreadyExists(error)) {
      return false;
    }
    throw error;
  }
}

async function assertExistingMatches(
  path: string,
  checksum: string,
  byteSize: bigint,
): Promise<void> {
  const existing = await stat(path);
  if (BigInt(existing.size) !== byteSize) {
    throw new ArchiveIntegrityError(`immutable blob size mismatch at ${path}`);
  }
  const actual = sha256Hex(await readFile(path));
  if (actual !== checksum) {
    throw new ArchiveIntegrityError(`immutable blob checksum mismatch at ${path}`);
  }
}

function toBuffer(bytes: Buffer): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function requireMimeType(mimeType: string): string {
  const trimmed = mimeType.trim();
  if (!trimmed) {
    throw new Error("mimeType is required");
  }
  return trimmed;
}

function isAlreadyExists(error: unknown): boolean {
  return isErrno(error, "EEXIST");
}

function isNotFound(error: unknown): boolean {
  return isErrno(error, "ENOENT");
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
