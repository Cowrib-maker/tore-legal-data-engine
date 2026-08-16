import { foldCitationText } from "./text.js";

const TOKEN_PATTERN = /\d+(?:[.-]\d+)*|\p{L}+|[()]/gu;

export function tokenizeCitation(text: string): string[] {
  const folded = foldCitationText(text);
  if (!folded) {
    return [];
  }
  return folded.match(TOKEN_PATTERN) ?? [];
}

export function parseNumberParts(token: string): string[] | null {
  if (!/^\d/.test(token)) {
    return null;
  }
  const parts = token.split(/[.-]/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : null;
}
