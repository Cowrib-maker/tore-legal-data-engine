import type { PrismaClient } from "@prisma/client";

import type {
  EngineRepositories,
  UnitOfWork,
} from "../../domain/ports/repositories.js";
import { createRepositories } from "./create-repositories.js";

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(work: (repos: EngineRepositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(createRepositories(tx)), {
      maxWait: 15_000,
      timeout: 180_000,
    });
  }
}
