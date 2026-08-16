import Fastify from "fastify";

import { createServiceAuthHook } from "../infrastructure/auth/service-auth.js";
import { createEngine } from "../infrastructure/compose.js";
import { loadEnv, type Env } from "../infrastructure/config/env.js";
import {
  retrieveRequestSchema,
  verifyCitationsRequestSchema,
  type HealthResponse,
  type RetrieveResponseDto,
  type VerifyCitationsResponse,
} from "./contracts.js";

const SERVICE = "tore-legal-data-engine";
const VERSION = "0.1.0";

export function buildServer(env: Env = loadEnv()) {
  const engine = createEngine(env);
  const app = Fastify({ logger: env.NODE_ENV !== "test" });

  app.addHook("preHandler", createServiceAuthHook({ token: env.ENGINE_SERVICE_TOKEN }));

  app.get("/v1/health", async (): Promise<HealthResponse> => {
    const [archiveHealth, postgres] = await Promise.all([
      engine.archiveStorage.health(),
      engine.databaseHealth.ping(),
    ]);
    return {
      ok: archiveHealth.ok && postgres.ok,
      service: SERVICE,
      version: VERSION,
      checkedAt: new Date().toISOString(),
      dependencies: {
        archive: archiveHealth,
        postgres,
      },
    };
  });

  app.post("/v1/citations/verify", async (request, reply) => {
    const parsed = verifyCitationsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.flatten(),
      });
    }
    const results = await engine.citations.verify(parsed.data.citations);
    const body: VerifyCitationsResponse = { results };
    return body;
  });

  app.post("/v1/retrieve", async (request, reply) => {
    const parsed = retrieveRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.flatten(),
      });
    }
    const body: RetrieveResponseDto = await engine.retrieval.retrieve(parsed.data);
    return body;
  });

  return { app, archive: engine.archive, env, engine };
}

export async function startServer(): Promise<void> {
  const env = loadEnv();
  const { app } = buildServer(env);
  await app.listen({ port: env.PORT, host: env.HOST });
}
