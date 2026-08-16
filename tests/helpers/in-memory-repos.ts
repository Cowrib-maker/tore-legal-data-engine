import { randomUUID } from "node:crypto";

import type {
  CitationMatch,
  CitationRecord,
  EngineAuditLog,
  IngestJob,
  LegalDocument,
  LegalDocumentVersion,
  LegalNode,
  LegalRelation,
  LegalSource,
  ParseReview,
} from "../../src/domain/entities.js";
import {
  IngestJobStatus,
  ParseReviewStatus,
  VersionStatus,
} from "../../src/domain/enums.js";
import { versionCoversInstant } from "../../src/domain/services/document-version.js";
import type { ArchiveRecord } from "../../src/domain/ports/archive-storage.js";
import type {
  ArchiveRecordRepository,
  CitationLookup,
  CitationRepository,
  EngineAuditLogRepository,
  EngineRepositories,
  IngestJobRepository,
  LegalDocumentRepository,
  LegalDocumentVersionRepository,
  LegalNodeRepository,
  LegalRelationRepository,
  LegalSourceRepository,
  ParseReviewRepository,
  SaveArchiveRecord,
  SaveCitation,
  SaveEngineAuditLog,
  SaveIngestJob,
  SaveLegalDocument,
  SaveLegalDocumentVersion,
  SaveLegalRelation,
  SaveLegalSource,
  SaveParseReview,
  UnitOfWork,
} from "../../src/domain/ports/repositories.js";
import {
  assembleLegalNodeTree,
  flattenLegalNodes,
} from "../../src/domain/services/legal-node-hierarchy.js";

