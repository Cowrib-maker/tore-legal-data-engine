import type { CitationMatch, CitationRecord } from "../../domain/entities.js";
import type {
  CitationLookup,
  CitationRepository,
  SaveCitation,
} from "../../domain/ports/repositories.js";
import { versionCoversInstant } from "../../domain/services/document-version.js";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "./db-client.js";
import { mapCitation, mapVersion, toIso } from "./mappers.js";

export class PrismaCitationRepository implements CitationRepository {
  constructor(private readonly db: DbClient) {}

  async save(input: SaveCitation): Promise<CitationRecord> {
    const data = {
      documentVersionId: input.documentVersionId,
      legalNodeId: input.legalNodeId,
      citationKey: input.citationKey,
      locator: input.locator,
      exactText: input.exactText,
      sourceUrl: input.sourceUrl,
      contentHash: input.contentHash,
      status: input.status,
    };
    if (input.id) {
      const row = await this.db.citationEntry.upsert({
        where: { id: input.id },
        create: { id: input.id, ...data },
        update: data,
      });
      return mapCitation(row);
    }
    return mapCitation(await this.db.citationEntry.create({ data }));
  }

  async findById(id: string): Promise<CitationRecord | null> {
    const row = await this.db.citationEntry.findUnique({ where: { id } });
    return row ? mapCitation(row) : null;
  }

  async findByCitationKey(citationKey: string): Promise<CitationRecord[]> {
    const rows = await this.db.citationEntry.findMany({ where: { citationKey } });
    return rows.map(mapCitation);
  }

  async findPublishedMatches(lookup: CitationLookup): Promise<CitationMatch[]> {
    const or: Prisma.CitationEntryWhereInput[] = [
      { citationKey: lookup.query },
      { locator: lookup.query },
    ];
    if (lookup.nodeId) {
      or.push({ legalNodeId: lookup.nodeId });
    }
    if (lookup.locator) {
      or.push({ locator: lookup.locator });
    }
    if (lookup.citationKey) {
      or.push({ citationKey: lookup.citationKey });
    }
    if (lookup.article && lookup.paragraph) {
      or.push({
        legalNode: {
          article: lookup.article,
          paragraph: lookup.paragraph,
          nodeType: "PARAGRAPH",
        },
      });
    } else if (lookup.article) {
      or.push({
        legalNode: {
          article: lookup.article,
          nodeType: "ARTICLE",
        },
      });
    }

    const rows = await this.db.citationEntry.findMany({
      where: {
        OR: or,
        documentVersion: {
          ...(lookup.asOf
            ? { status: { in: ["PUBLISHED", "SUPERSEDED"] } }
            : { status: "PUBLISHED" }),
          ...(lookup.documentId ? { documentId: lookup.documentId } : {}),
          ...(lookup.titleHint
            ? { document: { title: { contains: lookup.titleHint, mode: "insensitive" } } }
            : {}),
        },
      },
      include: {
        legalNode: true,
        documentVersion: true,
      },
    });

    const seen = new Set<string>();
    const matches: CitationMatch[] = [];
    for (const row of rows) {
      if (lookup.asOf && !versionCoversInstant(mapVersion(row.documentVersion), lookup.asOf)) {
        continue;
      }
      const key = `${row.documentVersionId}:${row.legalNodeId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      matches.push({
        citation: mapCitation(row),
        documentId: row.documentVersion.documentId,
        documentVersionId: row.documentVersionId,
        versionStatus: row.documentVersion.status,
        effectiveFrom: toIso(row.documentVersion.effectiveFrom),
        effectiveTo: toIso(row.documentVersion.effectiveTo),
        parserId: row.documentVersion.parserId,
        sourceContentHash: row.documentVersion.contentHash,
        archiveRecordId: row.documentVersion.archiveRecordId,
        nodeId: row.legalNodeId,
        locator: row.locator,
        title: row.legalNode.title,
        excerpt: row.exactText.slice(0, 500),
        contentHash: row.contentHash,
      });
    }
    return matches;
  }
}
