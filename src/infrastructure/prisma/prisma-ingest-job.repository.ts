import { IngestJobStatus } from "../../domain/enums.js";
import type { IngestJob } from "../../domain/entities.js";
import type {
  IngestJobRepository,
  SaveIngestJob,
} from "../../domain/ports/repositories.js";
import type { DbClient } from "./db-client.js";
import { mapIngestJob, toJsonInput } from "./mappers.js";

export class PrismaIngestJobRepository implements IngestJobRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: SaveIngestJob): Promise<IngestJob> {
    const row = await this.db.ingestJob.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        sourceId: input.sourceId,
        jobType: input.jobType,
        status: IngestJobStatus.PENDING,
        url: input.url ?? null,
        metadata: toJsonInput(input.metadata ?? null),
      },
    });
    return mapIngestJob(row);
  }

  async findById(id: string): Promise<IngestJob | null> {
    const row = await this.db.ingestJob.findUnique({ where: { id } });
    return row ? mapIngestJob(row) : null;
  }

  async markRunning(id: string): Promise<IngestJob> {
    const row = await this.db.ingestJob.update({
      where: { id },
      data: {
        status: IngestJobStatus.RUNNING,
        startedAt: new Date(),
        completedAt: null,
        error: null,
      },
    });
    return mapIngestJob(row);
  }

  async markSucceeded(id: string): Promise<IngestJob> {
    const row = await this.db.ingestJob.update({
      where: { id },
      data: {
        status: IngestJobStatus.SUCCEEDED,
        completedAt: new Date(),
        error: null,
      },
    });
    return mapIngestJob(row);
  }

  async markFailed(id: string, error: string): Promise<IngestJob> {
    const current = await this.db.ingestJob.findUniqueOrThrow({ where: { id } });
    const row = await this.db.ingestJob.update({
      where: { id },
      data: {
        status: IngestJobStatus.FAILED,
        completedAt: new Date(),
        error,
        retryCount: current.retryCount + 1,
      },
    });
    return mapIngestJob(row);
  }
}
