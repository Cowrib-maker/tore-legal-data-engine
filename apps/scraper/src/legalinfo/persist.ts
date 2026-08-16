import {
  getPrisma,
  type Document,
  type ImportOperation,
  type Prisma,
  type Source,
} from "@tore-legal-data-engine/db";

import type { DiscoveredDocument } from "./metadata.js";
import { LEGALINFO_COUNTRY, LEGALINFO_OFFICIAL_URL, LEGALINFO_SOURCE_NAME } from "./catalog.js";

export type PersistOutcome = "inserted" | "updated" | "duplicate";

export async function ensureLegalInfoSource(): Promise<Source> {
  const prisma = getPrisma();
  return prisma.source.upsert({
    where: { officialUrl: LEGALINFO_OFFICIAL_URL },
    create: {
      name: LEGALINFO_SOURCE_NAME,
      country: LEGALINFO_COUNTRY,
      sourceType: "OFFICIAL_SOURCE",
      officialUrl: LEGALINFO_OFFICIAL_URL,
      enabled: true,
    },
    update: {
      name: LEGALINFO_SOURCE_NAME,
      country: LEGALINFO_COUNTRY,
      sourceType: "OFFICIAL_SOURCE",
      enabled: true,
      deletedAt: null,
    },
  });
}

export async function persistDiscoveredDocument(params: {
  sourceId: string;
  crawlJobId: string;
  document: DiscoveredDocument;
  httpStatus: number;
}): Promise<{ outcome: PersistOutcome; document: Document }> {
  const prisma = getPrisma();
  const metadataJson: Prisma.InputJsonValue = {
    htmlAvailable: params.document.htmlAvailable,
    pdfAvailable: params.document.pdfAvailable,
    categoryId: params.document.categoryId,
    lawId: params.document.lawId,
    language: params.document.language,
  };

  const existing = await prisma.document.findUnique({
    where: {
      sourceId_externalId_version: {
        sourceId: params.sourceId,
        externalId: params.document.lawId,
        version: 1,
      },
    },
  });

  let outcome: PersistOutcome;
  let document: Document;

  if (existing && existing.checksum === params.document.checksum && existing.deletedAt === null) {
    outcome = "duplicate";
    document = existing;
  } else if (existing) {
    outcome = "updated";
    document = await prisma.document.update({
      where: { id: existing.id },
      data: documentFields(params.document, metadataJson),
    });
    await writeImportLog(document.id, "UPDATE", params.document);
  } else {
    outcome = "inserted";
    document = await prisma.document.create({
      data: {
        sourceId: params.sourceId,
        externalId: params.document.lawId,
        version: 1,
        jurisdiction: LEGALINFO_COUNTRY,
        ...documentFields(params.document, metadataJson),
      },
    });
    await writeImportLog(document.id, "INSERT", params.document);
  }

  const existingResult = await prisma.crawlResult.findFirst({
    where: {
      crawlJobId: params.crawlJobId,
      url: params.document.sourceUrl,
    },
    select: { id: true },
  });

  if (!existingResult) {
    await prisma.crawlResult.create({
      data: {
        crawlJobId: params.crawlJobId,
        documentId: document.id,
        url: params.document.sourceUrl,
        httpStatus: params.httpStatus,
        checksum: params.document.checksum,
        contentType: "text/html",
        downloadedAt: new Date(),
      },
    });
  }

  return { outcome, document };
}

function documentFields(document: DiscoveredDocument, metadataJson: Prisma.InputJsonValue) {
  return {
    title: document.title,
    documentNumber: document.documentNumber,
    documentType: document.documentType,
    language: document.language,
    issuedDate: document.issuedDate,
    effectiveDate: document.effectiveDate,
    validFrom: document.effectiveDate,
    status: document.status,
    checksum: document.checksum,
    officialUrl: document.sourceUrl,
    metadataJson,
    deletedAt: null,
  };
}

async function writeImportLog(
  documentId: string,
  operation: ImportOperation,
  document: DiscoveredDocument,
): Promise<void> {
  const prisma = getPrisma();
  await prisma.importLog.create({
    data: {
      documentId,
      operation,
      detailsJson: {
        sourceUrl: document.sourceUrl,
        checksum: document.checksum,
        categoryId: document.categoryId,
      },
    },
  });
}
