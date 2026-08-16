import { LegalNodeType } from "../../domain/enums.js";

const ALLOWED_PARENTS: Record<LegalNodeType, readonly LegalNodeType[] | null> = {
  [LegalNodeType.DOCUMENT]: null,
  [LegalNodeType.BOOK]: [LegalNodeType.DOCUMENT],
  [LegalNodeType.PART]: [LegalNodeType.DOCUMENT, LegalNodeType.BOOK],
  [LegalNodeType.CHAPTER]: [LegalNodeType.DOCUMENT, LegalNodeType.PART],
  [LegalNodeType.SECTION]: [LegalNodeType.CHAPTER, LegalNodeType.PART, LegalNodeType.DOCUMENT],
  [LegalNodeType.ARTICLE]: [LegalNodeType.DOCUMENT, LegalNodeType.CHAPTER, LegalNodeType.SECTION],
  [LegalNodeType.PARAGRAPH]: [LegalNodeType.ARTICLE],
  [LegalNodeType.CLAUSE]: [LegalNodeType.PARAGRAPH],
  [LegalNodeType.SUB_CLAUSE]: [LegalNodeType.CLAUSE],
  [LegalNodeType.ANNEX]: [LegalNodeType.DOCUMENT, LegalNodeType.CHAPTER],
};

export function parentTypeAllowed(
  child: LegalNodeType,
  parent: LegalNodeType | null,
): boolean {
  const allowed = ALLOWED_PARENTS[child];
  if (allowed === null) {
    return parent === null;
  }
  return parent !== null && allowed.includes(parent);
}
