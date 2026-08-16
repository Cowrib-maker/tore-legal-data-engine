import type { CitationRecord, LegalDocument, LegalDocumentVersion } from "../../domain/entities.js";
import { VersionStatus } from "../../domain/enums.js";
import type { ArchiveRecord } from "../../domain/ports/archive-storage.js";
import {
  evaluateCitationRoundTrip,
  evaluateVersionStructure,
  type FlatEvalNode,
  type VersionStructureReport,
} from "./evaluate-version.js";
import {
  HISTORY_LOCATORS_BY_LAW,
  INSERTED_ARTICLE_EXPECTATIONS,
  NEGATIVE_LOCATORS,
  lawIdFromCanonicalUrl,
} from "./expectations.js";

export type LocatorCheck = {
  locator: string;
  lawId: string;
  status: "VALID" | "UNRESOLVED" | "MISSING" | "AMBIGUOUS";
};

export type ArchiveCheck = {
  versionId: string;
  expectedSha256: string;
  archiveSha256: string | null;
  bytesExist: boolean;
  ok: boolean;
};

export type CorpusEvaluationReport = {
  totals: {
    documents: number;
    versions: number;
    nodes: number;
    citations: number;
    duplicateLocators: number;
    orphanNodes: number;
    hierarchyViolations: number;
    archiveMismatches: number;
    invalidCitationResolutions: number;
    roundTripFailures: number;
  };
  structural: VersionStructureReport[];
  archives: ArchiveCheck[];
  insertedArticles: LocatorCheck[];
  historyLocators: LocatorCheck[];
  negativeCitations: LocatorCheck[];
  gaps: string[];
  temporal: {
    currentRetrieval: "available" | "unavailable";
    historicalAsOf: "available" | "unavailable";
  };
};

export type CorpusSnapshot = {
  documents: LegalDocument[];
  versions: LegalDocumentVersion[];
  nodes: FlatEvalNode[];
  citations: CitationRecord[];
  archives: ArchiveRecord[];
  archiveBytesExist: (sha256: string) => Promise<boolean>;
  resolveLocator?: (input: {
    documentId: string;
    locator: string;
  }) => Promise<"VALID" | "UNRESOLVED" | "AMBIGUOUS">;
};

