import { sha256Hex } from "../archive/hash.js";
import type { ArchiveService } from "../archive/archive.service.js";
import { persistWith } from "../legal-corpus/persist-document.js";
import type { UnitOfWork } from "../../domain/ports/repositories.js";
import { LEGALINFO_PARSER_ID } from "../../parsers/legalinfo/legalinfo-html.parser.js";
import { assessParseConfidence } from "../../parsers/legalinfo/confidence.js";
import { citationKeyForNode } from "../citations/parse-citation-query.js";
import {
  CitationStatus,
  DocumentStatus,
  IngestJobStatus,
  IngestJobType,
  LegalNodeType,
  ParseReviewStatus,
  SourceType,
  TrustLevel,
  VersionStatus,
} from "../../domain/enums.js";
import type { LegalDocument, LegalNode } from "../../domain/entities.js";
import {
  assertLegalNodeHierarchy,
  flattenLegalNodes,
} from "../../domain/services/legal-node-hierarchy.js";
import type { ILegalParser } from "../../domain/ports/legal-parser.js";
import type { ISourceConnector } from "../../domain/ports/source-connector.js";
import type { EngineRepositories } from "../../domain/ports/repositories.js";
import { detectFormat, validateSourceBytes } from "../../domain/services/source-document.js";
import { logIngest } from "../logging/structured-log.js";
import type { IngestCliOptions } from "./cli-args.js";
import { assessPublicationGate } from "./publication-gate.js";

const SOURCE_ID = "mn.legalinfo";
const ACTOR = "system/ingestion";

export type IngestRunResult = {
  dryRun: boolean;
  processed: number;
  published: number;
  unchanged: number;
  reviews: number;
  failures: number;
  jobId: string;
  documents: Array<{
    url: string;
    hash: string;
    outcome: string;
    documentId?: string;
    versionId?: string;
    parseReviewId?: string;
    shape?: ParseShape;
    httpStatus?: number;
    retrievedUrl?: string;
    mimeType?: string;
    byteSize?: number;
    title?: string;
    documentType?: string;
    confidenceOk?: boolean;
    confidenceReasons?: string[];
    parserWarnings?: string[];
    archiveId?: string;
  }>;
};

export type ParseShape = {
  nodes: number;
  articles: number;
  paragraphs: number;
  clauses: number;
  chapters: number;
  annexes: number;
  insertedArticles: number;
  duplicateLocators: number;
  hierarchyViolations: string[];
};

export class IngestLegalInfoService {
  constructor(
    private readonly deps: {
      connector: ISourceConnector;
      parser: ILegalParser;
      archive: ArchiveService;
      uow: UnitOfWork;
      repos: EngineRepositories;
    },
  ) {}

