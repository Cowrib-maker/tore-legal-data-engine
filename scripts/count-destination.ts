/**
 * READ-ONLY. Prints current engine-destination row counts for the tables the
 * legacy migration touches. No writes anywhere.
 *
 * USAGE: npx tsx scripts/count-destination.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main(): Promise<void> {
  const counts = {
    legalSource: await db.legalSource.count(),
    archiveRecord: await db.archiveRecord.count(),
    legalDocument: await db.legalDocument.count(),
    legalDocumentVersion: await db.legalDocumentVersion.count(),
    legalNode: await db.legalNode.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
