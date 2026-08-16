import type { PrismaClient } from "@prisma/client";

import type { DatabaseHealth } from "../../domain/ports/repositories.js";

export class PrismaDatabaseHealth implements DatabaseHealth {
  constructor(private readonly prisma: PrismaClient) {}

  async ping(): Promise<{ ok: boolean; storage: string; detail: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, storage: "postgresql", detail: "connected" };
    } catch {
      return { ok: false, storage: "postgresql", detail: "unavailable" };
    }
  }
}
