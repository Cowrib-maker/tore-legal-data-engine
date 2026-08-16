import { describe, expect, it } from "vitest";

import { VersionStatus } from "../../src/domain/enums.js";
import type { LegalDocumentVersion } from "../../src/domain/entities.js";
import { InvariantError } from "../../src/domain/errors.js";
import {
  assertDocumentVersion,
  isCanonicalizationUpdate,
  versionCoversInstant,
  versionsDoNotOverlap,
} from "../../src/domain/services/document-version.js";

function version(
  partial: Partial<LegalDocumentVersion> = {},
): LegalDocumentVersion {
  return {
    id: "v1",
    documentId: "doc",
    versionNumber: 1,
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    effectiveTo: "2021-12-31T23:59:59.000Z",
    contentHash: "abc",
    parserId: "legalinfo-html-v1",
    status: VersionStatus.PUBLISHED,
    amendmentDocumentId: null,
    archiveRecordId: "arc_1",
    nodes: [],
    ...partial,
  };
}

describe("document version validation", () => {
  it("accepts a monotonic interval and versionNumber >= 1", () => {
    expect(() => assertDocumentVersion(version())).not.toThrow();
  });

  it("rejects inverted effective interval", () => {
    expect(() =>
      assertDocumentVersion(
        version({
          effectiveFrom: "2022-01-01T00:00:00.000Z",
          effectiveTo: "2020-01-01T00:00:00.000Z",
        }),
      ),
    ).toThrow(InvariantError);
  });

  it("rejects versionNumber below 1", () => {
    expect(() => assertDocumentVersion(version({ versionNumber: 0 }))).toThrow(
      InvariantError,
    );
  });

  it("detects overlapping published versions", () => {
    expect(
      versionsDoNotOverlap([
        version({ id: "a", effectiveFrom: "2020-01-01T00:00:00.000Z", effectiveTo: null }),
        version({ id: "b", effectiveFrom: "2021-01-01T00:00:00.000Z", effectiveTo: null }),
      ]),
    ).toBe(false);
  });

  it("allows adjacent historical versions", () => {
    expect(
      versionsDoNotOverlap([
        version({
          id: "a",
          effectiveFrom: "2020-01-01T00:00:00.000Z",
          effectiveTo: "2020-12-31T23:59:59.000Z",
        }),
        version({
          id: "b",
          versionNumber: 2,
          effectiveFrom: "2021-01-01T00:00:00.000Z",
          effectiveTo: null,
        }),
      ]),
    ).toBe(true);
  });

  it("covers as-of instants only for closed intervals", () => {
    expect(
      versionCoversInstant(
        version({
          status: VersionStatus.SUPERSEDED,
          effectiveFrom: "2020-01-01T00:00:00.000Z",
          effectiveTo: "2021-01-01T00:00:00.000Z",
        }),
        "2020-06-01T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      versionCoversInstant(
        version({
          status: VersionStatus.SUPERSEDED,
          effectiveFrom: null,
          effectiveTo: null,
        }),
        "2020-06-01T00:00:00.000Z",
      ),
    ).toBe(false);
    expect(
      versionCoversInstant(
        version({
          status: VersionStatus.PUBLISHED,
          effectiveFrom: null,
          effectiveTo: null,
        }),
        "2020-06-01T00:00:00.000Z",
      ),
    ).toBe(false);
    expect(
      versionCoversInstant(
        version({
          status: VersionStatus.PUBLISHED,
          effectiveFrom: "2020-01-01T00:00:00.000Z",
          effectiveTo: null,
        }),
        "2020-06-01T00:00:00.000Z",
      ),
    ).toBe(false);
    expect(
      versionCoversInstant(
        version({
          effectiveFrom: "2020-01-01T00:00:00.000Z",
          effectiveTo: "2021-01-01T00:00:00.000Z",
        }),
        "2021-01-01T00:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("detects canonicalization updates from same source + different parserId", () => {
    expect(
      isCanonicalizationUpdate(
        version({ parserId: "legalinfo-html-v1" }),
        version({ parserId: "legalinfo-html-v2" }),
      ),
    ).toBe(true);
    expect(
      isCanonicalizationUpdate(
        version({ parserId: "legalinfo-html-v1" }),
        version({ parserId: "legalinfo-html-v1" }),
      ),
    ).toBe(false);
    expect(
      isCanonicalizationUpdate(
        version({ contentHash: "a", parserId: "legalinfo-html-v1" }),
        version({ contentHash: "b", parserId: "legalinfo-html-v2" }),
      ),
    ).toBe(false);
  });
});
