-- Source bytes stay on content_hash; parser/canonicalization identity is parser_id.
-- Existing published rows were produced by legalinfo-html-v1.

ALTER TABLE "legal_document_versions" ADD COLUMN "parser_id" TEXT;

UPDATE "legal_document_versions"
SET "parser_id" = 'legalinfo-html-v1'
WHERE "parser_id" IS NULL;

ALTER TABLE "legal_document_versions" ALTER COLUMN "parser_id" SET NOT NULL;

DROP INDEX IF EXISTS "legal_document_versions_document_id_content_hash_key";

CREATE UNIQUE INDEX "legal_document_versions_document_id_content_hash_parser_id_key"
  ON "legal_document_versions"("document_id", "content_hash", "parser_id");

CREATE INDEX "legal_document_versions_content_hash_idx"
  ON "legal_document_versions"("content_hash");

CREATE INDEX "legal_document_versions_parser_id_idx"
  ON "legal_document_versions"("parser_id");
