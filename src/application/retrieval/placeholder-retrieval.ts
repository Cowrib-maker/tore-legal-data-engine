import type {
  RetrievalPort,
  RetrieveRequest,
  RetrieveResponse,
} from "../../domain/ports/retrieval.js";

/** Phase 1 placeholder. No RAG, embeddings, or live corpus. */
export class PlaceholderRetrieval implements RetrievalPort {
  async retrieve(_request: RetrieveRequest): Promise<RetrieveResponse> {
    return {
      authorities: [],
      retrievedAt: new Date().toISOString(),
      status: _request.asOf ? "AS_OF_UNAVAILABLE" : "placeholder",
    };
  }
}
