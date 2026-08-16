import type { EngineRepositories } from "../../domain/ports/repositories.js";
import type { DbClient } from "./db-client.js";
import { PrismaArchiveRecordRepository } from "./prisma-archive-record.repository.js";
import { PrismaCitationRepository } from "./prisma-citation.repository.js";
import { PrismaEngineAuditLogRepository } from "./prisma-engine-audit-log.repository.js";
import { PrismaIngestJobRepository } from "./prisma-ingest-job.repository.js";
import { PrismaLegalDocumentRepository } from "./prisma-legal-document.repository.js";
import { PrismaLegalDocumentVersionRepository } from "./prisma-legal-document-version.repository.js";
import { PrismaLegalNodeRepository } from "./prisma-legal-node.repository.js";
import { PrismaLegalRelationRepository } from "./prisma-legal-relation.repository.js";
import { PrismaLegalSourceRepository } from "./prisma-legal-source.repository.js";
import { PrismaParseReviewRepository } from "./prisma-parse-review.repository.js";

export function createRepositories(db: DbClient): EngineRepositories {
  return {
    sources: new PrismaLegalSourceRepository(db),
    documents: new PrismaLegalDocumentRepository(db),
    versions: new PrismaLegalDocumentVersionRepository(db),
    nodes: new PrismaLegalNodeRepository(db),
    relations: new PrismaLegalRelationRepository(db),
    citations: new PrismaCitationRepository(db),
    ingestJobs: new PrismaIngestJobRepository(db),
    parseReviews: new PrismaParseReviewRepository(db),
    auditLogs: new PrismaEngineAuditLogRepository(db),
    archives: new PrismaArchiveRecordRepository(db),
  };
}
