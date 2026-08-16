import type { LegalRelation } from "../../domain/entities.js";
import type {
  LegalRelationRepository,
  SaveLegalRelation,
} from "../../domain/ports/repositories.js";
import type { DbClient } from "./db-client.js";
import { mapRelation, toJsonInput } from "./mappers.js";

export class PrismaLegalRelationRepository implements LegalRelationRepository {
  constructor(private readonly db: DbClient) {}

  async save(input: SaveLegalRelation): Promise<LegalRelation> {
    const data = {
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      relationType: input.relationType,
      metadata: toJsonInput(input.metadata ?? null),
    };
    if (input.id) {
      const row = await this.db.legalRelation.upsert({
        where: { id: input.id },
        create: { id: input.id, ...data },
        update: data,
      });
      return mapRelation(row);
    }
    return mapRelation(await this.db.legalRelation.create({ data }));
  }

  async findByFromNode(fromNodeId: string): Promise<LegalRelation[]> {
    const rows = await this.db.legalRelation.findMany({ where: { fromNodeId } });
    return rows.map(mapRelation);
  }
}
