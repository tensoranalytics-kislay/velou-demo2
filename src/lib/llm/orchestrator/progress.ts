/**
 * Progress tracking types for query pipeline stages
 */

export type QueryStage = 
  | 'understanding'      // Intent & Constraints Extraction
  | 'searching'          // Database Search & Ranking
  | 'evaluating'         // Product Card Generation & Scoring
  | 'generating'         // Response Generation & Brand Voice
  | 'loading_product'   // Loading product details (Q&A)
  | 'analyzing'         // Analyzing product information (Q&A)
  | 'answering'         // Generating answer (Q&A)
  | 'complete';          // All done

export type QueryType = 'discovery' | 'product_qa';

export type ProgressCallback = (stage: QueryStage, progress: number) => void;

export const STAGE_PROGRESS: Record<QueryStage, number> = {
  understanding: 20,
  searching: 45,
  evaluating: 70,
  generating: 90,
  loading_product: 25,
  analyzing: 60,
  answering: 90,
  complete: 100,
};

export const STAGE_LABELS: Record<QueryStage, string> = {
  understanding: 'Understanding your request...',
  searching: 'Searching products...',
  evaluating: 'Evaluating matches...',
  generating: 'Generating recommendations...',
  loading_product: 'Loading product details...',
  analyzing: 'Analyzing product information...',
  answering: 'Generating answer...',
  complete: 'Almost done...',
};

