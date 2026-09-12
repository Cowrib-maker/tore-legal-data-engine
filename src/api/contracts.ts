import { z } from "zod";

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("tore-legal-data-engine"),
  version: z.string(),
  checkedAt: z.string(),
  dependencies: z.object({
      archive: z.object({
        ok: z.boolean(),
        storage: z.string(),
        detail: z.string(),
      }),
      postgres: z.object({
        ok: z.boolean(),
        storage: z.string(),
        detail: z.string(),
      }),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const verifyCitationsRequestSchema = z.object({
  citations: z
    .array(
      z.object({
        query: z.string().min(1),
        nodeId: z.string().nullable().optional(),
        documentId: z.string().nullable().optional(),
        locator: z.string().nullable().optional(),
      }),
    )
    .max(50),
});

export type VerifyCitationsRequest = z.infer<typeof verifyCitationsRequestSchema>;

export const citationVerdictSchema = z.object({
  query: z.string(),
  status: z.enum(["VALID", "UNRESOLVED", "CONFLICT"]),
  nodeId: z.string().nullable(),
  documentVersionId: z.string().nullable(),
  locator: z.string().nullable(),
  reasons: z.array(z.string()),
});

export const verifyCitationsResponseSchema = z.object({
  results: z.array(citationVerdictSchema),
});

export type VerifyCitationsResponse = z.infer<typeof verifyCitationsResponseSchema>;

export const retrieveRequestSchema = z.object({
  question: z.string().min(1).max(8000),
  citations: z
    .array(
      z.object({
        query: z.string().min(1),
        nodeId: z.string().nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
  asOf: z.string().nullable().optional(),
  documentId: z.string().nullable().optional(),
  nodeId: z.string().nullable().optional(),
  citationKey: z.string().nullable().optional(),
  locator: z.string().nullable().optional(),
});

export type RetrieveRequestDto = z.infer<typeof retrieveRequestSchema>;

export const retrieveResponseSchema = z.object({
  authorities: z.array(
    z.object({
      nodeId: z.string(),
      documentId: z.string(),
      documentVersionId: z.string(),
      locator: z.string(),
      title: z.string(),
      excerpt: z.string(),
      contentHash: z.string(),
      sourceContentHash: z.string(),
      parserId: z.string(),
      archiveRecordId: z.string(),
      effectiveFrom: z.string().nullable(),
      effectiveTo: z.string().nullable(),
    }),
  ),
  retrievedAt: z.string(),
  status: z.enum(["placeholder", "ok", "AS_OF_UNAVAILABLE"]),
});

export type RetrieveResponseDto = z.infer<typeof retrieveResponseSchema>;
