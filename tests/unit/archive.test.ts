import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArchiveService } from "../../src/application/archive/archive.service.js";
import { sha256Hex } from "../../src/application/archive/hash.js";
import { LocalFilesystemArchiveStorage } from "../../src/infrastructure/archive/local-filesystem.storage.js";

describe("archive SHA-256 identity", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function service(): Promise<ArchiveService> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tore-archive-"));
    dirs.push(dir);
    return new ArchiveService(new LocalFilesystemArchiveStorage(dir));
  }

  const metadata = {
    originalUrl: "https://example.mn/law.html",
    retrievedAt: "2026-08-16T00:00:00.000Z",
    mimeType: "text/html",
    originalFileName: "law.html",
  };

  it("identifies payload by SHA-256", async () => {
    const archive = await service();
    const bytes = new TextEncoder().encode("<html>law</html>");
    const result = await archive.store(bytes, metadata);
    expect(result.created).toBe(true);
    expect(result.record.sha256).toBe(sha256Hex(bytes));
    expect(result.record.byteSize).toBe(bytes.byteLength);
  });

  it("returns the existing record for duplicate bytes (putIfAbsent)", async () => {
    const archive = await service();
    const bytes = new TextEncoder().encode("same-bytes");
    const first = await archive.store(bytes, metadata);
    const second = await archive.store(bytes, {
      ...metadata,
      originalUrl: "https://example.mn/mirror.html",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.sha256).toBe(first.record.sha256);
    expect(second.record.archiveId).toBe(first.record.archiveId);
  });

  it("rejects empty payloads", async () => {
    const archive = await service();
    await expect(archive.store(new Uint8Array(), metadata)).rejects.toThrow(
      /must not be empty/,
    );
  });
});
