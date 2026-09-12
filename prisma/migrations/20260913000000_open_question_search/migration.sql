-- P0-2B: open-question retrieval (PostgreSQL FTS + pg_trgm).
-- Additive only. Does not touch existing exact-citation/citation-verification
-- tables or behavior. Fully reversible (see rollback notes below each step).
--
-- Postgres ships no Mongolian text-search configuration, so `simple`
-- (tokenize + lowercase, no stemming/stopwords) is used deliberately rather
-- than misapplying an unrelated language's stemming rules to Mongolian text.

-- pg_trgm ships as a stock Postgres contrib extension (confirmed available,
-- not installed, via P0-2B readiness check against this repo's own local
-- dev/test Postgres). Explicitly pinned to the "public" schema and every
-- reference below is schema-qualified (public.gin_trgm_ops, public.similarity
-- in application code): this repo runs migrations against non-"public"
-- schemas too (e.g. the isolated integration-test schema, whose connection
-- search_path does not include "public"), and an extension is installed
-- once per DATABASE, not per schema — an unqualified reference resolves only
-- when the installing schema happens to be on the current search_path.
-- Rollback: DROP EXTENSION pg_trgm; (only if no other trigram index/operator
-- depends on it).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Generated column: Postgres computes and maintains this itself on every
-- INSERT/UPDATE of legal_nodes. Prisma Client never writes it (mapped as
-- Unsupported("tsvector") in schema.prisma, read-only from the app's side).
-- Rollback: ALTER TABLE "legal_nodes" DROP COLUMN "search_vector";
ALTER TABLE "legal_nodes"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("title", '') || ' ' || "text")
  ) STORED;

-- Rollback: DROP INDEX "legal_nodes_search_vector_idx";
CREATE INDEX "legal_nodes_search_vector_idx"
  ON "legal_nodes" USING GIN ("search_vector");

-- Trigram index on title only (fuzzy/typo tolerance for short strings).
-- Deliberately NOT indexing the full "text" column with trigrams: measured
-- against this repo's own real corpus (~16K nodes, some outlier rows up to
-- ~250KB), a `text % query` / `similarity(text, query) > x` predicate over
-- the full article body is not usefully selective (pg_trgm's lossy GIN
-- index still recheck-scans tens of thousands of rows against long text)
-- and measured ~2.3-2.7s per query — worse than a plain sequential scan on
-- this table size. FTS (search_vector, already fast: <1ms) already covers
-- body-text candidate matching; `similarity(text, ...)` is still used for
-- fine-grained scoring, but only ever computed on the small, already
-- FTS/title-filtered candidate set, never as a WHERE-clause table scan.
-- Rollback: DROP INDEX "legal_nodes_title_trgm_idx";
CREATE INDEX "legal_nodes_title_trgm_idx"
  ON "legal_nodes" USING GIN ("title" public.gin_trgm_ops);
