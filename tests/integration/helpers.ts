import { PrismaClient } from "@prisma/client";

import { ArchiveService } from "../../src/application/archive/archive.service.js";
import { PersistLegalDocumentService } from "../../src/application/legal-corpus/persist-document.js";
import { LocalFilesystemByteStore } from "../../src/infrastructure/archive/local-filesystem-byte-store.js";
import { PostgresIndexedArchiveStorage } from "../../src/infrastructure/archive/postgres-indexed.storage.js";
import { createRepositories } from "../../src/infrastructure/prisma/create-repositories.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/prisma/unit-of-work.js";
import {
  assertSafeTestDatabaseUrl,
  databaseNameFromUrl,
  looksLikeTestName,
  resolveIntegrationDatabaseUrl,
  schemaNameFromUrl,
} from "./test-database-url.js";

export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: resolveIntegrationDatabaseUrl() },
    },
  });
}

export const prisma = createTestPrismaClient();

export const repos = createRepositories(prisma);

export const persist = new PersistLegalDocumentService(new PrismaUnitOfWork(prisma));

export function createArchive(rootDir: string): ArchiveService {
  const storage = new PostgresIndexedArchiveStorage(
    new LocalFilesystemByteStore(rootDir),
    repos.archives,
  );
  return new ArchiveService(storage);
}

export async function resetDatabase(): Promise<void> {
  const url = resolveIntegrationDatabaseUrl();
  assertSafeTestDatabaseUrl(url);
  const expectedDb = databaseNameFromUrl(url);
  const expectedSchema = schemaNameFromUrl(url);
  await prisma.$executeRawUnsafe(`SET search_path TO "${expectedSchema.replaceAll('"', "")}"`);
  const rows = await prisma.$queryRaw<
    Array<{ current_database: string; current_schema: string }>
  >`SELECT current_database(), current_schema()`;
  const connectedDb = rows[0]?.current_database ?? "";
  const connectedSchema = rows[0]?.current_schema ?? "";
  if (connectedDb !== expectedDb) {
    throw new Error(
      `Connected database "${connectedDb}" does not match TEST_DATABASE_URL name "${expectedDb}"`,
    );
  }
  if (connectedSchema !== expectedSchema) {
    throw new Error(
      `Connected schema "${connectedSchema}" does not match TEST_DATABASE_URL schema "${expectedSchema}"`,
    );
  }
  if (connectedSchema === "public" && !looksLikeTestName(connectedDb)) {
    throw new Error(`Refusing TRUNCATE of public schema on "${connectedDb}"`);
  }
  if (!looksLikeTestName(connectedDb) && !looksLikeTestName(connectedSchema)) {
    throw new Error(`Refusing TRUNCATE of "${connectedDb}"."${connectedSchema}"`);
  }
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "engine_audit_logs",
      "parse_reviews",
      "citation_entries",
      "legal_relations",
      "legal_nodes",
      "legal_document_versions",
      "legal_documents",
      "ingest_jobs",
      "archive_records",
      "legal_sources"
    RESTART IDENTITY CASCADE
  `);
}
