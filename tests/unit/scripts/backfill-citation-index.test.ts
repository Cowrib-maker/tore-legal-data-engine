import { describe, expect, it } from "vitest";
import { CitationStatus } from "@prisma/client";
import {
  buildCitationEntryData,
  lawIdFromUrl,
  resolveLawId,
} from "../../../scripts/backfill-citation-index.js";

/**
 * Pure-logic regression tests for the legacy citation-index backfill
 * (scripts/backfill-citation-index.ts). These exercise the field-mapping
 * functions directly — no database, no Prisma client construction — so
 * they can run anywhere `npm run test:unit` runs, unlike the backfill
 * script itself (which requires a live DATABASE_URL).
 *
 * What this file does NOT (and cannot) verify without a real database:
 * duplicate-row prevention and idempotent re-runs at the storage layer.
 * Those are guaranteed by CitationEntry's own
 * @@unique([documentVersionId, legalNodeId]) constraint (prisma/schema.prisma)
 * plus the script's `upsert` on that exact compound key — a schema-level
 * guarantee, not something a pure-function test can exercise — and must be
 * confirmed by an actual `--commit` run followed by a second `--commit` run
 * showing zero row-count growth (see the audit's blocked-execution report).
 */
describe("backfill-citation-index: buildCitationEntryData", () => {
  const node = {
    id: "node_1",
    sourceLocator: "article-17",
    text: "Хүний эрх, эрх чөлөөг хүндэтгэнэ.",
    contentHash: "node-hash-abc",
  };
  const version = { id: "version_1", contentHash: "version-hash-xyz" };
  const document = { canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=1622" };

  it("prefixes citationKey with lawId when present", () => {
    const data = buildCitationEntryData(node, version, document, "1622");
    expect(data.citationKey).toBe("1622:article-17");
  });

  it("falls back to the bare locator when lawId is null", () => {
    const data = buildCitationEntryData(node, version, document, null);
    expect(data.citationKey).toBe("article-17");
  });

  it("preserves sourceLocator exactly as the citation locator — never rewritten or normalized", () => {
    const collisionNode = { ...node, id: "node_2", sourceLocator: "article-17__legacyId-cljabc123" };
    const data = buildCitationEntryData(collisionNode, version, document, "1622");
    expect(data.locator).toBe("article-17__legacyId-cljabc123");
    expect(data.citationKey).toBe("1622:article-17__legacyId-cljabc123");
  });

  it("copies exactText verbatim from the node — never truncated, summarized, or altered", () => {
    const data = buildCitationEntryData(node, version, document, "1622");
    expect(data.exactText).toBe(node.text);
  });

  it("uses the node's own contentHash when present", () => {
    const data = buildCitationEntryData(node, version, document, "1622");
    expect(data.contentHash).toBe("node-hash-abc");
  });

  it("falls back to the version's contentHash only when the node's own hash is empty", () => {
    const nodeWithoutHash = { ...node, contentHash: "" };
    const data = buildCitationEntryData(nodeWithoutHash, version, document, "1622");
    expect(data.contentHash).toBe("version-hash-xyz");
  });

  it("always marks a corpus-derived citation as VALID — it is not an LLM claim to verify", () => {
    const data = buildCitationEntryData(node, version, document, "1622");
    expect(data.status).toBe(CitationStatus.VALID);
  });

  it("carries the document's canonicalUrl as sourceUrl unchanged", () => {
    const data = buildCitationEntryData(node, version, document, "1622");
    expect(data.sourceUrl).toBe(document.canonicalUrl);
  });

  it("is deterministic: identical inputs produce a byte-identical result (idempotency precondition)", () => {
    const first = buildCitationEntryData(node, version, document, "1622");
    const second = buildCitationEntryData(node, version, document, "1622");
    expect(second).toEqual(first);
  });

  it("scopes documentVersionId/legalNodeId to their inputs — the exact compound key CitationEntry's @@unique([documentVersionId, legalNodeId]) upserts on", () => {
    const data = buildCitationEntryData(node, version, document, "1622");
    expect(data.documentVersionId).toBe(version.id);
    expect(data.legalNodeId).toBe(node.id);
  });
});

describe("backfill-citation-index: resolveLawId / lawIdFromUrl", () => {
  it("extracts lawId from a legalinfo.mn detail URL query parameter", () => {
    expect(lawIdFromUrl("https://legalinfo.mn/mn/detail?lawId=1622")).toBe("1622");
  });

  it("returns null for a URL with no lawId parameter", () => {
    expect(lawIdFromUrl("https://legalinfo.mn/mn/detail")).toBeNull();
  });

  it("returns null (not a throw) for an unparseable URL", () => {
    expect(lawIdFromUrl("not a url")).toBeNull();
  });

  it("prefers the URL's lawId over the document's documentNumber", () => {
    const lawId = resolveLawId({
      canonicalUrl: "https://legalinfo.mn/mn/detail?lawId=1622",
      documentNumber: "9999",
    });
    expect(lawId).toBe("1622");
  });

  it("falls back to documentNumber when the URL carries no lawId — the legacy corpus's case (migrate-legacy-tore-data.ts populated documentNumber from tore's law_id column, and legacy canonicalUrl values may or may not carry ?lawId=)", () => {
    const lawId = resolveLawId({
      canonicalUrl: "https://legalinfo.mn/mn/detail",
      documentNumber: "9999",
    });
    expect(lawId).toBe("9999");
  });

  it("returns null when neither the URL nor documentNumber has a value", () => {
    const lawId = resolveLawId({
      canonicalUrl: "https://legalinfo.mn/mn/detail",
      documentNumber: null,
    });
    expect(lawId).toBeNull();
  });
});