  async run(options: IngestCliOptions): Promise<IngestRunResult> {
    const job = await this.deps.repos.ingestJobs.create({
      sourceId: (await this.ensureSource()).id,
      jobType: IngestJobType.FETCH,
      url: options.url ?? null,
      metadata: { stage: "DISCOVERED", dryRun: options.dryRun, limit: options.limit },
    });
    await this.deps.repos.ingestJobs.markRunning(job.id);

    const result: IngestRunResult = {
      dryRun: options.dryRun,
      processed: 0,
      published: 0,
      unchanged: 0,
      reviews: 0,
      failures: 0,
      jobId: job.id,
      documents: [],
    };

    try {
      const discovered = await this.deps.connector.discover({
        limit: options.limit,
        url: options.url,
        lawId: options.lawId,
        lawIds: options.lawIds,
      });
      for (const act of discovered) {
        const started = Date.now();
        try {
          const item = await this.ingestOne(act.canonicalUrl, act.lawId, options.dryRun, job.id);
          result.processed += 1;
          if (item.outcome === "published") {
            result.published += 1;
          } else if (item.outcome === "unchanged") {
            result.unchanged += 1;
          } else if (item.outcome === "review") {
            result.reviews += 1;
          }
          result.documents.push(item);
          logIngest({
            source: SOURCE_ID,
            document: item.documentId ?? act.lawId,
            url: act.canonicalUrl,
            hash: item.hash,
            stage: item.outcome,
            duration: Date.now() - started,
            result: item.outcome,
          });
        } catch (error) {
          result.failures += 1;
          result.processed += 1;
          const message = error instanceof Error ? error.message : "ingest_failed";
          const code = (error as { code?: string }).code ?? "ingest_failed";
          await this.deps.repos.auditLogs.append({
            actor: ACTOR,
            action: "ingest.failed",
            entityType: "DiscoveredAct",
            entityId: act.lawId,
            metadata: { url: act.canonicalUrl, errorCode: code, message },
          });
          logIngest({
            source: SOURCE_ID,
            document: act.lawId,
            url: act.canonicalUrl,
            hash: null,
            stage: "FAILED",
            duration: Date.now() - started,
            result: "error",
            errorCode: code,
          });
        }
      }
      await this.deps.repos.ingestJobs.markSucceeded(job.id);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ingest_failed";
      await this.deps.repos.ingestJobs.markFailed(job.id, message);
      throw error;
    }
  }