export function createInMemoryRepositories(): {
  repos: EngineRepositories;
  uow: UnitOfWork;
} {
  const sources = new Map<string, LegalSource>();
  const documents = new Map<string, LegalDocument>();
  const versions = new Map<string, LegalDocumentVersion>();
  const nodes = new Map<string, LegalNode>();
  const citations = new Map<string, CitationRecord>();
  const jobs = new Map<string, IngestJob>();
  const reviews = new Map<string, ParseReview>();
  const audits: EngineAuditLog[] = [];
  const archives = new Map<string, ArchiveRecord>();
  const relations = new Map<string, LegalRelation>();

  const repos: EngineRepositories = {
    sources: {
      async save(input: SaveLegalSource) {
        const id = input.id ?? randomUUID();
        const now = new Date().toISOString();
        const row: LegalSource = {
          id,
          name: input.name,
          type: input.type,
          authority: input.authority,
          jurisdiction: input.jurisdiction,
          baseUrl: input.baseUrl,
          trustLevel: input.trustLevel,
          isActive: input.isActive ?? true,
          lastCheckedAt: input.lastCheckedAt ?? null,
          createdAt: sources.get(id)?.createdAt ?? now,
          updatedAt: now,
        };
        sources.set(id, row);
        return row;
      },
      async findById(id) {
        return sources.get(id) ?? null;
      },
    } satisfies LegalSourceRepository,
    documents: {
      async save(input: SaveLegalDocument) {
        const id = input.id ?? randomUUID();
        const now = new Date().toISOString();
        const row: LegalDocument = {
          ...input,
          id,
          createdAt: documents.get(id)?.createdAt ?? now,
          updatedAt: now,
          versions: [],
        };
        documents.set(id, row);
        return row;
      },
      async findById(id) {
        return documents.get(id) ?? null;
      },
      async findBySourceAndCanonicalUrl(sourceId, canonicalUrl) {
        return (
          [...documents.values()].find(
            (item) => item.sourceId === sourceId && item.canonicalUrl === canonicalUrl,
          ) ?? null
        );
      },
    } satisfies LegalDocumentRepository,
    versions: {
      async save(input: SaveLegalDocumentVersion) {
        const id = input.id ?? randomUUID();
        const row: LegalDocumentVersion = { ...input, id, nodes: [] };
        versions.set(id, row);
        return row;
      },
      async findById(id) {
        return versions.get(id) ?? null;
      },
      async listByDocumentId(documentId) {
        return [...versions.values()]
          .filter((item) => item.documentId === documentId)
          .sort((a, b) => a.versionNumber - b.versionNumber);
      },
      async findPublishedForDocument(documentId, asOf) {
        const instant = asOf ?? new Date().toISOString();
        return (
          [...versions.values()]
            .filter((item) => item.documentId === documentId)
            .filter((item) =>
              asOf
                ? (item.status === VersionStatus.PUBLISHED ||
                    item.status === VersionStatus.SUPERSEDED) &&
                  versionCoversInstant(item, instant)
                : item.status === VersionStatus.PUBLISHED,
            )
            .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
        );
      },
      async findByDocumentContentHashAndParserId(documentId, contentHash, parserId) {
        return (
          [...versions.values()].find(
            (item) =>
              item.documentId === documentId &&
              item.contentHash === contentHash &&
              item.parserId === parserId,
          ) ?? null
        );
      },
    } satisfies LegalDocumentVersionRepository,
    nodes: {
      async replaceForVersion(documentVersionId, tree) {
        for (const [id, node] of nodes) {
          if (node.documentVersionId === documentVersionId) {
            nodes.delete(id);
          }
        }
        const flat = flattenLegalNodes(tree as LegalNode[]).map((node) => ({
          ...node,
          documentVersionId,
        }));
        for (const node of flat) {
          nodes.set(node.id, node);
        }
        return assembleLegalNodeTree(flat);
      },
      async findById(id) {
        return nodes.get(id) ?? null;
      },
      async findByLocator(documentVersionId, sourceLocator) {
        return (
          [...nodes.values()].find(
            (item) =>
              item.documentVersionId === documentVersionId && item.sourceLocator === sourceLocator,
          ) ?? null
        );
      },
      async findTreeByVersion(documentVersionId) {
        return assembleLegalNodeTree(
          [...nodes.values()].filter((item) => item.documentVersionId === documentVersionId),
        );
      },
    } satisfies LegalNodeRepository,
    relations: {
      async save(input: SaveLegalRelation) {
        const id = input.id ?? randomUUID();
        const row: LegalRelation = {
          id,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          relationType: input.relationType,
          metadata: input.metadata ?? null,
        };
        relations.set(id, row);
        return row;
      },
      async findByFromNode(fromNodeId) {
        return [...relations.values()].filter((item) => item.fromNodeId === fromNodeId);
      },
    } satisfies LegalRelationRepository,
    citations: {
      async save(input: SaveCitation) {
        const id = input.id ?? randomUUID();
        const now = new Date().toISOString();
        const row: CitationRecord = { ...input, id, createdAt: now, updatedAt: now };
        citations.set(id, row);
        return row;
      },
      async findById(id) {
        return citations.get(id) ?? null;
      },
      async findByCitationKey(citationKey) {
        return [...citations.values()].filter((item) => item.citationKey === citationKey);
      },
      async findPublishedMatches(lookup: CitationLookup) {
        const matches: CitationMatch[] = [];
        for (const citation of citations.values()) {
          const version = versions.get(citation.documentVersionId);
          if (!version) {
            continue;
          }
          if (lookup.asOf) {
            if (
              version.status !== VersionStatus.PUBLISHED &&
              version.status !== VersionStatus.SUPERSEDED
            ) {
              continue;
            }
            if (!versionCoversInstant(version, lookup.asOf)) {
              continue;
            }
          } else if (version.status !== VersionStatus.PUBLISHED) {
            continue;
          }
          const document = documents.get(version.documentId);
          const node = nodes.get(citation.legalNodeId);
          if (lookup.documentId && version.documentId !== lookup.documentId) {
            continue;
          }
          if (
            lookup.titleHint &&
            document &&
            !document.title.toLocaleLowerCase("mn").includes(lookup.titleHint.toLocaleLowerCase("mn"))
          ) {
            continue;
          }
          const hit =
            citation.citationKey === lookup.query ||
            citation.locator === lookup.query ||
            citation.legalNodeId === lookup.nodeId ||
            (lookup.citationKey && citation.citationKey === lookup.citationKey) ||
            (lookup.locator && citation.locator === lookup.locator);
          if (!hit) {
            continue;
          }
          matches.push({
            citation,
            documentId: version.documentId,
            documentVersionId: version.id,
            versionStatus: version.status,
            effectiveFrom: version.effectiveFrom,
            effectiveTo: version.effectiveTo,
            parserId: version.parserId,
            sourceContentHash: version.contentHash,
            archiveRecordId: version.archiveRecordId,
            nodeId: citation.legalNodeId,
            locator: citation.locator,
            title: node?.title ?? null,
            excerpt: citation.exactText.slice(0, 500),
            contentHash: citation.contentHash,
          });
        }
        return matches;
      },
    } satisfies CitationRepository,
    ingestJobs: {
      async create(input: SaveIngestJob) {
        const id = input.id ?? randomUUID();
        const row: IngestJob = {
          id,
          sourceId: input.sourceId,
          jobType: input.jobType,
          status: IngestJobStatus.PENDING,
          url: input.url ?? null,
          startedAt: null,
          completedAt: null,
          error: null,
          retryCount: 0,
          metadata: input.metadata ?? null,
          createdAt: new Date().toISOString(),
        };
        jobs.set(id, row);
        return row;
      },
      async findById(id) {
        return jobs.get(id) ?? null;
      },
      async markRunning(id) {
        const row = jobs.get(id)!;
        const next = {
          ...row,
          status: IngestJobStatus.RUNNING,
          startedAt: new Date().toISOString(),
        };
        jobs.set(id, next);
        return next;
      },
      async markSucceeded(id) {
        const row = jobs.get(id)!;
        const next = {
          ...row,
          status: IngestJobStatus.SUCCEEDED,
          completedAt: new Date().toISOString(),
        };
        jobs.set(id, next);
        return next;
      },
      async markFailed(id, error) {
        const row = jobs.get(id)!;
        const next = {
          ...row,
          status: IngestJobStatus.FAILED,
          completedAt: new Date().toISOString(),
          error,
          retryCount: row.retryCount + 1,
        };
        jobs.set(id, next);
        return next;
      },
    } satisfies IngestJobRepository,
    parseReviews: {
      async save(input: SaveParseReview) {
        const id = input.id ?? randomUUID();
        const row: ParseReview = {
          id,
          documentId: input.documentId,
          archiveRecordId: input.archiveRecordId,
          status: input.status ?? ParseReviewStatus.PENDING,
          reason: input.reason,
          parsedPayload: input.parsedPayload,
          reviewedBy: input.reviewedBy ?? null,
          reviewedAt: input.reviewedAt ?? null,
          createdAt: new Date().toISOString(),
        };
        reviews.set(id, row);
        return row;
      },
      async findById(id) {
        return reviews.get(id) ?? null;
      },
      async listByDocumentId(documentId) {
        return [...reviews.values()].filter((item) => item.documentId === documentId);
      },
    } satisfies ParseReviewRepository,
    auditLogs: {
      async append(input: SaveEngineAuditLog) {
        const row: EngineAuditLog = {
          id: randomUUID(),
          actor: input.actor,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          metadata: input.metadata ?? null,
          createdAt: new Date().toISOString(),
        };
        audits.push(row);
        return row;
      },
      async listByEntity(entityType, entityId) {
        return audits.filter(
          (item) => item.entityType === entityType && item.entityId === entityId,
        );
      },
    } satisfies EngineAuditLogRepository,
    archives: {
      async create(input: SaveArchiveRecord) {
        const existing = [...archives.values()].find((item) => item.sha256 === input.sha256);
        if (existing) {
          return existing;
        }
        const record: ArchiveRecord = {
          archiveId: input.id ?? randomUUID(),
          sha256: input.sha256,
          originalUrl: input.originalUrl,
          retrievedAt: input.retrievedAt,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          storageKey: input.storageKey,
          originalFileName: input.originalFileName,
          encoding: input.encoding ?? undefined,
          sourceId: input.sourceId ?? null,
        };
        archives.set(record.archiveId, record);
        return record;
      },
      async findBySha256(sha256) {
        return [...archives.values()].find((item) => item.sha256 === sha256) ?? null;
      },
      async findById(id) {
        return archives.get(id) ?? null;
      },
    } satisfies ArchiveRecordRepository,
  };

  return {
    repos,
    uow: {
      run: (work) => work(repos),
    },
  };
}
