import { ParseWorker } from "./parse.worker.js";

const worker = new ParseWorker();
worker.run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
