import { randomUUID } from "node:crypto";

import { InvariantError } from "../../domain/errors.js";
import type {
  LegalDocument,
  LegalDocumentVersion,
  LegalNode,
} from "../../domain/entities.js";
import type {
  EngineRepositories,
  SaveLegalDocument,
  SaveLegalDocumentVersion,
  UnitOfWork,
} from "../../domain/ports/repositories.js";
import { assertLegalNodeHierarchy } from "../../domain/services/legal-node-hierarchy.js";
import {
  assertDocumentVersion,
  versionsDoNotOverlap,
} from "../../domain/services/document-version.js";

export type PersistLegalDocumentInput = {
  document: SaveLegalDocument;
  version: SaveLegalDocumentVersion;
  nodes: LegalNode[];
};

export type PersistLegalDocumentResult = {
  document: LegalDocument;
  version: LegalDocumentVersion;
  nodes: LegalNode[];
};

export class PersistLegalDocumentService {
  constructor(private readonly uow: UnitOfWork) {}

  async persist(
    input: PersistLegalDocumentInput,
  ): Promise<PersistLegalDocumentResult> {
    return this.uow.run((repos) => persistWith(repos, input));
  }
}

export async function persistWith(
  repos: EngineRepositories,
  input: PersistLegalDocumentInput,
): Promise<PersistLegalDocumentResult> {
  const documentId = input.document.id ?? randomUUID();
  const versionId = input.version.id ?? randomUUID();
  const versionForCheck: LegalDocumentVersion = {
    id: versionId,
    documentId: input.version.documentId || documentId,
    versionNumber: input.version.versionNumber,
    effectiveFrom: input.version.effectiveFrom,
    effectiveTo: input.version.effectiveTo,
    contentHash: input.version.contentHash,
    parserId: input.version.parserId,
    status: input.version.status,
    amendmentDocumentId: input.version.amendmentDocumentId,
    archiveRecordId: input.version.archiveRecordId,
    nodes: [],
  };
  assertDocumentVersion(versionForCheck);
  assertLegalNodeHierarchy(input.nodes);

  const existing = await repos.versions.listByDocumentId(versionForCheck.documentId);
  const next = [
    ...existing.filter((item) => item.id !== versionForCheck.id),
    versionForCheck,
  ];
  if (!versionsDoNotOverlap(next)) {
    throw new InvariantError(
      "published versions for the same document must not overlap",
    );
  }

  const document = await repos.documents.save({
    ...input.document,
    id: documentId,
  });
  const version = await repos.versions.save({
    ...input.version,
    id: versionId,
    documentId: document.id,
  });
  const nodes = await repos.nodes.replaceForVersion(version.id, input.nodes);
  return { document, version, nodes };
}
