-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('LEGISLATION', 'REGULATION', 'GOVERNMENT_RESOLUTION', 'MINISTERIAL_ORDER', 'SUPREME_COURT', 'CONSTITUTIONAL_COURT', 'TREATY', 'INTERPRETATION', 'OTHER');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('OFFICIAL', 'SECONDARY', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('LAW', 'REGULATION', 'GOVERNMENT_RESOLUTION', 'MINISTERIAL_ORDER', 'SUPREME_COURT_DECISION', 'CONSTITUTIONAL_COURT_DECISION', 'TREATY', 'INTERPRETATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'IN_FORCE', 'AMENDED', 'REPEALED', 'SUPERSEDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LegalNodeType" AS ENUM ('DOCUMENT', 'BOOK', 'PART', 'CHAPTER', 'SECTION', 'ARTICLE', 'PARAGRAPH', 'CLAUSE', 'SUB_CLAUSE', 'ANNEX');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('AMENDS', 'REPEALS', 'SUPERSEDES', 'IMPLEMENTS', 'INTERPRETS', 'CITES', 'CONTAINS');

-- CreateEnum
CREATE TYPE "CitationStatus" AS ENUM ('VALID', 'UNRESOLVED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "IngestJobType" AS ENUM ('FETCH', 'PARSE', 'INDEX', 'REVALIDATE');

-- CreateEnum
CREATE TYPE "IngestJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParseReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'NEEDS_REVISION');

-- CreateTable
CREATE TABLE "legal_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "authority" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "trust_level" "TrustLevel" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_records" (
    "id" TEXT NOT NULL,
    "source_id" TEXT,
    "sha256" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "encoding" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "document_number" TEXT,
    "issuing_authority" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "adopted_at" TIMESTAMP(3),
    "canonical_url" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "content_hash" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL,
    "amendment_document_id" TEXT,
    "archive_record_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_nodes" (
    "id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "node_type" "LegalNodeType" NOT NULL,
    "book" TEXT,
    "part" TEXT,
    "chapter" TEXT,
    "section" TEXT,
    "article" TEXT,
    "paragraph" TEXT,
    "clause" TEXT,
    "sub_clause" TEXT,
    "number" TEXT,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "source_locator" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_relations" (
    "id" TEXT NOT NULL,
    "from_node_id" TEXT NOT NULL,
    "to_node_id" TEXT NOT NULL,
    "relation_type" "RelationType" NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "legal_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citation_entries" (
    "id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "legal_node_id" TEXT NOT NULL,
    "citation_key" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "exact_text" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" "CitationStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_jobs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "job_type" "IngestJobType" NOT NULL,
    "status" "IngestJobStatus" NOT NULL,
    "url" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parse_reviews" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "archive_record_id" TEXT NOT NULL,
    "status" "ParseReviewStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "parsed_payload" JSONB NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parse_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_audit_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_sources_jurisdiction_is_active_idx" ON "legal_sources"("jurisdiction", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "legal_sources_jurisdiction_type_base_url_key" ON "legal_sources"("jurisdiction", "type", "base_url");

-- CreateIndex
CREATE UNIQUE INDEX "archive_records_sha256_key" ON "archive_records"("sha256");

-- CreateIndex
CREATE INDEX "archive_records_original_url_idx" ON "archive_records"("original_url");

-- CreateIndex
CREATE INDEX "archive_records_source_id_idx" ON "archive_records"("source_id");

-- CreateIndex
CREATE INDEX "legal_documents_jurisdiction_document_type_status_idx" ON "legal_documents"("jurisdiction", "document_type", "status");

-- CreateIndex
CREATE INDEX "legal_documents_issuing_authority_idx" ON "legal_documents"("issuing_authority");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_source_id_canonical_url_key" ON "legal_documents"("source_id", "canonical_url");

-- CreateIndex
CREATE INDEX "legal_document_versions_archive_record_id_idx" ON "legal_document_versions"("archive_record_id");

-- CreateIndex
CREATE INDEX "legal_document_versions_effective_from_effective_to_idx" ON "legal_document_versions"("effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "legal_document_versions_status_idx" ON "legal_document_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_versions_document_id_version_number_key" ON "legal_document_versions"("document_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_versions_document_id_content_hash_key" ON "legal_document_versions"("document_id", "content_hash");

-- CreateIndex
CREATE INDEX "legal_nodes_parent_id_idx" ON "legal_nodes"("parent_id");

-- CreateIndex
CREATE INDEX "legal_nodes_document_version_id_node_type_idx" ON "legal_nodes"("document_version_id", "node_type");

-- CreateIndex
CREATE INDEX "legal_nodes_article_paragraph_idx" ON "legal_nodes"("article", "paragraph");

-- CreateIndex
CREATE UNIQUE INDEX "legal_nodes_document_version_id_source_locator_key" ON "legal_nodes"("document_version_id", "source_locator");

-- CreateIndex
CREATE INDEX "legal_relations_to_node_id_idx" ON "legal_relations"("to_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_relations_from_node_id_to_node_id_relation_type_key" ON "legal_relations"("from_node_id", "to_node_id", "relation_type");

-- CreateIndex
CREATE INDEX "citation_entries_status_idx" ON "citation_entries"("status");

-- CreateIndex
CREATE INDEX "citation_entries_legal_node_id_idx" ON "citation_entries"("legal_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "citation_entries_document_version_id_citation_key_key" ON "citation_entries"("document_version_id", "citation_key");

-- CreateIndex
CREATE UNIQUE INDEX "citation_entries_document_version_id_legal_node_id_key" ON "citation_entries"("document_version_id", "legal_node_id");

-- CreateIndex
CREATE INDEX "ingest_jobs_source_id_status_idx" ON "ingest_jobs"("source_id", "status");

-- CreateIndex
CREATE INDEX "ingest_jobs_job_type_status_idx" ON "ingest_jobs"("job_type", "status");

-- CreateIndex
CREATE INDEX "ingest_jobs_created_at_idx" ON "ingest_jobs"("created_at");

-- CreateIndex
CREATE INDEX "parse_reviews_status_idx" ON "parse_reviews"("status");

-- CreateIndex
CREATE INDEX "parse_reviews_document_id_idx" ON "parse_reviews"("document_id");

-- CreateIndex
CREATE INDEX "engine_audit_logs_entity_type_entity_id_idx" ON "engine_audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "engine_audit_logs_actor_idx" ON "engine_audit_logs"("actor");

-- CreateIndex
CREATE INDEX "engine_audit_logs_created_at_idx" ON "engine_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "archive_records" ADD CONSTRAINT "archive_records_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_amendment_document_id_fkey" FOREIGN KEY ("amendment_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_archive_record_id_fkey" FOREIGN KEY ("archive_record_id") REFERENCES "archive_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_nodes" ADD CONSTRAINT "legal_nodes_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "legal_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_nodes" ADD CONSTRAINT "legal_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "legal_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_relations" ADD CONSTRAINT "legal_relations_from_node_id_fkey" FOREIGN KEY ("from_node_id") REFERENCES "legal_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_relations" ADD CONSTRAINT "legal_relations_to_node_id_fkey" FOREIGN KEY ("to_node_id") REFERENCES "legal_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citation_entries" ADD CONSTRAINT "citation_entries_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "legal_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citation_entries" ADD CONSTRAINT "citation_entries_legal_node_id_fkey" FOREIGN KEY ("legal_node_id") REFERENCES "legal_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_reviews" ADD CONSTRAINT "parse_reviews_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_reviews" ADD CONSTRAINT "parse_reviews_archive_record_id_fkey" FOREIGN KEY ("archive_record_id") REFERENCES "archive_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
