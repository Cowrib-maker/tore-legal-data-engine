import { describe, expect, it } from "vitest";

import { LegalNodeType } from "../../src/domain/enums.js";
import type { LegalNode } from "../../src/domain/entities.js";
import { InvariantError } from "../../src/domain/errors.js";
import {
  assertLegalNodeHierarchy,
  flattenLegalNodes,
} from "../../src/domain/services/legal-node-hierarchy.js";

function node(
  partial: Partial<LegalNode> & Pick<LegalNode, "id" | "sourceLocator">,
): LegalNode {
  return {
    documentVersionId: "ver_1",
    parentId: null,
    nodeType: LegalNodeType.ARTICLE,
    book: null,
    part: null,
    chapter: null,
    section: null,
    article: partial.article ?? "1",
    paragraph: null,
    clause: null,
    subClause: null,
    number: "1",
    title: null,
    text: "text",
    contentHash: `hash-${partial.id}`,
    children: [],
    ...partial,
  };
}

describe("LegalNode hierarchy", () => {
  it("accepts a unique parent/child tree", () => {
    const tree: LegalNode[] = [
      node({
        id: "doc",
        nodeType: LegalNodeType.DOCUMENT,
        sourceLocator: "doc",
        article: null,
        children: [
          node({
            id: "art-1",
            parentId: "doc",
            sourceLocator: "doc/art-1",
            article: "1",
            children: [
              node({
                id: "art-1-p1",
                parentId: "art-1",
                nodeType: LegalNodeType.PARAGRAPH,
                sourceLocator: "doc/art-1/p-1",
                article: "1",
                paragraph: "1",
              }),
            ],
          }),
        ],
      }),
    ];

    expect(() => assertLegalNodeHierarchy(tree)).not.toThrow();
    expect(flattenLegalNodes(tree).map((item) => item.id)).toEqual([
      "doc",
      "art-1",
      "art-1-p1",
    ]);
  });

  it("rejects duplicate locators", () => {
    const tree: LegalNode[] = [
      node({
        id: "a",
        sourceLocator: "same",
        children: [
          node({ id: "b", parentId: "a", sourceLocator: "same" }),
        ],
      }),
    ];
    expect(() => assertLegalNodeHierarchy(tree)).toThrow(InvariantError);
  });

  it("rejects parentId that does not match the tree", () => {
    const tree: LegalNode[] = [
      node({
        id: "a",
        sourceLocator: "a",
        children: [node({ id: "b", parentId: "missing", sourceLocator: "b" })],
      }),
    ];
    expect(() => assertLegalNodeHierarchy(tree)).toThrow(InvariantError);
  });
});
