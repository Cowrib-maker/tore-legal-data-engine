import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export class LocalFilesystemByteStore {
  constructor(private readonly rootDir: string) {}

  async writeIfAbsent(storageKey: string, bytes: Uint8Array): Promise<void> {
    const abs = path.join(this.rootDir, storageKey);
    await mkdir(path.dirname(abs), { recursive: true });
    try {
      await writeFile(abs, bytes, { flag: "wx" });
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
    }
  }

  async read(storageKey: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(path.join(this.rootDir, storageKey));
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  async health(): Promise<{ ok: boolean; storage: string; detail: string }> {
    try {
      await mkdir(this.rootDir, { recursive: true });
      return {
        ok: true,
        storage: "local-filesystem",
        detail: "writable",
      };
    } catch (error) {
      return {
        ok: false,
        storage: "local-filesystem",
        detail: error instanceof Error ? error.message : "archive_unhealthy",
      };
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}
