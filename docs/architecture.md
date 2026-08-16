# Architecture

TORE Legal Data Engine is the legal data backbone for TORE Legal AI.

This document describes the repository foundation only.

## Purpose

Provide a shared TypeScript workspace for future legal-data services:

- `apps/api`
- `apps/scraper`
- `apps/parser`
- `apps/worker`

Shared libraries live in `packages/`.

## Layout

```text
apps/        process entrypoints
packages/    shared libraries
docs/        documentation
scripts/     operational scripts
docker/      container build files
prisma/      PostgreSQL schema
```

## Packages

| Package    | Role                                     |
| ---------- | ---------------------------------------- |
| `common`   | Shared utilities and environment loading |
| `logger`   | Pino logger factory                      |
| `db`       | Placeholder for the Prisma database layer |
| `storage`  | Placeholder                              |
| `queue`    | Placeholder                              |
| `citation` | Placeholder                              |
| `chunker`  | Placeholder                              |
| `core`     | Placeholder                              |

Each package currently exports a placeholder surface only.

## Apps

Each app has a bootstrap file. Apps do not contain business logic yet.

## Data

PostgreSQL is the database. Prisma schema lives in `prisma/schema.prisma`. The schema has no domain models yet.

## Tooling

- pnpm workspaces
- Turborepo task orchestration
- TypeScript project references
- ESLint and Prettier
- Vitest
- Docker Compose for PostgreSQL
- GitHub Actions CI (`format`, `lint`, `typecheck`, `test`, `build`)

## Out of scope

This foundation does not include scrapers, parsers, AI, embeddings, or domain workflows.
