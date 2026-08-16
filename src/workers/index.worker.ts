import type { EngineWorker } from "./types.js";

export class IndexWorker implements EngineWorker {
  readonly name = "index" as const;

  async run(): Promise<void> {
    console.info("index worker idle — indexing disabled");
  }
}
