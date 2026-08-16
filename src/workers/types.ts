export type WorkerName = "ingest" | "parse" | "index";

export interface EngineWorker {
  readonly name: WorkerName;
  run(): Promise<void>;
}