export async function evaluateCorpus(snapshot: CorpusSnapshot): Promise<CorpusEvaluationReport> {
  const published = snapshot.versions.filter((item) => item.status === VersionStatus.PUBLISHED);
  const structural: VersionStructureReport[] = [];
  let roundTripFailures = 0;
  const archives: ArchiveCheck[] = [];

  for (const version of published) {
    const nodes = snapshot.nodes.filter((node) => node.documentVersionId === version.id);
    const citations = snapshot.citations.filter((item) => item.documentVersionId === version.id);
    structural.push(evaluateVersionStructure(version.documentId, version.id, nodes));
    roundTripFailures += evaluateCitationRoundTrip(nodes, citations).failures.length;
    const archive = snapshot.archives.find((item) => item.archiveId === version.archiveRecordId);
    const bytesExist = archive ? await snapshot.archiveBytesExist(archive.sha256) : false;
    archives.push({
      versionId: version.id,
      expectedSha256: version.contentHash,
      archiveSha256: archive?.sha256 ?? null,
      bytesExist,
      ok: Boolean(archive && archive.sha256 === version.contentHash && bytesExist),
    });
  }

  const docsById = new Map(snapshot.documents.map((item) => [item.id, item]));
  const insertedArticles: LocatorCheck[] = [];
  for (const expected of INSERTED_ARTICLE_EXPECTATIONS) {
    insertedArticles.push(await checkExpectedLocator(snapshot, docsById, expected.lawId, expected.locator));
  }
  const historyLocators: LocatorCheck[] = [];
  for (const [lawId, locators] of Object.entries(HISTORY_LOCATORS_BY_LAW)) {
    for (const locator of locators) {
      historyLocators.push(await checkExpectedLocator(snapshot, docsById, lawId, locator));
    }
  }
  const negativeCitations: LocatorCheck[] = [];
  for (const document of snapshot.documents) {
    const lawId = lawIdFromCanonicalUrl(document.canonicalUrl) ?? document.id;
    for (const locator of NEGATIVE_LOCATORS) {
      const status = snapshot.resolveLocator
        ? await snapshot.resolveLocator({ documentId: document.id, locator })
        : nodeStatus(snapshot, document.id, locator);
      negativeCitations.push({
        locator,
        lawId,
        status: status === "VALID" ? "VALID" : status === "AMBIGUOUS" ? "AMBIGUOUS" : "UNRESOLVED",
      });
    }
  }

  const gaps: string[] = [];
  const currentRetrieval = published.length > 0 ? "available" : "unavailable";
  const historicalAsOf =
    published.length > 0 &&
    published.every((item) => Boolean(item.effectiveFrom && item.effectiveTo))
      ? "available"
      : "unavailable";
  const nullDated = published.filter((item) => !item.effectiveFrom || !item.effectiveTo);
  if (nullDated.length > 0) {
    gaps.push(
      "as_of_gap: published versions lack closed effectiveFrom/effectiveTo intervals; historical as-of is unavailable",
    );
  }
  const superseded = snapshot.versions.filter((item) => item.status === VersionStatus.SUPERSEDED);
  if (superseded.length === 0) {
    gaps.push(
      "version_history_gap: corpus currently has one published version per document and no SUPERSEDED rows",
    );
  }

  const invalidNegatives = negativeCitations.filter((item) => item.status !== "UNRESOLVED").length;
  const invalidInserted = insertedArticles.filter((item) => item.status !== "VALID").length;
  const invalidHistory = historyLocators.filter((item) => item.status !== "VALID").length;

  return {
    totals: {
      documents: snapshot.documents.length,
      versions: published.length,
      nodes: snapshot.nodes.filter((node) => published.some((version) => version.id === node.documentVersionId))
        .length,
      citations: snapshot.citations.filter((item) =>
        published.some((version) => version.id === item.documentVersionId),
      ).length,
      duplicateLocators: structural.reduce((sum, item) => sum + item.duplicateLocators.length, 0),
      orphanNodes: structural.reduce((sum, item) => sum + item.orphans.length, 0),
      hierarchyViolations: structural.reduce(
        (sum, item) =>
          sum +
          item.cycles.length +
          item.invalidParents.length +
          item.incompatibleTypes.length +
          (item.documentParents === 1 ? 0 : 1),
        0,
      ),
      archiveMismatches: archives.filter((item) => !item.ok).length,
      invalidCitationResolutions: invalidNegatives + invalidInserted + invalidHistory,
      roundTripFailures,
    },
    structural,
    archives,
    insertedArticles,
    historyLocators,
    negativeCitations,
    gaps,
    temporal: {
      currentRetrieval,
      historicalAsOf,
    },
  };
}

async function checkExpectedLocator(
  snapshot: CorpusSnapshot,
  docsById: Map<string, LegalDocument>,
  lawId: string,
  locator: string,
): Promise<LocatorCheck> {
  const document = [...docsById.values()].find(
    (item) => lawIdFromCanonicalUrl(item.canonicalUrl) === lawId,
  );
  if (!document) {
    return { locator, lawId, status: "MISSING" };
  }
  const status = snapshot.resolveLocator
    ? await snapshot.resolveLocator({ documentId: document.id, locator })
    : nodeStatus(snapshot, document.id, locator);
  return { locator, lawId, status };
}

function nodeStatus(
  snapshot: CorpusSnapshot,
  documentId: string,
  locator: string,
): "VALID" | "UNRESOLVED" | "AMBIGUOUS" {
  const versionIds = new Set(
    snapshot.versions
      .filter((item) => item.documentId === documentId && item.status === VersionStatus.PUBLISHED)
      .map((item) => item.id),
  );
  const matches = snapshot.nodes.filter(
    (node) => versionIds.has(node.documentVersionId) && node.sourceLocator === locator,
  );
  if (matches.length === 1) {
    return "VALID";
  }
  if (matches.length > 1) {
    return "AMBIGUOUS";
  }
  return "UNRESOLVED";
}
