import type { ArchiveRecord } from "./archive-storage.js";
import type {
  CitationMatch,
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
} from "../entities.js";
import type {
  CitationStatus,
  DocumentStatus,
  DocumentType,
  IngestJobType,
  ParseReviewStatus,
  RelationType,
  SourceType,
  TrustLevel,
  VersionStatus,
} from "../enums.js";

export type SaveLegalSource = {
  id?: string;
  name: string;
  type: SourceType;
  authority: string;
  jurisdiction: string;
  baseUrl: string;
  trustLevel: TrustLevel;
  isActive?: boolean;
  lastCheckedAt?: string | null;
};

export interface LegalSourceRepository {
  save(input: SaveLegalSource): Promise<LegalSource>;
  findById(id: string): Promise<LegalSource | null>;
}

export type SaveLegalDocument = {
  id?: string;
  sourceId: string;
  documentType: DocumentType;
  title: string;
  documentNumber: string | null;
  issuingAuthority: string;
  jurisdiction: string;
  adoptedAt: string | null;
  canonicalUrl: string;
  status: DocumentStatus;
};

export interface LegalDocumentRepository {
  save(input: SaveLegalDocument): Promise<LegalDocument>;
  findById(id: string): Promise<LegalDocument | null>;
  findBySourceAndCanonicalUrl(
    sourceId: string,
    canonicalUrl: string,
  ): Promise<LegalDocument | null>;
}

export type SaveLegalDocumentVersion = {
  id?: string;
  documentId: string;
  versionNumber: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  contentHash: string;
  parserId: string;
  status: VersionStatus;
  amendmentDocumentId: string | null;
  archiveRecordId: string;
};

export interface LegalDocumentVersionRepository {
  save(input: SaveLegalDocumentVersion): Promise<LegalDocumentVersion>;
  findById(id: string): Promise<LegalDocumentVersion | null>;
  listByDocumentId(documentId: string): Promise<LegalDocumentVersion[]>;
  findPublishedForDocument(
    documentId: string,
    asOf?: string | null,
  ): Promise<LegalDocumentVersion | null>;
  findByDocumentContentHashAndParserId(
    documentId: string,
    contentHash: string,
    parserId: string,
  ): Promise<LegalDocumentVersion | null>;
}

export interface LegalNodeRepository {
  replaceForVersion(
    documentVersionId: string,
    tree: readonly LegalNode[],
  ): Promise<LegalNode[]>;
  findById(id: string): Promise<LegalNode | null>;
  findByLocator(
    documentVersionId: string,
    sourceLocator: string,
  ): Promise<LegalNode | null>;
  findTreeByVersion(documentVersionId: string): Promise<LegalNode[]>;
}

export type SaveLegalRelation = {
  id?: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: RelationType;
  metadata?: JsonObject | null;
};

export interface LegalRelationRepository {
  save(input: SaveLegalRelation): Promise<LegalRelation>;
  findByFromNode(fromNodeId: string): Promise<LegalRelation[]>;
}

export type SaveCitation = {
  id?: string;
  documentVersionId: string;
  legalNodeId: string;
  citationKey: string;
  locator: string;
  exactText: string;
  sourceUrl: string;
  contentHash: string;
  status: CitationStatus;
};

export type CitationLookup = {
  query: string;
  nodeId?: string | null;
  documentId?: string | null;
  locator?: string | null;
  citationKey?: string | null;
  titleHint?: string | null;
  article?: string | null;
  paragraph?: string | null;
  asOf?: string | null;
};

export interface CitationRepository {
  save(input: SaveCitation): Promise<CitationRecord>;
  findById(id: string): Promise<CitationRecord | null>;
  findByCitationKey(citationKey: string): Promise<CitationRecord[]>;
  findPublishedMatches(lookup: CitationLookup): Promise<CitationMatch[]>;
}

export type SaveIngestJob = {
  id?: string;
  sourceId: string;
  jobType: IngestJobType;
  url?: string | null;
  metadata?: JsonObject | null;
};

export interface IngestJobRepository {
  create(input: SaveIngestJob): Promise<IngestJob>;
  findById(id: string): Promise<IngestJob | null>;
  markRunning(id: string): Promise<IngestJob>;
  markSucceeded(id: string): Promise<IngestJob>;
  markFailed(id: string, error: string): Promise<IngestJob>;
}

export type SaveParseReview = {
  id?: string;
  documentId: string;
  archiveRecordId: string;
  status?: ParseReviewStatus;
  reason: string;
  parsedPayload: JsonObject;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
};

export interface ParseReviewRepository {
  save(input: SaveParseReview): Promise<ParseReview>;
  findById(id: string): Promise<ParseReview | null>;
  listByDocumentId(documentId: string): Promise<ParseReview[]>;
}

export type SaveEngineAuditLog = {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: JsonObject | null;
};

export interface EngineAuditLogRepository {
  append(input: SaveEngineAuditLog): Promise<EngineAuditLog>;
  listByEntity(entityType: string, entityId: string): Promise<EngineAuditLog[]>;
}

export type SaveArchiveRecord = {
  id?: string;
  sourceId?: string | null;
  sha256: string;
  originalUrl: string;
  retrievedAt: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  originalFileName: string;
  encoding?: string | null;
};

export interface ArchiveRecordRepository {
  create(input: SaveArchiveRecord): Promise<ArchiveRecord>;
  findBySha256(sha256: string): Promise<ArchiveRecord | null>;
  findById(id: string): Promise<ArchiveRecord | null>;
}

export type EngineRepositories = {
  sources: LegalSourceRepository;
  documents: LegalDocumentRepository;
  versions: LegalDocumentVersionRepository;
  nodes: LegalNodeRepository;
  relations: LegalRelationRepository;
  citations: CitationRepository;
  ingestJobs: IngestJobRepository;
  parseReviews: ParseReviewRepository;
  auditLogs: EngineAuditLogRepository;
  archives: ArchiveRecordRepository;
};

export interface UnitOfWork {
  run<T>(work: (repos: EngineRepositories) => Promise<T>): Promise<T>;
}

export interface DatabaseHealth {
  ping(): Promise<{ ok: boolean; storage: string; detail: string }>;
}
