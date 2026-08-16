import type { DocumentType } from "@tore-legal-data-engine/db";

export const LEGALINFO_SOURCE_NAME = "LegalInfo";
export const LEGALINFO_COUNTRY = "MN";
export const LEGALINFO_OFFICIAL_URL = "https://legalinfo.mn";

export const FALLBACK_CATEGORY_IDS = [
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "180",
  "186",
  "390",
  "16231124857801",
] as const;

const DOCUMENT_TYPE_BY_CATEGORY: Record<string, DocumentType> = {
  "26": "CONSTITUTION",
  "27": "LAW",
  "28": "RESOLUTION",
  "29": "TREATY",
  "30": "ORDER",
  "31": "COURT_DECISION",
  "32": "COURT_DECISION",
  "33": "RESOLUTION",
  "34": "ORDER",
  "35": "ORDER",
  "36": "ADMINISTRATIVE_ACT",
  "37": "ADMINISTRATIVE_ACT",
  "38": "ADMINISTRATIVE_ACT",
  "180": "OTHER",
  "186": "OTHER",
  "390": "OTHER",
  "16231124857801": "OTHER",
};

export type LegalInfoCategory = {
  id: string;
  name?: string;
};

export function documentTypeForCategory(categoryId: string): DocumentType {
  return DOCUMENT_TYPE_BY_CATEGORY[categoryId] ?? "OTHER";
}

export function uniqueCategories(categories: LegalInfoCategory[]): LegalInfoCategory[] {
  const seen = new Set<string>();
  const unique: LegalInfoCategory[] = [];
  for (const category of categories) {
    if (seen.has(category.id)) {
      continue;
    }
    seen.add(category.id);
    unique.push(category);
  }
  return unique;
}
