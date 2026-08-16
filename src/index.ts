import { startServer } from "./api/server.js";

startServer().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