  async republishFromArchive(options: IngestCliOptions): Promise<IngestRunResult> {
    const sha256 = options.fromArchive;
    if (!sha256) {
      throw Object.assign(new Error("from_archive_required"), { code: "from_archive_required" });
    }
    await this.ensureSource();
    const record = await this.deps.archive.findByHash(sha256);
    let bytes = await this.deps.archive.get(sha256);
    if (bytes && sha256Hex(bytes) !== sha256) {
      throw Object.assign(new Error("archive_hash_mismatch"), { code: "archive_hash_mismatch" });
    }
    let indexed = record;
    if (!indexed && bytes) {
      const originalUrl =
        options.url ??
        (options.lawId ? `https://legalinfo.mn/mn/detail?lawId=${options.lawId}` : null);
      if (!originalUrl || !options.retrievedAt) {
        throw Object.assign(
          new Error("archive_metadata_missing: provide --url and --retrieved-at to reindex existing bytes"),
          { code: "archive_metadata_missing" },
        );
      }
      const stored = await this.deps.archive.store(bytes, {
        originalUrl,
        retrievedAt: options.retrievedAt,
        mimeType: "text/html; charset=UTF-8",
        originalFileName: `${options.lawId ?? "legalinfo"}.html`,
        sourceId: SOURCE_ID,
      });
      indexed = stored.record;
      bytes = await this.deps.archive.get(sha256);
    }
    if (!indexed || !bytes) {
      throw Object.assign(new Error(`archive_not_found:${sha256}`), { code: "archive_not_found" });
    }
    if (indexed.sha256 !== sha256) {
      throw Object.assign(new Error("archive_hash_mismatch"), { code: "archive_hash_mismatch" });
    }

    const job = await this.deps.repos.ingestJobs.create({
      sourceId: (await this.ensureSource()).id,
      jobType: IngestJobType.PARSE,
      url: indexed.originalUrl,
      metadata: {
        stage: "ARCHIVED",
        dryRun: options.dryRun,
        fromArchive: sha256,
        parser: LEGALINFO_PARSER_ID,
      },
    });
    await this.deps.repos.ingestJobs.markRunning(job.id);

    const result: IngestRunResult = {
      dryRun: options.dryRun,
      processed: 0,
      published: 0,
      unchanged: 0,
      reviews: 0,
      failures: 0,
      jobId: job.id,
      documents: [],
    };

    try {
      const html = new TextDecoder("utf-8").decode(bytes);
      const parsed = await this.deps.parser.parse({
        html,
        bytes,
        sourceUrl: indexed.originalUrl,
        mimeType: indexed.mimeType,
      });
      if (!/^legalinfo-html-v\d+$/.test(this.deps.parser.id)) {
        throw Object.assign(new Error("unexpected_parser"), { code: "unexpected_parser" });
      }
      const lawId = lawIdFromUrl(indexed.originalUrl) ?? options.lawId ?? null;
      const confidence = assessParseConfidence(parsed);
      const shape = parseShape(parsed.versions[0]?.nodes ?? []);
      const expected = options.expectedShape;
      if (expected) {
        const mismatch =
          shape.articles !== expected.articles ||
          shape.paragraphs !== expected.paragraphs ||
          shape.clauses !== expected.clauses ||
          shape.nodes !== expected.nodes ||
          shape.duplicateLocators !== 0;
        if (mismatch) {
          throw Object.assign(
            new Error(`parse_shape_mismatch:${JSON.stringify({ shape, expected })}`),
            { code: "parse_shape_mismatch" },
          );
        }
      }
      const gate = assessPublicationGate({
        document: parsed,
        archiveSha256: sha256,
        bytesSha256: sha256Hex(bytes),
        lawId,
      });
      if (
        !gate.ok ||
        !confidence.ok ||
        shape.duplicateLocators !== 0 ||
        shape.hierarchyViolations.length > 0
      ) {
        const reasons = !gate.ok
          ? gate.reasons
          : confidence.ok
            ? [
                ...(shape.duplicateLocators ? ["duplicate_locators"] : []),
                ...(shape.hierarchyViolations.length ? ["broken_article_hierarchy"] : []),
              ]
            : confidence.reasons;
        const review = await this.retainOrCreateReview({
          url: indexed.originalUrl,
          archiveId: indexed.archiveId,
          hash: sha256,
          parsed,
          reasons,
          shape,
        });
        result.reviews += 1;
        result.processed += 1;
        result.documents.push({
          url: indexed.originalUrl,
          hash: sha256,
          outcome: "review",
          shape,
          parseReviewId: review.id,
          documentId: review.documentId,
          confidenceOk: false,
          confidenceReasons: reasons,
          parserWarnings: gate.warnings,
        });
        await this.deps.repos.ingestJobs.markSucceeded(job.id);
        return result;
      }

      if (options.dryRun) {
        result.processed += 1;
        result.documents.push({
          url: indexed.originalUrl,
          hash: sha256,
          outcome: "dry-run",
          shape,
          confidenceOk: true,
          parserWarnings: gate.warnings,
        });
        await this.deps.repos.ingestJobs.markSucceeded(job.id);
        return result;
      }

      const published = await this.publish(
        parsed,
        indexed.originalUrl,
        sha256,
        indexed.archiveId,
        lawId,
        shape,
      );
      result.processed += 1;
      if (published.outcome === "published") {
        result.published += 1;
      } else {
        result.unchanged += 1;
      }
      result.documents.push({
        url: indexed.originalUrl,
        hash: sha256,
        outcome: published.outcome,
        documentId: published.documentId,
        versionId: published.versionId,
        parseReviewId: published.parseReviewId,
        shape,
        confidenceOk: true,
        parserWarnings: gate.warnings,
      });
      await this.deps.repos.ingestJobs.markSucceeded(job.id);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ingest_failed";
      await this.deps.repos.ingestJobs.markFailed(job.id, message);
      throw error;
    }
  }

