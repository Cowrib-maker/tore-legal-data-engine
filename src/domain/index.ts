export {
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
export type {
  CitationCandidate,
  CitationMatch,
  CitationRecord,
  CitationVerdict,
  EngineAuditLog,
  IngestJob,
  LegalDocument,
  LegalDocumentVersion,
  LegalNode,
  LegalRelation,
  LegalSource,
  ParseReview,
  Provenance,
} from "./entities.js";
export { DomainError, IngestError, InvariantError } from "./errors.js";
export {
  assembleLegalNodeTree,
  assertLegalNodeHierarchy,
  flattenLegalNodes,
} from "./services/legal-node-hierarchy.js";
export {
  assertDocumentVersion,
  versionsDoNotOverlap,
} from "./services/document-version.js";
export {
  classifyCitationMatches,
  isAuthoritativeCitation,
  refuseIfNotValid,
} from "./services/citation-status.js";
export * from "./ports/index.js";
