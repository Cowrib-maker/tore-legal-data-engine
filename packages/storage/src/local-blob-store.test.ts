import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contentAddressKey, sha256Hex } from "./cas.js";
import { ArchiveIntegrityError } from "./errors.js";
import { LocalBlobStore } from "./local-blob-store.js";

describe("LocalBlobStore", () => {
  it("stores blobs by sha256 and never overwrites identical content", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "tore-archive-"));
    const store = new LocalBlobStore(rootDir);
    const bytes = Buffer.from("<html>хууль</html>", "utf8");
    const checksum = sha256Hex(bytes);

    const first = await store.put({ bytes, mimeType: "text/html; charset=utf-8" });
    expect(first.reused).toBe(false);
    expect(first.checksum).toBe(checksum);
    expect(first.storageKey).toBe(contentAddressKey(checksum));
    expect(first.byteSize).toBe(BigInt(bytes.byteLength));

    const dest = join(rootDir, first.storageKey);
    const before = await stat(dest);

    const second = await store.put({ bytes, mimeType: "text/html" });
    expect(second.reused).toBe(true);
    expect(second.checksum).toBe(checksum);
    expect(second.storageKey).toBe(first.storageKey);

    const after = await stat(dest);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
    await expect(store.get(checksum)).resolves.toEqual(bytes);
  });

  it("keeps different content at different keys", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "tore-archive-"));
    const store = new LocalBlobStore(rootDir);
    const html = await store.put({
      bytes: Buffer.from("<html>one</html>"),
      mimeType: "text/html",
    });
    const pdf = await store.put({
      bytes: Buffer.from("%PDF-1.4 fake"),
      mimeType: "application/pdf",
    });
    expect(html.checksum).not.toBe(pdf.checksum);
    expect(html.storageKey).not.toBe(pdf.storageKey);
    expect(await store.exists(html.checksum)).toBe(true);
    expect(await store.exists(pdf.checksum)).toBe(true);
  });

  it("rejects a missing blob", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "tore-archive-"));
    const store = new LocalBlobStore(rootDir);
    const checksum = sha256Hex(Buffer.from("missing"));
    await expect(store.get(checksum)).rejects.toBeInstanceOf(ArchiveIntegrityError);
  });
});
