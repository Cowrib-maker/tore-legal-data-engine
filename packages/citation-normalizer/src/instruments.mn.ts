import type { CitationDocumentType, LegalInstrument } from "./types.js";

function instrument(
  code: string,
  documentType: CitationDocumentType,
  aliases: readonly string[],
): LegalInstrument {
  return {
    code,
    country: "MN",
    jurisdiction: "MN",
    documentType,
    aliases,
  };
}

export const MONGOLIA_INSTRUMENTS: readonly LegalInstrument[] = [
  instrument("CRIMINAL_CODE", "LAW", [
    "эх",
    "эрүүгийн хууль",
    "criminal code",
    "mongolian criminal code",
  ]),
  instrument("CIVIL_CODE", "LAW", ["их", "иргэний хууль", "civil code", "mongolian civil code"]),
  instrument("CONSTITUTION", "CONSTITUTION", [
    "үх",
    "үндсэн хууль",
    "constitution",
    "constitution of mongolia",
  ]),
  instrument("CRIMINAL_PROCEDURE", "LAW", [
    "эххштх",
    "эрүүгийн хэрэг хянан шийдвэрлэх тухай хууль",
    "criminal procedure",
    "criminal procedure code",
  ]),
  instrument("ADMINISTRATIVE_PROCEDURE", "LAW", [
    "зхшхштх",
    "захиргааны хэрэг шүүхэд хянан шийдвэрлэх тухай хууль",
    "administrative procedure",
    "administrative procedure code",
  ]),
  instrument("GOVERNMENT_RESOLUTION", "RESOLUTION", [
    "згт",
    "засгийн газрын тогтоол",
    "government resolution",
  ]),
  instrument("MINISTERIAL_ORDER", "ORDER", [
    "сайдын тушаал",
    "ministerial order",
    "minister's order",
  ]),
  instrument("INTERNATIONAL_TREATY", "TREATY", [
    "олон улсын гэрээ",
    "international treaty",
    "treaty",
  ]),
];
