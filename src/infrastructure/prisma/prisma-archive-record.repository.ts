import type { ArchiveRecord } from "../../domain/ports/archive-storage.js";
import type {
  ArchiveRecordRepository,
  SaveArchiveRecord,
} from "../../domain/ports/repositories.js";
import type { DbClient } from "./db-client.js";
import { isUniqueViolation, mapArchive } from "./mappers.js";

export class PrismaArchiveRecordRepository implements ArchiveRecordRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: SaveArchiveRecord): Promise<ArchiveRecord> {
    try {
      const row = await this.db.archiveRecord.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          sourceId: input.sourceId ?? null,
          sha256: input.sha256,
          originalUrl: input.originalUrl,
          retrievedAt: new Date(input.retrievedAt),
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          storageKey: input.storageKey,
          originalFileName: input.originalFileName,
          encoding: input.encoding ?? null,
        },
      });
      return mapArchive(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findBySha256(input.sha256);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async findBySha256(sha256: string): Promise<ArchiveRecord | null> {
    const row = await this.db.archiveRecord.findUnique({ where: { sha256 } });
    return row ? mapArchive(row) : null;
  }

  async findById(id: string): Promise<ArchiveRecord | null> {
    const row = await this.db.archiveRecord.findUnique({ where: { id } });
    return row ? mapArchive(row) : null;
  }
}
