import { ArchiveService } from "../application/archive/archive.service.js";
import { CorpusCitationValidator } from "../application/citations/corpus-citation-validator.js";
import { PersistLegalDocumentService } from "../application/legal-corpus/persist-document.js";
import { CorpusRetrieval } from "../application/legal-corpus/corpus-retrieval.js";
import type { Env } from "./config/env.js";
import { LocalFilesystemByteStore } from "./archive/local-filesystem-byte-store.js";
import { PostgresIndexedArchiveStorage } from "./archive/postgres-indexed.storage.js";
import { getPrisma } from "./prisma/client.js";
import { createRepositories } from "./prisma/create-repositories.js";
import { PrismaDatabaseHealth } from "./prisma/prisma-database-health.js";
import { PrismaUnitOfWork } from "./prisma/unit-of-work.js";

export function createEngine(env: Env) {
  const prisma = getPrisma();
  const repos = createRepositories(prisma);
  const byteStore = new LocalFilesystemByteStore(env.ARCHIVE_ROOT);
  const archiveStorage = new PostgresIndexedArchiveStorage(byteStore, repos.archives);
  const archive = new ArchiveService(archiveStorage);
  const uow = new PrismaUnitOfWork(prisma);
  const persist = new PersistLegalDocumentService(uow);
  const citations = new CorpusCitationValidator(repos.citations);
  const retrieval = new CorpusRetrieval(repos);
  const databaseHealth = new PrismaDatabaseHealth(prisma);

    return {
      prisma,
      repos,
      archiveStorage,
      archive,
      persist,
      citations,
      retrieval,
      databaseHealth,
      uow,
    };
}
