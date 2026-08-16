import { compileInstrumentCatalog, matchInstrument, type InstrumentCatalog } from "./catalog.js";
import { MONGOLIA_INSTRUMENTS } from "./instruments.mn.js";
import { parseLocator } from "./locator.js";
import { tokenizeCitation } from "./tokenize.js";
import type { CanonicalCitation, CitationNormalizer, LegalInstrument } from "./types.js";

export type RuleBasedNormalizerOptions = {
  instruments?: readonly LegalInstrument[];
};

export class RuleBasedCitationNormalizer implements CitationNormalizer {
  private readonly catalog: InstrumentCatalog;

  constructor(options: RuleBasedNormalizerOptions = {}) {
    this.catalog = compileInstrumentCatalog(options.instruments ?? MONGOLIA_INSTRUMENTS);
  }

  normalize(text: string): CanonicalCitation {
    const tokens = tokenizeCitation(text);
    const matched = matchInstrument(tokens, this.catalog);
    const locator = parseLocator(matched?.rest ?? tokens);
    const instrument = matched?.instrument ?? null;

    return {
      country: instrument?.country ?? null,
      jurisdiction: instrument?.jurisdiction ?? null,
      code: instrument?.code ?? null,
      documentType: instrument?.documentType ?? null,
      article: locator.article,
      paragraph: locator.paragraph,
      subparagraph: locator.subparagraph,
      item: locator.item,
      originalText: text,
    };
  }

  normalizeMany(texts: readonly string[]): CanonicalCitation[] {
    return texts.map((item) => this.normalize(item));
  }
}

export function createCitationNormalizer(
  options: RuleBasedNormalizerOptions = {},
): CitationNormalizer {
  return new RuleBasedCitationNormalizer(options);
}
