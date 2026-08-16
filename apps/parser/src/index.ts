import { loadEnv } from "@tore-legal-data-engine/common";
import { createLogger } from "@tore-legal-data-engine/logger";

loadEnv();

const logger = createLogger("parser");
logger.info("parser bootstrap");
