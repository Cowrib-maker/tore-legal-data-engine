import { InvariantError } from "../../domain/errors.js";
import type { LegalDocumentVersion } from "../../domain/entities.js";
import type {
  LegalDocumentVersionRepository,
  SaveLegalDocumentVersion,
} from "../../domain/ports/repositories.js";
import {
  assertDocumentVersion,
  versionCoversInstant,
} from "../../domain/services/document-version.js";
import type { DbClient } from "./db-client.js";
import { fromIso, isOverlapViolation, mapVersion } from "./mappers.js";

export class PrismaLegalDocumentVersionRepository
  implements LegalDocumentVersionRepository
{
  constructor(private readonly db: DbClient) {}

  async save(input: SaveLegalDocumentVersion): Promise<LegalDocumentVersion> {
    assertDocumentVersion({
      id: input.id ?? "pending",
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      contentHash: input.contentHash,
      parserId: input.parserId,
      status: input.status,
      amendmentDocumentId: input.amendmentDocumentId,
      archiveRecordId: input.archiveRecordId,
      nodes: [],
    });

    const data = {
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      effectiveFrom: fromIso(input.effectiveFrom),
      effectiveTo: fromIso(input.effectiveTo),
      contentHash: input.contentHash,
      parserId: input.parserId,
      status: input.status,
      amendmentDocumentId: input.amendmentDocumentId,
      archiveRecordId: input.archiveRecordId,
    };

    try {
      if (input.id) {
        const row = await this.db.legalDocumentVersion.upsert({
          where: { id: input.id },
          create: { id: input.id, ...data },
          update: data,
        });
        return mapVersion(row);
      }
      return mapVersion(await this.db.legalDocumentVersion.create({ data }));
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw new InvariantError(
          "published versions for the same document must not overlap",
        );
      }
      throw error;
    }
  }

  async findById(id: string): Promise<LegalDocumentVersion | null> {
    const row = await this.db.legalDocumentVersion.findUnique({ where: { id } });
    return row ? mapVersion(row) : null;
  }

  async listByDocumentId(documentId: string): Promise<LegalDocumentVersion[]> {
    const rows = await this.db.legalDocumentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: "asc" },
    });
    return rows.map(mapVersion);
  }

  async findPublishedForDocument(
    documentId: string,
    asOf?: string | null,
  ): Promise<LegalDocumentVersion | null> {
    if (!asOf) {
      const row = await this.db.legalDocumentVersion.findFirst({
        where: { documentId, status: "PUBLISHED" },
        orderBy: { versionNumber: "desc" },
      });
      return row ? mapVersion(row) : null;
    }
    const instant = new Date(asOf);
    if (Number.isNaN(instant.getTime())) {
      return null;
    }
    const rows = await this.db.legalDocumentVersion.findMany({
      where: {
        documentId,
        status: { in: ["PUBLISHED", "SUPERSEDED"] },
      },
      orderBy: { versionNumber: "desc" },
    });
    const row = rows.find((item) => versionCoversInstant(mapVersion(item), asOf));
    return row ? mapVersion(row) : null;
  }

  async findByDocumentContentHashAndParserId(
    documentId: string,
    contentHash: string,
    parserId: string,
  ): Promise<LegalDocumentVersion | null> {
    const row = await this.db.legalDocumentVersion.findUnique({
      where: {
        documentId_contentHash_parserId: { documentId, contentHash, parserId },
      },
    });
    return row ? mapVersion(row) : null;
  }
}
