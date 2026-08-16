import { VersionStatus } from "../enums.js";
import { InvariantError } from "../errors.js";
import type { LegalDocumentVersion } from "../entities.js";

export function assertDocumentVersion(version: LegalDocumentVersion): void {
  if (!Number.isInteger(version.versionNumber) || version.versionNumber < 1) {
    throw new InvariantError("versionNumber must be an integer >= 1");
  }
  if (!version.contentHash.trim()) {
    throw new InvariantError("contentHash is required");
  }
  if (!version.parserId.trim()) {
    throw new InvariantError("parserId is required");
  }
  if (!version.archiveRecordId.trim()) {
    throw new InvariantError("archiveRecordId is required");
  }

  const from = parseOptionalInstant(version.effectiveFrom, "effectiveFrom");
  const to = parseOptionalInstant(version.effectiveTo, "effectiveTo");
  if (from && to && from > to) {
    throw new InvariantError("effectiveFrom must be <= effectiveTo");
  }
}

/**
 * Same source bytes + different parser => canonicalization update, not a new enactment.
 * Derived; no separate versionKind column.
 */
export function isCanonicalizationUpdate(
  existing: Pick<LegalDocumentVersion, "contentHash" | "archiveRecordId" | "parserId">,
  next: Pick<LegalDocumentVersion, "contentHash" | "archiveRecordId" | "parserId">,
): boolean {
  return (
    existing.contentHash === next.contentHash &&
    existing.archiveRecordId === next.archiveRecordId &&
    existing.parserId !== next.parserId
  );
}

export function versionsDoNotOverlap(
  versions: readonly Pick<
    LegalDocumentVersion,
    "id" | "effectiveFrom" | "effectiveTo" | "status"
  >[],
): boolean {
  const published = versions.filter((item) => item.status === VersionStatus.PUBLISHED);
  for (let i = 0; i < published.length; i += 1) {
    for (let j = i + 1; j < published.length; j += 1) {
      if (intervalsOverlap(published[i], published[j])) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Historical as-of requires a closed interval. Null bounds are unknown, not
 * open-ended coverage. Do not invent applicability.
 */
export function versionHasAsOfProvenance(
  version: Pick<LegalDocumentVersion, "effectiveFrom" | "effectiveTo">,
): boolean {
  return Boolean(version.effectiveFrom && version.effectiveTo);
}

/**
 * Interval membership for as-of selection.
 * A version matches only when both effectiveFrom and effectiveTo are known
 * and the instant is in [effectiveFrom, effectiveTo).
 */
export function versionCoversInstant(
  version: Pick<LegalDocumentVersion, "effectiveFrom" | "effectiveTo" | "status">,
  instantIso: string,
): boolean {
  const instant = Date.parse(instantIso);
  if (Number.isNaN(instant)) {
    return false;
  }
  if (!versionHasAsOfProvenance(version)) {
    return false;
  }
  const from = Date.parse(version.effectiveFrom!);
  const to = Date.parse(version.effectiveTo!);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return false;
  }
  return from <= instant && instant < to;
}

function intervalsOverlap(
  a: Pick<LegalDocumentVersion, "effectiveFrom" | "effectiveTo">,
  b: Pick<LegalDocumentVersion, "effectiveFrom" | "effectiveTo">,
): boolean {
  const aFrom = a.effectiveFrom ? Date.parse(a.effectiveFrom) : Number.NEGATIVE_INFINITY;
  const aTo = a.effectiveTo ? Date.parse(a.effectiveTo) : Number.POSITIVE_INFINITY;
  const bFrom = b.effectiveFrom ? Date.parse(b.effectiveFrom) : Number.NEGATIVE_INFINITY;
  const bTo = b.effectiveTo ? Date.parse(b.effectiveTo) : Number.POSITIVE_INFINITY;
  return aFrom <= bTo && bFrom <= aTo;
}

function parseOptionalInstant(value: string | null, field: string): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new InvariantError(`${field} is not a valid ISO-8601 timestamp`);
  }
  return parsed;
}
