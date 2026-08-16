import { IngestWorker } from "./ingest.worker.js";

const worker = new IngestWorker();
worker.run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
