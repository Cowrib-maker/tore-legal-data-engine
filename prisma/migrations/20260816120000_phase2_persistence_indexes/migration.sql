-- Phase 2 persistence foundation: retrieval indexes, cascade node deletes,
-- and a published-version overlap guard. Exclusion constraints are not
-- expressible in Prisma schema.

ALTER TABLE "legal_nodes" DROP CONSTRAINT "legal_nodes_parent_id_fkey";

ALTER TABLE "legal_nodes" ADD CONSTRAINT "legal_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "legal_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "archive_records_storage_key_key" ON "archive_records"("storage_key");

CREATE INDEX "legal_nodes_content_hash_idx" ON "legal_nodes"("content_hash");

CREATE INDEX "citation_entries_citation_key_idx" ON "citation_entries"("citation_key");

CREATE INDEX "citation_entries_content_hash_idx" ON "citation_entries"("content_hash");

CREATE INDEX "citation_entries_locator_idx" ON "citation_entries"("locator");

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "legal_document_versions"
ADD CONSTRAINT "legal_document_versions_published_no_overlap"
EXCLUDE USING gist (
  "document_id" WITH =,
  tsrange(
    COALESCE("effective_from", '-infinity'::timestamp),
    COALESCE("effective_to", 'infinity'::timestamp),
    '[)'
  ) WITH &&
) WHERE ("status" = 'PUBLISHED');
