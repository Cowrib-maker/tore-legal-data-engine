import { PrismaClient } from "@prisma/client";

export const PACKAGE_NAME = "@tore-legal-data-engine/db" as const;

let prismaClient: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  prismaClient ??= new PrismaClient();
  return prismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  if (!prismaClient) {
    return;
  }
  await prismaClient.$disconnect();
  prismaClient = undefined;
}

export { PrismaClient, Prisma } from "@prisma/client";
export type {
  ArchiveRecord,
  CitationEntry,
  EngineAuditLog,
  IngestJob,
  LegalDocument,
  LegalDocumentVersion,
  LegalNode,
  LegalRelation,
  LegalSource,
  ParseReview,
} from "@prisma/client";