  private async ingestOne(
    url: string,
    lawId: string | null,
    dryRun: boolean,
    jobId: string,
  ): Promise<IngestRunResult["documents"][number]> {
    await this.patchJob(jobId, "DOWNLOADING", url);
    const downloaded = await this.deps.connector.download({ url });
    const format = detectFormat(downloaded.mimeType, downloaded.bytes);
    const valid = validateSourceBytes(format, downloaded.bytes, downloaded.mimeType);
    if (!valid.ok) {
      throw Object.assign(new Error(valid.reason), { code: "content_type" });
    }
    const hash = sha256Hex(downloaded.bytes);
    if (format !== "html") {
      throw Object.assign(new Error("html_required_for_authoritative_parse"), {
        code: "unsupported_format",
      });
    }

    await this.patchJob(jobId, "ARCHIVED", url);
    const stored = await this.deps.archive.store(downloaded.bytes, {
      originalUrl: downloaded.retrievedUrl || downloaded.url,
      retrievedAt: downloaded.retrievedAt,
      mimeType: downloaded.mimeType,
      originalFileName: `${lawId ?? "legalinfo"}.html`,
      sourceId: SOURCE_ID,
    });
    const archiveId = stored.record.archiveId;
    const archivedBytes = await this.deps.archive.get(hash);
    if (!archivedBytes || sha256Hex(archivedBytes) !== hash) {
      throw Object.assign(new Error("archive_hash_mismatch"), { code: "archive_hash_mismatch" });
    }
    const html = new TextDecoder("utf-8").decode(archivedBytes);

    await this.patchJob(jobId, "PARSING", url);
    const parsed = await this.deps.parser.parse({
      html,
      bytes: archivedBytes,
      sourceUrl: url,
      mimeType: downloaded.mimeType,
    });

    await this.patchJob(jobId, "VALIDATING", url);
    const gate = assessPublicationGate({
      document: parsed,
      archiveSha256: hash,
      bytesSha256: sha256Hex(archivedBytes),
      lawId,
    });
    const confidence = assessParseConfidence(parsed);
    const shape = parseShape(parsed.versions[0]?.nodes ?? []);
    const base = {
      url,
      hash,
      httpStatus: downloaded.httpStatus,
      retrievedUrl: downloaded.retrievedUrl,
      mimeType: downloaded.mimeType,
      byteSize: downloaded.bytes.byteLength,
      title: parsed.title,
      documentType: parsed.documentType,
      shape,
      confidenceOk: gate.ok && confidence.ok,
      confidenceReasons: !gate.ok ? gate.reasons : confidence.ok ? [] : confidence.reasons,
      parserWarnings: gate.warnings,
      archiveId,
    };

    if (!gate.ok || !confidence.ok) {
      const reasons = !gate.ok ? gate.reasons : !confidence.ok ? confidence.reasons : [];
      const review = await this.retainOrCreateReview({
        url,
        archiveId,
        hash,
        parsed,
        reasons,
        shape,
      });
      await this.deps.repos.auditLogs.append({
        actor: ACTOR,
        action: "ingest.review",
        entityType: "ParseReview",
        entityId: review.id,
        metadata: { url, hash, parser: LEGALINFO_PARSER_ID, reasons, dryRun },
      });
      return { ...base, outcome: "review", parseReviewId: review.id, documentId: review.documentId };
    }

    if (dryRun) {
      await this.deps.repos.auditLogs.append({
        actor: ACTOR,
        action: "ingest.ready",
        entityType: "ArchiveRecord",
        entityId: archiveId,
        metadata: { url, hash, parser: LEGALINFO_PARSER_ID, result: "ready_unpublished" },
      });
      return { ...base, outcome: "ready" };
    }

    const published = await this.publish(parsed, url, hash, archiveId, lawId, shape);
    await this.patchJob(jobId, published.outcome === "published" ? "PUBLISHED" : "UNCHANGED", url);
    return {
      ...base,
      outcome: published.outcome,
      documentId: published.documentId,
      versionId: published.versionId,
      parseReviewId: published.parseReviewId,
    };
  }

