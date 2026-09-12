import type {
  CitationStatus,
  DocumentStatus,
  DocumentType,
  IngestJobStatus,
  IngestJobType,
  LegalNodeType,
  ParseReviewStatus,
  RelationType,
  SourceType,
  TrustLevel,
  VersionStatus,
} from "./enums.js";

/**
 * One ranked open-question retrieval candidate. `score` is a raw SQL-side
 * blend (ts_rank_cd + trigram similarity) with no fixed scale/meaning
 * outside the query that produced it — never persisted, never compared
 * across separate queries.
 */
export type LegalNodeSearchCandidate = {
  node: Omit<LegalNode, "children">;
  documentId: string;
  versionId: string;
  versionStatus: VersionStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceContentHash: string;
  parserId: string;
  archiveRecordId: string;
  score: number;
};

/** Pointer back to the immutable archived original. No PII. */
export type Provenance = {
  sourceId: string;
  archiveRecordId: string;
  originalUrl: string;
  retrievedAt: string;
  contentHash: string;
  mimeType: string;
};

export type LegalNode = {
  id: string;
  documentVersionId: string;
  parentId: string | null;
  nodeType: LegalNodeType;
  book: string | null;
  part: string | null;
  chapter: string | null;
  section: string | null;
  article: string | null;
  paragraph: string | null;
  clause: string | null;
  subClause: string | null;
  number: string | null;
  title: string | null;
  text: string;
  sourceLocator: string;
  contentHash: string;
  children: LegalNode[];
};

export type LegalDocumentVersion = {
  id: string;
  documentId: string;
  versionNumber: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** SHA-256 of immutable source/archive bytes (not the canonical tree). */
  contentHash: string;
  /** Parser/canonicalization identity, e.g. legalinfo-html-v1. */
  parserId: string;
  status: VersionStatus;
  amendmentDocumentId: string | null;
  archiveRecordId: string;
  nodes: LegalNode[];
};

export type LegalDocument = {
  id: string;
  sourceId: string;
  documentType: DocumentType;
  title: string;
  documentNumber: string | null;
  issuingAuthority: string;
  jurisdiction: string;
  adoptedAt: string | null;
  canonicalUrl: string;
  status: DocumentStatus;
  createdAt?: string;
  updatedAt?: string;
  versions: LegalDocumentVersion[];
  provenance?: Provenance;
};

export type JsonObject = Record<string, unknown>;

export type LegalSource = {
  id: string;
  name: string;
  type: SourceType;
  authority: string;
  jurisdiction: string;
  baseUrl: string;
  trustLevel: TrustLevel;
  isActive: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LegalRelation = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: RelationType;
  metadata: JsonObject | null;
};

export type CitationRecord = {
  id: string;
  documentVersionId: string;
  legalNodeId: string;
  citationKey: string;
  locator: string;
  exactText: string;
  sourceUrl: string;
  contentHash: string;
  status: CitationStatus;
  createdAt: string;
  updatedAt: string;
};

export type CitationMatch = {
  citation: CitationRecord;
  documentId: string;
  documentVersionId: string;
  versionStatus: VersionStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Parser/canonicalization identity of the matched version. */
  parserId: string;
  /** SHA-256 of the version's source/archive bytes. */
  sourceContentHash: string;
  archiveRecordId: string;
  nodeId: string;
  locator: string;
  title: string | null;
  excerpt: string;
  contentHash: string;
};

export type IngestJob = {
  id: string;
  sourceId: string;
  jobType: IngestJobType;
  status: IngestJobStatus;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  retryCount: number;
  metadata: JsonObject | null;
  createdAt: string;
};

export type ParseReview = {
  id: string;
  documentId: string;
  archiveRecordId: string;
  status: ParseReviewStatus;
  reason: string;
  parsedPayload: JsonObject;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type EngineAuditLog = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: JsonObject | null;
  createdAt: string;
};

export type CitationCandidate = {
  query: string;
  nodeId?: string | null;
  documentId?: string | null;
  locator?: string | null;
  asOf?: string | null;
};

export type CitationVerdict = {
  query: string;
  status: CitationStatus;
  nodeId: string | null;
  documentVersionId: string | null;
  locator: string | null;
  reasons: string[];
};
