import type { FastifyReply, FastifyRequest } from "fastify";

export type ServiceAuthConfig = {
  token: string;
  publicPaths?: readonly string[];
};

export function createServiceAuthHook(config: ServiceAuthConfig) {
  const publicPaths = new Set(config.publicPaths ?? ["/v1/health"]);

  return async function serviceAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (publicPaths.has(request.url.split("?")[0] ?? request.url)) {
      return;
    }

    const header = request.headers.authorization;
    const token = bearerToken(header) ?? headerString(request.headers["x-service-token"]);

    if (!token || token !== config.token) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Valid service credential required",
      });
    }
  };
}

function bearerToken(header: string | string[] | undefined): string | null {
  const value = headerString(header);
  if (!value?.startsWith("Bearer ")) {
    return null;
  }
  return value.slice("Bearer ".length).trim() || null;
}

function headerString(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

export interface ServiceAuthenticator {
  authenticate(authorizationHeader: string | undefined): boolean;
}

export class SharedSecretAuthenticator implements ServiceAuthenticator {
  constructor(private readonly token: string) {}

  authenticate(authorizationHeader: string | undefined): boolean {
    const token = bearerToken(authorizationHeader);
    return token === this.token;
  }
}
