export type CitationDocumentType =
  "LAW" | "CONSTITUTION" | "RESOLUTION" | "ORDER" | "TREATY" | "ADMINISTRATIVE_ACT" | "OTHER";

export type CanonicalCitation = {
  country: string | null;
  jurisdiction: string | null;
  code: string | null;
  documentType: CitationDocumentType | null;
  article: string | null;
  paragraph: string | null;
  subparagraph: string | null;
  item: string | null;
  originalText: string;
};

export interface CitationNormalizer {
  normalize(text: string): CanonicalCitation;
  normalizeMany(texts: readonly string[]): CanonicalCitation[];
}

export type LegalInstrument = {
  code: string;
  country: string;
  jurisdiction: string;
  documentType: CitationDocumentType;
  aliases: readonly string[];
};

export type Locator = {
  article: string | null;
  paragraph: string | null;
  subparagraph: string | null;
  item: string | null;
};
