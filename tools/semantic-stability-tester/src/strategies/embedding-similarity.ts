// Strategy 1: Embedding Cosine Similarity
// Baseline approach — embeds both utterances and compares cosine distance.
// Expected to be the weakest (too coarse, misses entity additions).

import type { StabilityStrategy, StabilityResult, ConversationContext } from '../types';

let pipeline: any;

async function loadPipeline() {
  if (!pipeline) {
    const { pipeline: createPipeline } = await import('@huggingface/transformers');
    pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return pipeline;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function meanPool(embeddings: number[][]): number[] {
  const dim = embeddings[0].length;
  const result = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      result[i] += emb[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    result[i] /= embeddings.length;
  }
  return result;
}

const SIMILARITY_THRESHOLD = 0.85;

export class EmbeddingSimilarityStrategy implements StabilityStrategy {
  name = 'embedding-similarity';
  private pipe: any;

  async init(): Promise<void> {
    this.pipe = await loadPipeline();
  }

  async compare(
    interim: string,
    final: string,
    _context?: ConversationContext,
  ): Promise<StabilityResult> {
    const start = performance.now();

    const [interimEmb, finalEmb] = await Promise.all([
      this.pipe(interim, { pooling: 'mean', normalize: true }),
      this.pipe(final, { pooling: 'mean', normalize: true }),
    ]);

    const interimVec = Array.from(interimEmb.data as Float32Array);
    const finalVec = Array.from(finalEmb.data as Float32Array);

    // Models return flat arrays; reshape to [1, dim] and mean-pool
    const dim = interimVec.length;
    const similarity = cosineSimilarity(
      interimVec.slice(0, dim),
      finalVec.slice(0, dim),
    );

    const latencyMs = performance.now() - start;

    return {
      verdict: similarity >= SIMILARITY_THRESHOLD ? 'SAME' : 'DIFFERENT',
      confidence: similarity >= SIMILARITY_THRESHOLD
        ? similarity
        : 1 - similarity,
      latencyMs,
      details: { similarity, threshold: SIMILARITY_THRESHOLD },
    };
  }

  async dispose(): Promise<void> {
    this.pipe = null;
  }
}
