import type { EngineWorker } from "./types.js";

export class IngestWorker implements EngineWorker {
  readonly name = "ingest" as const;

  async run(): Promise<void> {
    console.info("ingest worker idle — crawl disabled");
  }
}
