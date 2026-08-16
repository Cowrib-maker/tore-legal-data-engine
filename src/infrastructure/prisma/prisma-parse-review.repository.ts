import { ParseReviewStatus } from "../../domain/enums.js";
import type { ParseReview } from "../../domain/entities.js";
import type {
  ParseReviewRepository,
  SaveParseReview,
} from "../../domain/ports/repositories.js";
import type { DbClient } from "./db-client.js";
import { fromIso, mapParseReview, toJsonInput } from "./mappers.js";

export class PrismaParseReviewRepository implements ParseReviewRepository {
  constructor(private readonly db: DbClient) {}

  async save(input: SaveParseReview): Promise<ParseReview> {
    const data = {
      documentId: input.documentId,
      archiveRecordId: input.archiveRecordId,
      status: input.status ?? ParseReviewStatus.PENDING,
      reason: input.reason,
      parsedPayload: toJsonInput(input.parsedPayload) ?? {},
      reviewedBy: input.reviewedBy ?? null,
      reviewedAt: fromIso(input.reviewedAt),
    };
    if (input.id) {
      const row = await this.db.parseReview.upsert({
        where: { id: input.id },
        create: { id: input.id, ...data },
        update: data,
      });
      return mapParseReview(row);
    }
    return mapParseReview(await this.db.parseReview.create({ data }));
  }

  async findById(id: string): Promise<ParseReview | null> {
    const row = await this.db.parseReview.findUnique({ where: { id } });
    return row ? mapParseReview(row) : null;
  }

  async listByDocumentId(documentId: string): Promise<ParseReview[]> {
    const rows = await this.db.parseReview.findMany({
      where: { documentId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapParseReview);
  }
}
