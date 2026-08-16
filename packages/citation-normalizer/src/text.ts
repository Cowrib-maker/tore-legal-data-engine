const ABBREVIATIONS: ReadonlyArray<readonly [string, string]> = [
  ["art.", "article"],
  ["para.", "paragraph"],
  ["subpara.", "subparagraph"],
  ["sec.", "section"],
  ["no.", "number"],
];

const LEMMAS = new Map<string, string>([
  ["хуулийн", "хууль"],
  ["зүйлийн", "зүйл"],
  ["хэсгийн", "хэсэг"],
  ["заалтын", "заалт"],
  ["цэгийн", "цэг"],
  ["тогтоолын", "тогтоол"],
  ["тушаалын", "тушаал"],
  ["гэрээний", "гэрээ"],
]);

export function foldCitationText(text: string): string {
  let folded = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[«»“”"]/g, " ");
  folded = folded.replace(/['’]/g, "");
  folded = folded.replace(/§/g, " paragraph ");
  folded = folded.replace(/№/g, " ");
  for (const [from, to] of ABBREVIATIONS) {
    folded = replaceAllLiteral(folded, from, ` ${to} `);
  }
  return folded.replace(/\s+/g, " ").trim();
}

export function lemmaToken(token: string): string {
  return LEMMAS.get(token) ?? token;
}

function replaceAllLiteral(haystack: string, needle: string, replacement: string): string {
  return haystack.split(needle).join(replacement);
}
