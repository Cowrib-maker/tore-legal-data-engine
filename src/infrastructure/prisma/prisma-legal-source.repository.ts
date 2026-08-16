import type { LegalSource } from "../../domain/entities.js";
import type {
  LegalSourceRepository,
  SaveLegalSource,
} from "../../domain/ports/repositories.js";
import type { DbClient } from "./db-client.js";
import { fromIso, mapSource } from "./mappers.js";

export class PrismaLegalSourceRepository implements LegalSourceRepository {
  constructor(private readonly db: DbClient) {}

  async save(input: SaveLegalSource): Promise<LegalSource> {
    const data = {
      name: input.name,
      type: input.type,
      authority: input.authority,
      jurisdiction: input.jurisdiction,
      baseUrl: input.baseUrl,
      trustLevel: input.trustLevel,
      isActive: input.isActive ?? true,
      lastCheckedAt: fromIso(input.lastCheckedAt),
    };
    if (input.id) {
      const row = await this.db.legalSource.upsert({
        where: { id: input.id },
        create: { id: input.id, ...data },
        update: data,
      });
      return mapSource(row);
    }
    return mapSource(await this.db.legalSource.create({ data }));
  }

  async findById(id: string): Promise<LegalSource | null> {
    const row = await this.db.legalSource.findUnique({ where: { id } });
    return row ? mapSource(row) : null;
  }
}
