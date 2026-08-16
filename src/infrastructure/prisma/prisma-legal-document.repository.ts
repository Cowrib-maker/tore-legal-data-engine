import type { LegalDocument } from "../../domain/entities.js";
import type {
  LegalDocumentRepository,
  SaveLegalDocument,
} from "../../domain/ports/repositories.js";
import type { DbClient } from "./db-client.js";
import { fromIso, mapDocument } from "./mappers.js";

export class PrismaLegalDocumentRepository implements LegalDocumentRepository {
  constructor(private readonly db: DbClient) {}

  async save(input: SaveLegalDocument): Promise<LegalDocument> {
    const data = {
      sourceId: input.sourceId,
      documentType: input.documentType,
      title: input.title,
      documentNumber: input.documentNumber,
      issuingAuthority: input.issuingAuthority,
      jurisdiction: input.jurisdiction,
      adoptedAt: fromIso(input.adoptedAt),
      canonicalUrl: input.canonicalUrl,
      status: input.status,
    };
    if (input.id) {
      const row = await this.db.legalDocument.upsert({
        where: { id: input.id },
        create: { id: input.id, ...data },
        update: data,
      });
      return mapDocument(row);
    }
    return mapDocument(await this.db.legalDocument.create({ data }));
  }

  async findById(id: string): Promise<LegalDocument | null> {
    const row = await this.db.legalDocument.findUnique({ where: { id } });
    return row ? mapDocument(row) : null;
  }

  async findBySourceAndCanonicalUrl(
    sourceId: string,
    canonicalUrl: string,
  ): Promise<LegalDocument | null> {
    const row = await this.db.legalDocument.findUnique({
      where: { sourceId_canonicalUrl: { sourceId, canonicalUrl } },
    });
    return row ? mapDocument(row) : null;
  }
}
