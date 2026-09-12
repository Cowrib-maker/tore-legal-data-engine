import { Prisma } from "@prisma/client";

import type { LegalNode, LegalNodeSearchCandidate } from "../../domain/entities.js";
import type {
  LegalNodeRepository,
  SearchLegalNodeCandidates,
} from "../../domain/ports/repositories.js";
import {
  assembleLegalNodeTree,
  flattenLegalNodes,
} from "../../domain/services/legal-node-hierarchy.js";
import type { DbClient } from "./db-client.js";
import { mapNode, toIso } from "./mappers.js";

type RawCandidateRow = {
  id: string;
  documentVersionId: string;
  parentId: string | null;
  nodeType: LegalNode["nodeType"];
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
  documentId: string;
  versionStatus: LegalNodeSearchCandidate["versionStatus"];
  versionContentHash: string;
  parserId: string;
  archiveRecordId: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  score: number;
};

export class PrismaLegalNodeRepository implements LegalNodeRepository {
  constructor(private readonly db: DbClient) {}

  async replaceForVersion(
    documentVersionId: string,
    tree: readonly LegalNode[],
  ): Promise<LegalNode[]> {
    const flat = flattenLegalNodes(tree as LegalNode[]).map((node) => ({
      ...node,
      documentVersionId,
    }));

    await this.db.citationEntry.deleteMany({ where: { documentVersionId } });
    await this.db.legalRelation.deleteMany({
      where: {
        OR: [
          { fromNode: { documentVersionId } },
          { toNode: { documentVersionId } },
        ],
      },
    });
    await this.db.legalNode.deleteMany({ where: { documentVersionId } });

    for (const node of flat) {
      await this.db.legalNode.create({
        data: {
          id: node.id,
          documentVersionId,
          parentId: node.parentId,
          nodeType: node.nodeType,
          book: node.book,
          part: node.part,
          chapter: node.chapter,
          section: node.section,
          article: node.article,
          paragraph: node.paragraph,
          clause: node.clause,
          subClause: node.subClause,
          number: node.number,
          title: node.title,
          text: node.text,
          sourceLocator: node.sourceLocator,
          contentHash: node.contentHash,
        },
      });
    }

    return this.findTreeByVersion(documentVersionId);
  }

  async findById(id: string): Promise<LegalNode | null> {
    const row = await this.db.legalNode.findUnique({ where: { id } });
    if (!row) {
      return null;
    }
    const tree = await this.findTreeByVersion(row.documentVersionId);
    return findNode(tree, id);
  }

  async findByLocator(
    documentVersionId: string,
    sourceLocator: string,
  ): Promise<LegalNode | null> {
    const row = await this.db.legalNode.findUnique({
      where: {
        documentVersionId_sourceLocator: { documentVersionId, sourceLocator },
      },
    });
    return row ? { ...mapNode(row), children: [] } : null;
  }

  async findTreeByVersion(documentVersionId: string): Promise<LegalNode[]> {
    const rows = await this.db.legalNode.findMany({
      where: { documentVersionId },
      orderBy: { createdAt: "asc" },
    });
    return assembleLegalNodeTree(rows.map(mapNode));
  }

  /**
   * Ranked FTS (search_vector, GIN) + title-trigram candidate search. Uses
   * Prisma.sql tagged-template parameter binding throughout — `question`
   * is fully attacker-controlled API input and must never be
   * string-concatenated into the query.
   *
   * WHERE deliberately only tests search_vector (@@, GIN-indexed) and the
   * short `title` column (%, trigram-indexed) — see the migration's own
   * comment for why a body-text trigram predicate was measured and
   * rejected as a full-table scan cost at this corpus's actual text-length
   * distribution. `similarity(text, ...)` is still used for scoring, but
   * only ever evaluated on the already-narrowed candidate rows in ORDER BY,
   * never as a filter over the whole table.
   */
  async searchCandidates(
    input: SearchLegalNodeCandidates,
  ): Promise<LegalNodeSearchCandidate[]> {
    if (input.statuses.length === 0) {
      return [];
    }
    const q = input.normalizedQuestion;
    const statusList = Prisma.join(input.statuses);
    const rows = await this.db.$queryRaw<RawCandidateRow[]>(Prisma.sql`
      SELECT
        n.id AS "id",
        n.document_version_id AS "documentVersionId",
        n.parent_id AS "parentId",
        n.node_type AS "nodeType",
        n.book AS "book",
        n.part AS "part",
        n.chapter AS "chapter",
        n.section AS "section",
        n.article AS "article",
        n.paragraph AS "paragraph",
        n.clause AS "clause",
        n.sub_clause AS "subClause",
        n.number AS "number",
        n.title AS "title",
        n.text AS "text",
        n.source_locator AS "sourceLocator",
        n.content_hash AS "contentHash",
        v.document_id AS "documentId",
        v.status AS "versionStatus",
        v.content_hash AS "versionContentHash",
        v.parser_id AS "parserId",
        v.archive_record_id AS "archiveRecordId",
        v.effective_from AS "effectiveFrom",
        v.effective_to AS "effectiveTo",
        (
          ts_rank_cd(n.search_vector, websearch_to_tsquery('simple', ${q})) * 1.0
          + public.similarity(n.text, ${q}) * 0.3
          + public.similarity(coalesce(n.title, ''), ${q}) * 0.8
        )::float8 AS "score"
      FROM legal_nodes n
      JOIN legal_document_versions v ON v.id = n.document_version_id
      WHERE v.status::text IN (${statusList})
        AND (
          n.search_vector @@ websearch_to_tsquery('simple', ${q})
          OR coalesce(n.title, '') OPERATOR(public.%) ${q}
        )
      ORDER BY "score" DESC
      LIMIT ${input.limit}
    `);
    return rows.map(mapCandidateRow);
  }
}

function mapCandidateRow(row: RawCandidateRow): LegalNodeSearchCandidate {
  return {
    node: {
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
    },
    documentId: row.documentId,
    versionId: row.documentVersionId,
    versionStatus: row.versionStatus,
    effectiveFrom: toIso(row.effectiveFrom),
    effectiveTo: toIso(row.effectiveTo),
    sourceContentHash: row.versionContentHash,
    parserId: row.parserId,
    archiveRecordId: row.archiveRecordId,
    score: Number(row.score),
  };
}

function findNode(nodes: readonly LegalNode[], id: string): LegalNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const nested = findNode(node.children, id);
    if (nested) {
      return nested;
    }
  }
  return null;
}
