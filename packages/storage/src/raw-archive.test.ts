import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ArchiveCatalog, ArchiveObject, AttachArchiveInput } from "./archive-catalog.js";
import { LocalBlobStore } from "./local-blob-store.js";
import { RawArchive } from "./raw-archive.js";

class MemoryArchiveCatalog implements ArchiveCatalog {
  readonly objects = new Map<string, ArchiveObject>();
  readonly attachments: AttachArchiveInput[] = [];

  async findByChecksum(checksum: string): Promise<ArchiveObject | null> {
    return this.objects.get(checksum) ?? null;
  }

  async create(object: Omit<ArchiveObject, "id">): Promise<ArchiveObject> {
    const existing = this.objects.get(object.checksum);
    if (existing) {
      return existing;
    }
    const created = { ...object, id: randomUUID() };
    this.objects.set(object.checksum, created);
    return created;
  }

  async attachToDocument(input: AttachArchiveInput): Promise<void> {
    this.attachments.push(input);
  }
}

describe("RawArchive", () => {
  it("archives HTML and PDF, then reuses identical bytes", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "tore-raw-archive-"));
    const catalog = new MemoryArchiveCatalog();
    const archive = new RawArchive(new LocalBlobStore(rootDir), catalog);
    const documentId = randomUUID();
    const html = Buffer.from("<article>Эрх зүйн акт</article>", "utf8");
    const pdf = Buffer.from("%PDF-1.4 archived", "utf8");

    const storedHtml = await archive.archive({
      documentId,
      kind: "html",
      bytes: html,
    });
    const storedPdf = await archive.archive({
      documentId,
      kind: "pdf",
      bytes: pdf,
    });
    const reusedHtml = await archive.archive({
      documentId: randomUUID(),
      kind: "html",
      bytes: html,
      mimeType: "text/html",
    });

    expect(storedHtml.reused).toBe(false);
    expect(storedHtml.mimeType).toBe("text/html; charset=utf-8");
    expect(storedPdf.mimeType).toBe("application/pdf");
    expect(reusedHtml.reused).toBe(true);
    expect(reusedHtml.id).toBe(storedHtml.id);
    expect(catalog.objects.size).toBe(2);
    expect(catalog.attachments).toHaveLength(3);
    expect(catalog.attachments[0]?.object.storageKey).toBe(storedHtml.storageKey);
    expect(catalog.attachments[1]?.kind).toBe("pdf");
  });
});
