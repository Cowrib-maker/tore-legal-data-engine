import type {
  ArchiveRecord as PrismaArchive,
  CitationEntry,
  EngineAuditLog as PrismaAudit,
  IngestJob as PrismaIngestJob,
  LegalDocument as PrismaDocument,
  LegalDocumentVersion as PrismaVersion,
  LegalNode as PrismaNode,
  LegalRelation as PrismaRelation,
  LegalSource as PrismaSource,
  ParseReview as PrismaReview,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { ArchiveRecord } from "../../domain/ports/archive-storage.js";
import type {
  CitationRecord,
  EngineAuditLog,
  IngestJob,
  JsonObject,
  LegalDocument,
  LegalDocumentVersion,
  LegalNode,
  LegalRelation,
  LegalSource,
  ParseReview,
} from "../../domain/entities.js";

export function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function fromIso(value: string | null | undefined): Date | null {
  if (value == null || value === "") {
    return null;
  }
  return new Date(value);
}

export function asJsonObject(value: Prisma.JsonValue | null): JsonObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

export function toJsonInput(
  value: JsonObject | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

export function mapSource(row: PrismaSource): LegalSource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    authority: row.authority,
    jurisdiction: row.jurisdiction,
    baseUrl: row.baseUrl,
    trustLevel: row.trustLevel,
    isActive: row.isActive,
    lastCheckedAt: toIso(row.lastCheckedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapArchive(row: PrismaArchive): ArchiveRecord {
  return {
    archiveId: row.id,
    sha256: row.sha256,
    originalUrl: row.originalUrl,
    retrievedAt: row.retrievedAt.toISOString(),
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    storageKey: row.storageKey,
    originalFileName: row.originalFileName,
    encoding: row.encoding ?? undefined,
    sourceId: row.sourceId,
  };
}

export function mapDocument(row: PrismaDocument): LegalDocument {
  return {
    id: row.id,
    sourceId: row.sourceId,
    documentType: row.documentType,
    title: row.title,
    documentNumber: row.documentNumber,
    issuingAuthority: row.issuingAuthority,
    jurisdiction: row.jurisdiction,
    adoptedAt: toIso(row.adoptedAt),
    canonicalUrl: row.canonicalUrl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    versions: [],
  };
}

export function mapVersion(row: PrismaVersion): LegalDocumentVersion {
  return {
    id: row.id,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    effectiveFrom: toIso(row.effectiveFrom),
    effectiveTo: toIso(row.effectiveTo),
    contentHash: row.contentHash,
    parserId: row.parserId,
    status: row.status,
    amendmentDocumentId: row.amendmentDocumentId,
    archiveRecordId: row.archiveRecordId,
    nodes: [],
  };
}

export function mapNode(row: PrismaNode): Omit<LegalNode, "children"> {
  return {
    id: row.id,
    documentVersionId: row.documentVersionId,
    parentId: row.parentId,
    nodeType: row.nodeType,
    book: row.book,
    part: row.part,
    chapter: row.chapter,
    section: row.section,
    article: row.article,
    paragraph: row.paragraph,
    clause: row.clause,
    subClause: row.subClause,
    number: row.number,
    title: row.title,
    text: row.text,
    sourceLocator: row.sourceLocator,
    contentHash: row.contentHash,
  };
}

export function mapRelation(row: PrismaRelation): LegalRelation {
  return {
    id: row.id,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    relationType: row.relationType,
    metadata: asJsonObject(row.metadata),
  };
}

export function mapCitation(row: CitationEntry): CitationRecord {
  return {
    id: row.id,
    documentVersionId: row.documentVersionId,
    legalNodeId: row.legalNodeId,
    citationKey: row.citationKey,
    locator: row.locator,
    exactText: row.exactText,
    sourceUrl: row.sourceUrl,
    contentHash: row.contentHash,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapIngestJob(row: PrismaIngestJob): IngestJob {
  return {
    id: row.id,
    sourceId: row.sourceId,
    jobType: row.jobType,
    status: row.status,
    url: row.url,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    error: row.error,
    retryCount: row.retryCount,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapParseReview(row: PrismaReview): ParseReview {
  return {
    id: row.id,
    documentId: row.documentId,
    archiveRecordId: row.archiveRecordId,
    status: row.status,
    reason: row.reason,
    parsedPayload: asJsonObject(row.parsedPayload) ?? {},
    reviewedBy: row.reviewedBy,
    reviewedAt: toIso(row.reviewedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapAudit(row: PrismaAudit): EngineAuditLog {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export function isOverlapViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("published_no_overlap") ||
    message.includes("23P01") ||
    message.includes("exclusion")
  );
}
