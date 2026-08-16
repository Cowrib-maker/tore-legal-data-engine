import { lemmaToken } from "./text.js";
import { tokenizeCitation } from "./tokenize.js";
import type { LegalInstrument } from "./types.js";

export type CompiledAlias = {
  tokens: readonly string[];
  instrument: LegalInstrument;
};

export type InstrumentCatalog = {
  byCode: ReadonlyMap<string, LegalInstrument>;
  aliases: readonly CompiledAlias[];
};

export function compileInstrumentCatalog(
  instruments: readonly LegalInstrument[],
): InstrumentCatalog {
  const byCode = new Map<string, LegalInstrument>();
  const aliases: CompiledAlias[] = [];

  for (const instrument of instruments) {
    if (byCode.has(instrument.code)) {
      throw new Error(`duplicate instrument code: ${instrument.code}`);
    }
    byCode.set(instrument.code, instrument);
    const seen = new Set<string>();
    for (const alias of instrument.aliases) {
      const tokens = tokenizeCitation(alias).map(lemmaToken);
      if (tokens.length === 0) {
        continue;
      }
      const key = tokens.join(" ");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      aliases.push({ tokens, instrument });
    }
  }

  aliases.sort((left, right) => {
    if (right.tokens.length !== left.tokens.length) {
      return right.tokens.length - left.tokens.length;
    }
    return right.tokens.join(" ").length - left.tokens.join(" ").length;
  });

  return { byCode, aliases };
}

export function matchInstrument(
  tokens: readonly string[],
  catalog: InstrumentCatalog,
): { instrument: LegalInstrument; rest: string[] } | null {
  const lemmatized = tokens.map(lemmaToken);
  for (const alias of catalog.aliases) {
    const index = indexOfSequence(lemmatized, alias.tokens);
    if (index === -1) {
      continue;
    }
    return {
      instrument: alias.instrument,
      rest: [...tokens.slice(0, index), ...tokens.slice(index + alias.tokens.length)],
    };
  }
  return null;
}

function indexOfSequence(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) {
    return -1;
  }
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return start;
    }
  }
  return -1;
}
