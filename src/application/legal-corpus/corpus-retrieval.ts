import type { LegalNode } from "../../domain/entities.js";
import type {
  RetrievalPort,
  RetrieveRequest,
  RetrieveResponse,
  RetrievedAuthority,
} from "../../domain/ports/retrieval.js";
import { RetrieveStatus } from "../../domain/ports/retrieval.js";
import type { EngineRepositories } from "../../domain/ports/repositories.js";
import { flattenLegalNodes } from "../../domain/services/legal-node-hierarchy.js";
import { versionCoversInstant } from "../../domain/services/document-version.js";
import { parseExactCitationQuery } from "../citations/parse-citation-query.js";

const MAX_AUTHORITIES = 100;

export class CorpusRetrieval implements RetrievalPort {
  constructor(private readonly repos: EngineRepositories) {}

  async retrieve(request: RetrieveRequest): Promise<RetrieveResponse> {
    const authorities = await this.lookup(request);
    const retrievedAt = new Date().toISOString();
    if (request.asOf) {
      const verified = authorities.filter(
        (item) => item.effectiveFrom && item.effectiveTo,
      );
      if (verified.length === 0) {
        return {
          authorities: [],
          retrievedAt,
          status: RetrieveStatus.AS_OF_UNAVAILABLE,
        };
      }
      return {
        authorities: verified.slice(0, MAX_AUTHORITIES),
        retrievedAt,
        status: RetrieveStatus.OK,
      };
    }
    return {
      authorities: authorities.slice(0, MAX_AUTHORITIES),
      retrievedAt,
      status: RetrieveStatus.OK,
    };
  }

  private async lookup(request: RetrieveRequest): Promise<RetrievedAuthority[]> {
    if (request.nodeId) {
      const node = await this.repos.nodes.findById(request.nodeId);
      if (!node) {
        return [];
      }
      const version = await this.repos.versions.findById(node.documentVersionId);
      if (!version) {
        return [];
      }
      if (request.asOf && !versionCoversInstant(version, request.asOf)) {
        return [];
      }
      return [toAuthority(node, version.documentId, version)];
    }

    if (request.documentId) {
      const version = await this.repos.versions.findPublishedForDocument(
        request.documentId,
        request.asOf,
      );
      if (!version) {
        return [];
      }
      const tree = await this.repos.nodes.findTreeByVersion(version.id);
      return flattenLegalNodes(tree).map((node) =>
        toAuthority(node, version.documentId, version),
      );
    }

    if (request.citationKey || request.locator) {
      const parsed = parseExactCitationQuery(
        request.citationKey ?? request.locator ?? request.question,
      );
      const matches = await this.repos.citations.findPublishedMatches({
        query: request.citationKey ?? request.locator ?? request.question,
        citationKey: request.citationKey,
        locator: request.locator ?? parsed.locator,
        titleHint: parsed.titleHint,
        article: parsed.article,
        paragraph: parsed.paragraph,
        asOf: request.asOf,
      });
      return matches.map((match) => ({
        nodeId: match.nodeId,
        documentId: match.documentId,
        documentVersionId: match.documentVersionId,
        locator: match.locator,
        title: match.title ?? match.locator,
        excerpt: match.excerpt,
        contentHash: match.contentHash,
        sourceContentHash: match.sourceContentHash,
        parserId: match.parserId,
        archiveRecordId: match.archiveRecordId,
        effectiveFrom: match.effectiveFrom,
        effectiveTo: match.effectiveTo,
      }));
    }

    if (request.citations && request.citations.length > 0) {
      const collected: RetrievedAuthority[] = [];
      for (const citation of request.citations) {
        const parsed = parseExactCitationQuery(citation.query);
        const matches = await this.repos.citations.findPublishedMatches({
          query: citation.query,
          nodeId: citation.nodeId,
          locator: parsed.locator,
          titleHint: parsed.titleHint,
          article: parsed.article,
          paragraph: parsed.paragraph,
          asOf: request.asOf,
        });
        for (const match of matches) {
          collected.push({
            nodeId: match.nodeId,
            documentId: match.documentId,
            documentVersionId: match.documentVersionId,
            locator: match.locator,
            title: match.title ?? match.locator,
            excerpt: match.excerpt,
            contentHash: match.contentHash,
            sourceContentHash: match.sourceContentHash,
            parserId: match.parserId,
            archiveRecordId: match.archiveRecordId,
            effectiveFrom: match.effectiveFrom,
            effectiveTo: match.effectiveTo,
          });
        }
      }
      return collected;
    }

    return [];
  }
}

function toAuthority(
  node: LegalNode,
  documentId: string,
  version: {
    id: string;
    contentHash: string;
    parserId: string;
    archiveRecordId: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  },
): RetrievedAuthority {
  return {
    nodeId: node.id,
    documentId,
    documentVersionId: version.id,
    locator: node.sourceLocator,
    title: node.title ?? node.sourceLocator,
    excerpt: node.text.slice(0, 500),
    contentHash: node.contentHash,
    sourceContentHash: version.contentHash,
    parserId: version.parserId,
    archiveRecordId: version.archiveRecordId,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
  };
}
