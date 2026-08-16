export const LegalNodeType = {
  DOCUMENT: "DOCUMENT",
  BOOK: "BOOK",
  PART: "PART",
  CHAPTER: "CHAPTER",
  SECTION: "SECTION",
  ARTICLE: "ARTICLE",
  PARAGRAPH: "PARAGRAPH",
  CLAUSE: "CLAUSE",
  SUB_CLAUSE: "SUB_CLAUSE",
  ANNEX: "ANNEX",
} as const;

export type LegalNodeType = (typeof LegalNodeType)[keyof typeof LegalNodeType];

export const CitationStatus = {
  VALID: "VALID",
  UNRESOLVED: "UNRESOLVED",
  CONFLICT: "CONFLICT",
} as const;

export type CitationStatus = (typeof CitationStatus)[keyof typeof CitationStatus];

export const DocumentStatus = {
  DRAFT: "DRAFT",
  IN_FORCE: "IN_FORCE",
  AMENDED: "AMENDED",
  REPEALED: "REPEALED",
  SUPERSEDED: "SUPERSEDED",
  UNKNOWN: "UNKNOWN",
} as const;

export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const DocumentType = {
  LAW: "LAW",
  REGULATION: "REGULATION",
  GOVERNMENT_RESOLUTION: "GOVERNMENT_RESOLUTION",
  MINISTERIAL_ORDER: "MINISTERIAL_ORDER",
  SUPREME_COURT_DECISION: "SUPREME_COURT_DECISION",
  CONSTITUTIONAL_COURT_DECISION: "CONSTITUTIONAL_COURT_DECISION",
  TREATY: "TREATY",
  INTERPRETATION: "INTERPRETATION",
  OTHER: "OTHER",
} as const;

export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const VersionStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  SUPERSEDED: "SUPERSEDED",
  WITHDRAWN: "WITHDRAWN",
} as const;

export type VersionStatus = (typeof VersionStatus)[keyof typeof VersionStatus];

export const SourceType = {
  LEGISLATION: "LEGISLATION",
  REGULATION: "REGULATION",
  GOVERNMENT_RESOLUTION: "GOVERNMENT_RESOLUTION",
  MINISTERIAL_ORDER: "MINISTERIAL_ORDER",
  SUPREME_COURT: "SUPREME_COURT",
  CONSTITUTIONAL_COURT: "CONSTITUTIONAL_COURT",
  TREATY: "TREATY",
  INTERPRETATION: "INTERPRETATION",
  OTHER: "OTHER",
} as const;

export type SourceType = (typeof SourceType)[keyof typeof SourceType];

export const TrustLevel = {
  OFFICIAL: "OFFICIAL",
  SECONDARY: "SECONDARY",
  UNVERIFIED: "UNVERIFIED",
} as const;

export type TrustLevel = (typeof TrustLevel)[keyof typeof TrustLevel];

export const RelationType = {
  AMENDS: "AMENDS",
  REPEALS: "REPEALS",
  SUPERSEDES: "SUPERSEDES",
  IMPLEMENTS: "IMPLEMENTS",
  INTERPRETS: "INTERPRETS",
  CITES: "CITES",
  CONTAINS: "CONTAINS",
} as const;

export type RelationType = (typeof RelationType)[keyof typeof RelationType];

export const IngestJobType = {
  FETCH: "FETCH",
  PARSE: "PARSE",
  INDEX: "INDEX",
  REVALIDATE: "REVALIDATE",
} as const;

export type IngestJobType = (typeof IngestJobType)[keyof typeof IngestJobType];

export const IngestJobStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type IngestJobStatus = (typeof IngestJobStatus)[keyof typeof IngestJobStatus];

export const ParseReviewStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  NEEDS_REVISION: "NEEDS_REVISION",
} as const;

export type ParseReviewStatus =
  (typeof ParseReviewStatus)[keyof typeof ParseReviewStatus];