  private async publish(
    parsed: LegalDocument,
    url: string,
    hash: string,
    archiveId: string,
    lawId: string | null,
    shape?: ParseShape,
  ): Promise<{
    outcome: "published" | "unchanged";
    documentId: string;
    versionId?: string;
    parseReviewId?: string;
  }> {
    const source = await this.ensureSource();
    const parserId = this.deps.parser.id;
    return this.deps.uow.run(async (repos) => {
      const existing = await repos.documents.findBySourceAndCanonicalUrl(source.id, url);
      if (existing) {
        const same = await repos.versions.findByDocumentContentHashAndParserId(
          existing.id,
          hash,
          parserId,
        );
        if (same) {
          await repos.auditLogs.append({
            actor: ACTOR,
            action: "ingest.unchanged",
            entityType: "LegalDocument",
            entityId: existing.id,
            metadata: {
              url,
              hash,
              parserId,
              archiveRecordId: archiveId,
              result: "unchanged",
            },
          });
          return { outcome: "unchanged" as const, documentId: existing.id, versionId: same.id };
        }
        const versions = await repos.versions.listByDocumentId(existing.id);
        const priorSameSource = versions.find(
          (item) => item.contentHash === hash && item.archiveRecordId === archiveId,
        );
        const canonicalization = Boolean(
          priorSameSource && priorSameSource.parserId !== parserId,
        );
        const published = versions.filter((item) => item.status === VersionStatus.PUBLISHED);
        const now = new Date().toISOString();
        for (const version of published) {
          await repos.versions.save({
            ...version,
            status: VersionStatus.SUPERSEDED,
            // Source updates may close an open interval; canonicalization must not invent dates.
            effectiveTo: canonicalization ? version.effectiveTo : (version.effectiveTo ?? now),
          });
        }
        const nextNumber = Math.max(0, ...versions.map((item) => item.versionNumber)) + 1;
        const tree = parsed.versions[0]?.nodes ?? [];
        const saved = await persistWith(repos, {
          document: {
            id: existing.id,
            sourceId: source.id,
            documentType: parsed.documentType,
            title: parsed.title,
            documentNumber: parsed.documentNumber,
            issuingAuthority: parsed.issuingAuthority,
            jurisdiction: parsed.jurisdiction,
            adoptedAt: parsed.adoptedAt,
            canonicalUrl: url,
            status: DocumentStatus.IN_FORCE,
          },
          version: {
            documentId: existing.id,
            versionNumber: nextNumber,
            effectiveFrom: canonicalization
              ? null
              : (parsed.versions[0]?.effectiveFrom ?? null),
            effectiveTo: null,
            contentHash: hash,
            parserId,
            status: VersionStatus.PUBLISHED,
            amendmentDocumentId: null,
            archiveRecordId: archiveId,
          },
          nodes: tree,
        });
        await this.publishCitations(repos, saved.version.id, url, hash, lawId, saved.nodes);
        await repos.auditLogs.append({
          actor: ACTOR,
          action: canonicalization ? "ingest.canonicalization_published" : "ingest.published",
          entityType: "LegalDocumentVersion",
          entityId: saved.version.id,
          metadata: {
            url,
            hash,
            parserId,
            archiveRecordId: archiveId,
            documentId: existing.id,
            priorParserId: priorSameSource?.parserId ?? null,
            result: canonicalization ? "canonicalization_published" : "published",
          },
        });
        const parseReviewId = shape
          ? await this.acceptPendingReviews(repos, existing.id, archiveId, hash, shape)
          : undefined;
        return {
          outcome: "published" as const,
          documentId: existing.id,
          versionId: saved.version.id,
          parseReviewId,
        };
      }

      const tree = parsed.versions[0]?.nodes ?? [];
      const saved = await persistWith(repos, {
        document: {
          sourceId: source.id,
          documentType: parsed.documentType,
          title: parsed.title,
          documentNumber: parsed.documentNumber,
          issuingAuthority: parsed.issuingAuthority,
          jurisdiction: parsed.jurisdiction,
          adoptedAt: parsed.adoptedAt,
          canonicalUrl: url,
          status: DocumentStatus.IN_FORCE,
        },
        version: {
          documentId: "",
          versionNumber: 1,
          effectiveFrom: parsed.versions[0]?.effectiveFrom ?? null,
          effectiveTo: null,
          contentHash: hash,
          parserId,
          status: VersionStatus.PUBLISHED,
          amendmentDocumentId: null,
          archiveRecordId: archiveId,
        },
        nodes: tree,
      });
      await this.publishCitations(repos, saved.version.id, url, hash, lawId, saved.nodes);
      await repos.auditLogs.append({
        actor: ACTOR,
        action: "ingest.published",
        entityType: "LegalDocument",
        entityId: saved.document.id,
        metadata: {
          url,
          hash,
          parserId,
          archiveRecordId: archiveId,
          result: "published",
        },
      });
      const parseReviewId = shape
        ? await this.acceptPendingReviews(repos, saved.document.id, archiveId, hash, shape)
        : undefined;
      return {
        outcome: "published" as const,
        documentId: saved.document.id,
        versionId: saved.version.id,
        parseReviewId,
      };
    });
  }

