import type { LegalDocument } from "../entities.js";

export type ParserInput = {
  html?: string;
  bytes?: Uint8Array;
  sourceUrl: string;
  mimeType?: string;
};

export interface ILegalParser {
  readonly id: string;
  parse(input: ParserInput): Promise<LegalDocument>;
}
