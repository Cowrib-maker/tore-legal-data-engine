import { describe, expect, it } from "vitest";

import { compileInstrumentCatalog, matchInstrument } from "./catalog.js";
import { MONGOLIA_INSTRUMENTS } from "./instruments.mn.js";
import { tokenizeCitation } from "./tokenize.js";

describe("instrument catalog", () => {
  const catalog = compileInstrumentCatalog(MONGOLIA_INSTRUMENTS);

  it.each([
    ["ЭХ 17.1", "CRIMINAL_CODE", ["17.1"]],
    ["Эрүүгийн хуулийн 17.1", "CRIMINAL_CODE", ["17.1"]],
    ["Criminal Code Article 17.1", "CRIMINAL_CODE", ["article", "17.1"]],
    ["ИХ 15.2", "CIVIL_CODE", ["15.2"]],
    ["ҮХ 16", "CONSTITUTION", ["16"]],
    ["ЗГТ 12.1", "GOVERNMENT_RESOLUTION", ["12.1"]],
  ])("matches %j to %s", (text, code, rest) => {
    const matched = matchInstrument(tokenizeCitation(text), catalog);
    expect(matched?.instrument.code).toBe(code);
    expect(matched?.rest).toEqual(rest);
  });

  it("does not treat locator words as instrument abbreviations", () => {
    expect(matchInstrument(tokenizeCitation("17.1 дүгээр зүйл"), catalog)).toBeNull();
    expect(matchInstrument(tokenizeCitation("17.1 дэх хэсэг"), catalog)).toBeNull();
    expect(matchInstrument(tokenizeCitation("17.1"), catalog)).toBeNull();
    expect(matchInstrument(tokenizeCitation("Article 17.1"), catalog)).toBeNull();
  });

  it("prefers the longer criminal-procedure title over criminal code", () => {
    const matched = matchInstrument(
      tokenizeCitation("Эрүүгийн хэрэг хянан шийдвэрлэх тухай хууль 10.1"),
      catalog,
    );
    expect(matched?.instrument.code).toBe("CRIMINAL_PROCEDURE");
  });

  it("rejects duplicate instrument codes", () => {
    expect(() =>
      compileInstrumentCatalog([
        {
          code: "CRIMINAL_CODE",
          country: "MN",
          jurisdiction: "MN",
          documentType: "LAW",
          aliases: ["эх"],
        },
        {
          code: "CRIMINAL_CODE",
          country: "MN",
          jurisdiction: "MN",
          documentType: "LAW",
          aliases: ["criminal code"],
        },
      ]),
    ).toThrow(/duplicate instrument code/);
  });
});
