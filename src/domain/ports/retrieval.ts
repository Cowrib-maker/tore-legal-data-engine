export type RetrieveRequest = {
  question: string;
  citations?: Array<{ query: string; nodeId?: string | null }>;
  asOf?: string | null;
  documentId?: string | null;
  nodeId?: string | null;
  citationKey?: string | null;
  locator?: string | null;
};

export type RetrievedAuthority = {
  nodeId: string;
  documentId: string;
  documentVersionId: string;
  locator: string;
  title: string;
  excerpt: string;
  /** Node text hash. */
  contentHash: string;
  /** SHA-256 of immutable source/archive bytes for this version. */
  sourceContentHash: string;
  parserId: string;
  archiveRecordId: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export const RetrieveStatus = {
  OK: "ok",
  PLACEHOLDER: "placeholder",
  AS_OF_UNAVAILABLE: "AS_OF_UNAVAILABLE",
} as const;

export type RetrieveStatus = (typeof RetrieveStatus)[keyof typeof RetrieveStatus];

export type RetrieveResponse = {
  authorities: RetrievedAuthority[];
  retrievedAt: string;
  status: RetrieveStatus;
};

export interface RetrievalPort {
  retrieve(request: RetrieveRequest): Promise<RetrieveResponse>;
}
