import { describe, expect, it } from "vitest";

import { createCitationNormalizer } from "./rule-based-normalizer.js";
import type { CanonicalCitation } from "./types.js";

const unidentified = {
  country: null,
  jurisdiction: null,
  code: null,
  documentType: null,
} as const;

const criminal = {
  country: "MN",
  jurisdiction: "MN",
  code: "CRIMINAL_CODE",
  documentType: "LAW",
} as const;

function expectCitation(
  text: string,
  expected: Omit<CanonicalCitation, "originalText">,
  normalizer = createCitationNormalizer(),
): CanonicalCitation {
  const actual = normalizer.normalize(text);
  expect(actual).toEqual({ ...expected, originalText: text });
  return actual;
}

describe("RuleBasedCitationNormalizer", () => {
  const normalizer = createCitationNormalizer();

  describe("never infers an instrument", () => {
    it.each([
      ["17.1", { article: "17", paragraph: "1", subparagraph: null, item: null }],
      ["17.1 дүгээр зүйл", { article: "17", paragraph: "1", subparagraph: null, item: null }],
      ["17 дугаар зүйл", { article: "17", paragraph: null, subparagraph: null, item: null }],
      [
        "17 дугаар зүйлийн 1 дэх хэсэг",
        { article: "17", paragraph: "1", subparagraph: null, item: null },
      ],
      ["Article 17.1", { article: "17", paragraph: "1", subparagraph: null, item: null }],
      ["Art. 17(1)", { article: "17", paragraph: "1", subparagraph: null, item: null }],
      ["17.1.2.3", { article: "17", paragraph: "1", subparagraph: "2", item: "3" }],
    ] as const)("keeps code and documentType null for %j", (text, locator) => {
      expectCitation(text, { ...unidentified, ...locator });
    });

    it("does not guess from surrounding words", () => {
      expectCitation("according to 17.1 the court held", {
        ...unidentified,
        article: "17",
        paragraph: "1",
        subparagraph: null,
        item: null,
      });
    });

    it("does not treat ordinary prose as a legal instrument", () => {
      expectCitation("not a citation", {
        ...unidentified,
        article: null,
        paragraph: null,
        subparagraph: null,
        item: null,
      });
    });

    it("preserves blank original text without inventing fields", () => {
      expectCitation("   ", {
        ...unidentified,
        article: null,
        paragraph: null,
        subparagraph: null,
        item: null,
      });
      expectCitation("", {
        ...unidentified,
        article: null,
        paragraph: null,
        subparagraph: null,
        item: null,
      });
    });
  });

  describe("explicit criminal-code identification", () => {
    it.each([
      "ЭХ 17.1",
      "Эрүүгийн хууль 17.1",
      "Эрүүгийн хуулийн 17.1",
      "Criminal Code Article 17.1",
      "Эрүүгийн хуулийн 17 дугаар зүйлийн 1 дэх хэсэг",
      "Criminal Code Article 17(1)",
      "Mongolian Criminal Code Art. 17.1",
    ])("sets CRIMINAL_CODE for %j", (text) => {
      expectCitation(text, {
        ...criminal,
        article: "17",
        paragraph: "1",
        subparagraph: null,
        item: null,
      });
    });

    it("keeps an explicit instrument even when no article is present", () => {
      expectCitation("ЭХ", {
        ...criminal,
        article: null,
        paragraph: null,
        subparagraph: null,
        item: null,
      });
    });
  });

  describe("other explicit instruments", () => {
    it("normalizes civil-code aliases", () => {
      expectCitation("ИХ 15.2", {
        country: "MN",
        jurisdiction: "MN",
        code: "CIVIL_CODE",
        documentType: "LAW",
        article: "15",
        paragraph: "2",
        subparagraph: null,
        item: null,
      });
      expectCitation("Civil Code Article 15.2", {
        country: "MN",
        jurisdiction: "MN",
        code: "CIVIL_CODE",
        documentType: "LAW",
        article: "15",
        paragraph: "2",
        subparagraph: null,
        item: null,
      });
    });

    it("normalizes constitution aliases", () => {
      expectCitation("Үндсэн хуулийн 16 дугаар зүйл", {
        country: "MN",
        jurisdiction: "MN",
        code: "CONSTITUTION",
        documentType: "CONSTITUTION",
        article: "16",
        paragraph: null,
        subparagraph: null,
        item: null,
      });
      expectCitation("Constitution Article 16.2", {
        country: "MN",
        jurisdiction: "MN",
        code: "CONSTITUTION",
        documentType: "CONSTITUTION",
        article: "16",
        paragraph: "2",
        subparagraph: null,
        item: null,
      });
    });

    it("normalizes procedure, resolution, order, and treaty aliases", () => {
      expectCitation("Эрүүгийн хэрэг хянан шийдвэрлэх тухай хууль 10.1", {
        country: "MN",
        jurisdiction: "MN",
        code: "CRIMINAL_PROCEDURE",
        documentType: "LAW",
        article: "10",
        paragraph: "1",
        subparagraph: null,
        item: null,
      });
      expectCitation("Administrative Procedure Code 4.2", {
        country: "MN",
        jurisdiction: "MN",
        code: "ADMINISTRATIVE_PROCEDURE",
        documentType: "LAW",
        article: "4",
        paragraph: "2",
        subparagraph: null,
        item: null,
      });
      expectCitation("Government Resolution 12.1", {
        country: "MN",
        jurisdiction: "MN",
        code: "GOVERNMENT_RESOLUTION",
        documentType: "RESOLUTION",
        article: "12",
        paragraph: "1",
        subparagraph: null,
        item: null,
      });
      expectCitation("Сайдын тушаал 8", {
        country: "MN",
        jurisdiction: "MN",
        code: "MINISTERIAL_ORDER",
        documentType: "ORDER",
        article: "8",
        paragraph: null,
        subparagraph: null,
        item: null,
      });
      expectCitation("International Treaty 3.1", {
        country: "MN",
        jurisdiction: "MN",
        code: "INTERNATIONAL_TREATY",
        documentType: "TREATY",
        article: "3",
        paragraph: "1",
        subparagraph: null,
        item: null,
      });
    });
  });

  it("splits deeper dotted locators after an explicit instrument", () => {
    expectCitation("ЭХ 17.1.2.3", {
      ...criminal,
      article: "17",
      paragraph: "1",
      subparagraph: "2",
      item: "3",
    });
  });

  it("normalizes a mixed batch without filling missing instruments", () => {
    const texts = ["17.1", "ЭХ 17.1", "Criminal Code Article 17.1", "17.1 дүгээр зүйл"];
    const [bare, abbreviated, english, labeled] = normalizer.normalizeMany(texts);

    expect(bare).toEqual({
      ...unidentified,
      article: "17",
      paragraph: "1",
      subparagraph: null,
      item: null,
      originalText: "17.1",
    });
    expect(abbreviated).toEqual({
      ...criminal,
      article: "17",
      paragraph: "1",
      subparagraph: null,
      item: null,
      originalText: "ЭХ 17.1",
    });
    expect(english).toEqual({
      ...criminal,
      article: "17",
      paragraph: "1",
      subparagraph: null,
      item: null,
      originalText: "Criminal Code Article 17.1",
    });
    expect(labeled).toEqual({
      ...unidentified,
      article: "17",
      paragraph: "1",
      subparagraph: null,
      item: null,
      originalText: "17.1 дүгээр зүйл",
    });
  });

  it("uses only caller-supplied instruments and still does not guess", () => {
    const custom = createCitationNormalizer({
      instruments: [
        {
          code: "CUSTOM_CODE",
          country: "MN",
          jurisdiction: "MN",
          documentType: "LAW",
          aliases: ["custom code"],
        },
      ],
    });

    expectCitation(
      "Custom Code 9.1",
      {
        country: "MN",
        jurisdiction: "MN",
        code: "CUSTOM_CODE",
        documentType: "LAW",
        article: "9",
        paragraph: "1",
        subparagraph: null,
        item: null,
      },
      custom,
    );
    expectCitation(
      "ЭХ 17.1",
      {
        ...unidentified,
        article: "17",
        paragraph: "1",
        subparagraph: null,
        item: null,
      },
      custom,
    );
  });
});
