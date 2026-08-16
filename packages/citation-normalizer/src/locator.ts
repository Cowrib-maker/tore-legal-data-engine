import { lemmaToken } from "./text.js";
import { parseNumberParts } from "./tokenize.js";
import type { Locator } from "./types.js";

const LOCATOR_LEVELS = ["article", "paragraph", "subparagraph", "item"] as const;

type LocatorLevel = (typeof LOCATOR_LEVELS)[number];

const ARTICLE_WORDS = new Set(["зүйл", "article", "articles", "art"]);
const PARAGRAPH_WORDS = new Set([
  "хэсэг",
  "paragraph",
  "paragraphs",
  "para",
  "section",
  "sections",
]);
const SUBPARAGRAPH_WORDS = new Set(["заалт", "subparagraph", "subpara", "clause", "clauses"]);
const ITEM_WORDS = new Set(["цэг", "item", "items", "point", "points"]);
const SKIP_WORDS = new Set([
  "дүгээр",
  "дугаар",
  "дэх",
  "дахь",
  "the",
  "of",
  "no",
  "number",
  "тухай",
  "and",
]);

export function emptyLocator(): Locator {
  return {
    article: null,
    paragraph: null,
    subparagraph: null,
    item: null,
  };
}

export function parseLocator(tokens: readonly string[]): Locator {
  const locator = emptyLocator();
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || isIgnorable(token)) {
      index += 1;
      continue;
    }

    const role = roleOf(token);
    if (role) {
      const number = nextNumber(tokens, index + 1);
      if (number) {
        assignFromLevel(locator, role, number.parts);
        index = number.index + 1;
        continue;
      }
      index += 1;
      continue;
    }

    const parts = parseNumberParts(token);
    if (parts) {
      const labeled = nextRole(tokens, index + 1);
      if (labeled) {
        assignFromLevel(locator, labeled.role, parts);
        index = labeled.index + 1;
        continue;
      }
      if (!locator.article) {
        assignFromLevel(locator, "article", parts);
      } else {
        assignNextEmpty(locator, parts);
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return locator;
}

function nextNumber(
  tokens: readonly string[],
  start: number,
): { parts: string[]; index: number } | null {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || isIgnorable(token)) {
      continue;
    }
    if (roleOf(token)) {
      return null;
    }
    const parts = parseNumberParts(token);
    if (parts) {
      return { parts, index };
    }
    return null;
  }
  return null;
}

function nextRole(
  tokens: readonly string[],
  start: number,
): { role: LocatorLevel; index: number } | null {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || isIgnorable(token)) {
      continue;
    }
    const role = roleOf(token);
    if (role) {
      return { role, index };
    }
    if (parseNumberParts(token)) {
      return null;
    }
    return null;
  }
  return null;
}

function assignFromLevel(locator: Locator, start: LocatorLevel, parts: readonly string[]): void {
  let offset = LOCATOR_LEVELS.indexOf(start);
  for (const part of parts) {
    const level = LOCATOR_LEVELS[offset];
    if (!level) {
      locator.item = locator.item ? `${locator.item}.${part}` : part;
      continue;
    }
    if (locator[level] === null) {
      locator[level] = part;
    }
    offset += 1;
  }
}

function assignNextEmpty(locator: Locator, parts: readonly string[]): void {
  const start = LOCATOR_LEVELS.find((level) => locator[level] === null) ?? "item";
  assignFromLevel(locator, start, parts);
}

function roleOf(token: string): LocatorLevel | null {
  const lemma = lemmaToken(token);
  if (ARTICLE_WORDS.has(lemma) || ARTICLE_WORDS.has(token)) {
    return "article";
  }
  if (PARAGRAPH_WORDS.has(lemma) || PARAGRAPH_WORDS.has(token)) {
    return "paragraph";
  }
  if (SUBPARAGRAPH_WORDS.has(lemma) || SUBPARAGRAPH_WORDS.has(token)) {
    return "subparagraph";
  }
  if (ITEM_WORDS.has(lemma) || ITEM_WORDS.has(token)) {
    return "item";
  }
  return null;
}

function isIgnorable(token: string): boolean {
  return (
    token === "(" || token === ")" || SKIP_WORDS.has(token) || SKIP_WORDS.has(lemmaToken(token))
  );
}
