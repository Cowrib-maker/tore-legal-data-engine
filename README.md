# tore-legal-data-engine

Backend **Legal Data Engine** for the TORE Legal Operating System.

This service will ingest official legal sources, archive original bytes, parse them into a canonical structure, version instruments, verify citations, and expose retrieval APIs to the TORE platform.

It is **not** the TORE marketplace app. There is no Next.js, no end-user login, and no PII.

## Phase 1 (this repository)

Foundation only:

- Hexagonal layout (`domain` / `application` / `infrastructure` / `api` / `workers` / `parsers`)
- Prisma schema for the public-law corpus
- Immutable archive port + local filesystem adapter (SHA-256 identity, `putIfAbsent`)
- Connector / downloader / parser **interfaces** (LegalInfo placeholder; **no crawl**)
- Citation validator interface (`VALID` | `UNRESOLVED` | `CONFLICT`)
- HTTP: `GET /v1/health`, `POST /v1/citations/verify`, `POST /v1/retrieve`
- Service-to-service auth (shared secret)
- Worker entrypoints (idle)

Not in phase 1: OpenAI/Claude, embeddings, RAG, vector search, live LegalInfo crawl, production S3, user auth, billing, frontend.

## Stack

TypeScript, Node.js 22, PostgreSQL, Prisma, Redis, S3-compatible storage (later), Vitest, Docker, GitHub Actions.

## Local development

```bash
cp .env.example .env
docker compose up -d
# Postgres is published on localhost:5433 to avoid clashing with the TORE platform DB.
npm install
npx prisma migrate dev --name init
npm test
npm run lint
npm run typecheck
npm run dev
```

Health (no service token):

```bash
curl http://localhost:8080/v1/health
```

Verify citations (service token required):

```bash
curl -s http://localhost:8080/v1/citations/verify \
  -H "Authorization: Bearer $ENGINE_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"citations":[{"query":"Иргэний хууль 5"}]}'
```

## Phase 2

PostgreSQL is the source of truth for corpus metadata. Original bytes stay on the local filesystem; archive identity is SHA-256.

Deterministic retrieve/verify look up published rows by document id, node id, citation key, or locator. There is no vector search or RAG in this phase.

Integration tests need Postgres:

```bash
docker compose up -d postgres
npx prisma migrate deploy
npm test
```

Local Postgres is typically on **localhost:5433** in docker-compose (to avoid clashing with the TORE platform). If `DATABASE_URL` in `.env` already points at another local instance, use that.

Until a corpus is indexed, verify returns `UNRESOLVED` and retrieve without `asOf` returns `status: "ok"` with an empty `authorities` list.

An `asOf` query is authoritative only when the selected legal version has sufficient temporal provenance. A version with unknown effective bounds must not be treated as applicable to an arbitrary historical date.

- `POST /v1/retrieve` **without** `asOf` returns the current `PUBLISHED` snapshot (`status: "ok"`). Null `effectiveFrom`/`effectiveTo` on that snapshot do not imply historical coverage.
- `POST /v1/retrieve` **with** `asOf` matches `PUBLISHED` or `SUPERSEDED` only when both `effectiveFrom` and `effectiveTo` are known and the instant falls in `[effectiveFrom, effectiveTo)`. Otherwise the response is `status: "AS_OF_UNAVAILABLE"` with an empty `authorities` list. It must not silently return the current undated snapshot.
- `status: "ok"` means a current lookup succeeded, or a historical lookup found a version with a closed effective interval. `status: "AS_OF_UNAVAILABLE"` means historical applicability cannot be established.

## Phase 3

Conservative public ingest from https://legalinfo.mn (category **Монгол Улсын хууль** only).

The CLI defaults to **dry-run** and **limit=1**. It will not start a large crawl.

```bash
npm run ingest:legalinfo
npm run ingest:legalinfo -- --limit=1 --dry-run
npm run ingest:legalinfo -- --limit=5 --publish
npm run ingest:legalinfo -- --law-id 1622 --publish
npm run ingest:legalinfo -- --url https://legalinfo.mn/mn/detail?lawId=1622 --publish
```

`--allow-full-crawl` is required to exceed `LEGALINFO_MAX_DOCUMENTS_PER_RUN` (default 5). Do not use that for Phase 3.

Requests are HTTPS-only, allowlisted to LegalInfo hosts, rate-limited (`LEGALINFO_REQUEST_DELAY_MS`, default 4000ms), and concurrency is 1.

## Architecture notes

- **Data ownership:** this database stores public law only. Users, sessions, and marketplace tables stay in the TORE platform.
- **Archive identity:** SHA-256 of original bytes. Duplicate payload → existing record.
- **Citations:** a provision is authoritative only when status is `VALID`. Unresolved or conflicting cites must not be presented as law.
- **As-of:** historical retrieval is authoritative only when the selected version has a closed `effectiveFrom`/`effectiveTo` interval. Unknown bounds are not open-ended coverage.
- **Workers:** ingest / parse / index are separate processes so crawl never runs on an HTTP request path.

## Layout

```
src/domain/           entities, ports, invariants
src/application/      archive, citation, retrieval use-cases
src/infrastructure/   Prisma, local archive, service auth, LegalInfo stub
src/api/              Fastify + typed contracts
src/workers/          ingest / parse / index
src/parsers/          ILegalParser implementations (stub)
prisma/schema.prisma  corpus schema
```
