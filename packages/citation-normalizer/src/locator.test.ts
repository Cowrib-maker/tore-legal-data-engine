import { describe, expect, it } from "vitest";

import { parseLocator } from "./locator.js";
import { tokenizeCitation } from "./tokenize.js";

describe("locator grammar", () => {
  it.each([
    ["17", { article: "17", paragraph: null, subparagraph: null, item: null }],
    ["17.1", { article: "17", paragraph: "1", subparagraph: null, item: null }],
    ["17.1.2", { article: "17", paragraph: "1", subparagraph: "2", item: null }],
    ["17.1.2.3", { article: "17", paragraph: "1", subparagraph: "2", item: "3" }],
    ["17.1 дүгээр зүйл", { article: "17", paragraph: "1", subparagraph: null, item: null }],
    ["Article 17.1", { article: "17", paragraph: "1", subparagraph: null, item: null }],
    ["Art. 17(1)", { article: "17", paragraph: "1", subparagraph: null, item: null }],
    [
      "17 дугаар зүйлийн 1 дэх хэсгийн 2 дахь заалт",
      { article: "17", paragraph: "1", subparagraph: "2", item: null },
    ],
    [
      "17 дугаар зүйлийн 1 дэх хэсгийн 2 дахь заалтын 3 дахь цэг",
      { article: "17", paragraph: "1", subparagraph: "2", item: "3" },
    ],
  ])("parses %j", (text, locator) => {
    expect(parseLocator(tokenizeCitation(text))).toEqual(locator);
  });

  it("returns an empty locator when no numbers are present", () => {
    expect(parseLocator(tokenizeCitation("дүгээр зүйл"))).toEqual({
      article: null,
      paragraph: null,
      subparagraph: null,
      item: null,
    });
  });
});
