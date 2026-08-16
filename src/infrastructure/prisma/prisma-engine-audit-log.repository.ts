import type { EngineAuditLog } from "../../domain/entities.js";
import type {
  EngineAuditLogRepository,
  SaveEngineAuditLog,
} from "../../domain/ports/repositories.js";
import type { DbClient } from "./db-client.js";
import { mapAudit, toJsonInput } from "./mappers.js";

export class PrismaEngineAuditLogRepository implements EngineAuditLogRepository {
  constructor(private readonly db: DbClient) {}

  async append(input: SaveEngineAuditLog): Promise<EngineAuditLog> {
    const row = await this.db.engineAuditLog.create({
      data: {
        actor: input.actor,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: toJsonInput(input.metadata ?? null),
      },
    });
    return mapAudit(row);
  }

  async listByEntity(
    entityType: string,
    entityId: string,
  ): Promise<EngineAuditLog[]> {
    const rows = await this.db.engineAuditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapAudit);
  }
}
