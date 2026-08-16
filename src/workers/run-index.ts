import { IndexWorker } from "./index.worker.js";

const worker = new IndexWorker();
worker.run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
