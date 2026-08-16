import type { EngineWorker } from "./types.js";

export class ParseWorker implements EngineWorker {
  readonly name = "parse" as const;

  async run(): Promise<void> {
    console.info("parse worker idle — parsing disabled");
  }
}
