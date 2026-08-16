import type { LegalDocument } from "../domain/entities.js";
import type { ILegalParser, ParserInput } from "../domain/ports/legal-parser.js";

export type { ILegalParser, ParserInput } from "../domain/ports/legal-parser.js";

export class UnimplementedLegalParser implements ILegalParser {
  readonly id = "unimplemented";

  async parse(_input: ParserInput): Promise<LegalDocument> {
    throw new Error("Use LegalInfoHtmlParser for LegalInfo HTML");
  }
}
