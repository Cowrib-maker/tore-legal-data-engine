import { InvariantError } from "../errors.js";
import type { LegalNode } from "../entities.js";

/**
 * Hierarchy rules:
 * - locators unique within a version
 * - parentId must refer to a node in the same tree
 * - no cycles
 * - root nodes have parentId null
 */
export function assertLegalNodeHierarchy(nodes: readonly LegalNode[]): void {
  const byId = new Map<string, LegalNode>();
  const locators = new Set<string>();

  function index(node: LegalNode, parentId: string | null): void {
    if (byId.has(node.id)) {
      throw new InvariantError(`Duplicate node id: ${node.id}`);
    }
    if (node.parentId !== parentId) {
      throw new InvariantError(
        `Node ${node.id} parentId ${node.parentId} does not match tree parent ${parentId}`,
      );
    }
    if (locators.has(node.sourceLocator)) {
      throw new InvariantError(
        `Duplicate sourceLocator within version: ${node.sourceLocator}`,
      );
    }
    if (!node.sourceLocator.trim()) {
      throw new InvariantError(`Node ${node.id} is missing sourceLocator`);
    }
    if (!node.contentHash.trim()) {
      throw new InvariantError(`Node ${node.id} is missing contentHash`);
    }
    byId.set(node.id, node);
    locators.add(node.sourceLocator);
    for (const child of node.children) {
      index(child, node.id);
    }
  }

  for (const root of nodes) {
    index(root, null);
  }

  assertAcyclic(nodes);
}

function assertAcyclic(roots: readonly LegalNode[]): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function walk(node: LegalNode): void {
    if (visiting.has(node.id)) {
      throw new InvariantError(`Cycle detected at node ${node.id}`);
    }
    if (visited.has(node.id)) {
      return;
    }
    visiting.add(node.id);
    for (const child of node.children) {
      walk(child);
    }
    visiting.delete(node.id);
    visited.add(node.id);
  }

  for (const root of roots) {
    walk(root);
  }
}

export function assembleLegalNodeTree(
  flat: readonly Omit<LegalNode, "children">[],
): LegalNode[] {
  const byId = new Map<string, LegalNode>();
  for (const node of flat) {
    byId.set(node.id, { ...node, children: [] });
  }
  const roots: LegalNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function flattenLegalNodes(nodes: readonly LegalNode[]): LegalNode[] {
  const out: LegalNode[] = [];
  function walk(node: LegalNode): void {
    out.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const node of nodes) {
    walk(node);
  }
  return out;
}