  private async publishCitations(
    repos: EngineRepositories,
    versionId: string,
    url: string,
    hash: string,
    lawId: string | null,
    nodes: LegalNode[],
  ): Promise<void> {
    for (const node of flattenLegalNodes(nodes)) {
      if (node.nodeType === "DOCUMENT") {
        continue;
      }
      await repos.citations.save({
        documentVersionId: versionId,
        legalNodeId: node.id,
        citationKey: citationKeyForNode(lawId, node.sourceLocator),
        locator: node.sourceLocator,
        exactText: node.text,
        sourceUrl: url,
        contentHash: node.contentHash || hash,
        status: CitationStatus.VALID,
      });
    }
  }

  private async ensureSource() {
    const existing = await this.deps.repos.sources.findById(SOURCE_ID);
    if (existing) {
      return existing;
    }
    return this.deps.repos.sources.save({
      id: SOURCE_ID,
      name: "LegalInfo Mongolia",
      type: SourceType.LEGISLATION,
      authority: "LEGALINFO",
      jurisdiction: "MN",
      baseUrl: "https://legalinfo.mn",
      trustLevel: TrustLevel.OFFICIAL,
    });
  }

  private async placeholderDocument(url: string, parsed: LegalDocument) {
    const source = await this.ensureSource();
    const existing = await this.deps.repos.documents.findBySourceAndCanonicalUrl(source.id, url);
    if (existing) {
      return existing;
    }
    return this.deps.repos.documents.save({
      sourceId: source.id,
      documentType: parsed.documentType,
      title: parsed.title || url,
      documentNumber: null,
      issuingAuthority: parsed.issuingAuthority,
      jurisdiction: "MN",
      adoptedAt: parsed.adoptedAt,
      canonicalUrl: url,
      status: DocumentStatus.DRAFT,
    });
  }

  private async patchJob(id: string, stage: string, url: string): Promise<void> {
    const current = await this.deps.repos.ingestJobs.findById(id);
    if (!current) {
      return;
    }
    // Status stays RUNNING; stage is recorded via audit for observability.
    await this.deps.repos.auditLogs.append({
      actor: ACTOR,
      action: `ingest.stage.${stage}`,
      entityType: "IngestJob",
      entityId: id,
      metadata: { url, stage, status: IngestJobStatus.RUNNING },
    });
  }

