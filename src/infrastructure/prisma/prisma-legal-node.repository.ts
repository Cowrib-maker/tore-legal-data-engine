import type { LegalNode } from "../../domain/entities.js";
import type { LegalNodeRepository } from "../../domain/ports/repositories.js";
import {
  assembleLegalNodeTree,
  flattenLegalNodes,
} from "../../domain/services/legal-node-hierarchy.js";
import type { DbClient } from "./db-client.js";
import { mapNode } from "./mappers.js";

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
