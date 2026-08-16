export const INSERTED_ARTICLE_EXPECTATIONS: Array<{ lawId: string; locator: string }> = [
  { lawId: "8928", locator: "art-2^1" },
  { lawId: "8928", locator: "art-32^1" },
  { lawId: "8669", locator: "art-29^1" },
  { lawId: "29", locator: "art-6^1" },
  { lawId: "29", locator: "art-17^1" },
  { lawId: "29", locator: "art-19^1" },
  { lawId: "29", locator: "art-19^2" },
  { lawId: "299", locator: "art-42^1" },
  { lawId: "216", locator: "art-44^1" },
  { lawId: "218", locator: "art-8^1" },
  { lawId: "218", locator: "art-41^1" },
  { lawId: "302", locator: "ch-7^1" },
  { lawId: "302", locator: "ch-12^1" },
];

export const HISTORY_LOCATORS_BY_LAW: Record<string, string[]> = {
  "29": [
    "art-6/p-1/c-1",
    "art-6/p-1/c-3",
    "art-6/p-1/c-6",
    "art-6/p-1/c-8",
    "art-15/p-3",
    "art-15/p-4",
  ],
};

export const NEGATIVE_LOCATORS = [
  "art-99999",
  "art-99999/p-99999",
  "art-99999/p-99999/c-99999",
] as const;

export function lawIdFromCanonicalUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("lawId");
  } catch {
    return null;
  }
}