  private async retainOrCreateReview(input: {
    url: string;
    archiveId: string;
    hash: string;
    parsed: LegalDocument;
    reasons: string[];
    shape: ParseShape;
  }) {
    const existing = await this.deps.repos.documents.findBySourceAndCanonicalUrl(
      SOURCE_ID,
      input.url,
    );
    const documentId = existing?.id ?? (await this.placeholderDocument(input.url, input.parsed)).id;
    const reviews = await this.deps.repos.parseReviews.listByDocumentId(documentId);
    const pending = reviews.find(
      (item) =>
        item.status === ParseReviewStatus.PENDING && item.archiveRecordId === input.archiveId,
    );
    if (pending) {
      return this.deps.repos.parseReviews.save({
        id: pending.id,
        documentId: pending.documentId,
        archiveRecordId: pending.archiveRecordId,
        status: ParseReviewStatus.PENDING,
        reason: input.reasons.join(","),
        parsedPayload: {
          ...pending.parsedPayload,
          reasons: input.reasons,
          parser: LEGALINFO_PARSER_ID,
          url: input.url,
          hash: input.hash,
          shape: input.shape,
        },
        reviewedBy: ACTOR,
      });
    }
    return this.deps.repos.parseReviews.save({
      documentId,
      archiveRecordId: input.archiveId,
      status: ParseReviewStatus.PENDING,
      reason: input.reasons.join(","),
      parsedPayload: {
        reasons: input.reasons,
        parser: LEGALINFO_PARSER_ID,
        url: input.url,
        hash: input.hash,
        shape: input.shape,
      },
      reviewedBy: ACTOR,
    });
  }

  private async acceptPendingReviews(
    repos: EngineRepositories,
    documentId: string,
    archiveRecordId: string,
    hash: string,
    shape: ParseShape,
  ): Promise<string | undefined> {
    const reviews = await repos.parseReviews.listByDocumentId(documentId);
    const pending = reviews.filter(
      (item) =>
        item.status === ParseReviewStatus.PENDING &&
        (item.archiveRecordId === archiveRecordId || reviews.length === 1),
    );
    let lastId: string | undefined;
    const reviewedAt = new Date().toISOString();
    for (const review of pending) {
      const saved = await repos.parseReviews.save({
        id: review.id,
        documentId: review.documentId,
        archiveRecordId: review.archiveRecordId,
        status: ParseReviewStatus.ACCEPTED,
        reason: review.reason,
        parsedPayload: {
          ...review.parsedPayload,
          acceptedHash: hash,
          parser: LEGALINFO_PARSER_ID,
          shape,
        },
        reviewedBy: ACTOR,
        reviewedAt,
      });
      lastId = saved.id;
      await repos.auditLogs.append({
        actor: ACTOR,
        action: "ingest.review.accepted",
        entityType: "ParseReview",
        entityId: saved.id,
        metadata: { documentId, hash, parser: LEGALINFO_PARSER_ID, shape },
      });
    }
    return lastId;
  }
}

function parseShape(nodes: LegalNode[]): ParseShape {
  const flat = flattenLegalNodes(nodes);
  const seen = new Set<string>();
  let duplicateLocators = 0;
  for (const node of flat) {
    if (seen.has(node.sourceLocator)) {
      duplicateLocators += 1;
    }
    seen.add(node.sourceLocator);
  }
  const hierarchyViolations: string[] = [];
  try {
    assertLegalNodeHierarchy(nodes);
  } catch (error) {
    hierarchyViolations.push(error instanceof Error ? error.message : "broken_article_hierarchy");
  }
  return {
    nodes: flat.length,
    articles: flat.filter((node) => node.nodeType === LegalNodeType.ARTICLE).length,
    paragraphs: flat.filter((node) => node.nodeType === LegalNodeType.PARAGRAPH).length,
    clauses: flat.filter((node) => node.nodeType === LegalNodeType.CLAUSE).length,
    chapters: flat.filter((node) => node.nodeType === LegalNodeType.CHAPTER).length,
    annexes: flat.filter((node) => node.nodeType === LegalNodeType.ANNEX).length,
    insertedArticles: flat.filter(
      (node) => node.nodeType === LegalNodeType.ARTICLE && /\^/.test(node.article ?? ""),
    ).length,
    duplicateLocators,
    hierarchyViolations,
  };
}

function lawIdFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("lawId");
  } catch {
    return null;
  }
}
