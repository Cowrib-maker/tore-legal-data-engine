export const PACKAGE_NAME = "@tore-legal-data-engine/citation-normalizer" as const;

export { compileInstrumentCatalog, matchInstrument } from "./catalog.js";
export { MONGOLIA_INSTRUMENTS } from "./instruments.mn.js";
export { parseLocator } from "./locator.js";
export { createCitationNormalizer, RuleBasedCitationNormalizer } from "./rule-based-normalizer.js";
export { tokenizeCitation } from "./tokenize.js";

export type { InstrumentCatalog } from "./catalog.js";
export type { RuleBasedNormalizerOptions } from "./rule-based-normalizer.js";
export type {
  CanonicalCitation,
  CitationDocumentType,
  CitationNormalizer,
  LegalInstrument,
  Locator,
} from "./types.js";
