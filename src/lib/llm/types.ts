/**
 * Shared types for LLM orchestration
 * These types are used by both the fast path (L'Occitane) and API routes
 */

import type { SearchConstraints } from '../search/types';
import type { DatasetContext } from '../catalog/datasetInspector';

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
  | 'completing'        // Finalizing response (non-contextual)
  | 'safety_check'      // Safety & domain gate (L'Occitane)
  | 'routing'           // Dialogue routing (L'Occitane)
  | 'classifying'       // Query classification & slot extraction (L'Occitane)
  | 'retrieving'        // Multi-view retrieval (L'Occitane)
  | 'ranking'           // Product ranking (L'Occitane)
  | 'generating_reply'  // RAG reply generation (L'Occitane)
  | 'handling_unrelated' // Handling unrelated/non-shopping queries (L'Occitane)
  | 'complete';         // All done

export type QueryType = 'discovery' | 'product_qa' | 'non_contextual';

export type ProgressCallback = (stage: QueryStage, progress: number) => void;

export const STAGE_PROGRESS: Record<QueryStage, number> = {
  understanding: 20,
  searching: 45,
  evaluating: 70,
  generating: 90,
  loading_product: 25,
  analyzing: 60,
  answering: 90,
  completing: 95, // Non-contextual: finalizing response
  safety_check: 10,
  routing: 15,
  classifying: 25,
  retrieving: 50,
  ranking: 70,
  generating_reply: 90,
  handling_unrelated: 30,
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
  completing: 'Finalizing response...', // Non-contextual: finalizing response
  safety_check: 'Checking query...',
  routing: 'Understanding your intent...',
  classifying: 'Understanding what you\'re looking for...',
  retrieving: 'Searching our catalog...',
  ranking: 'Finding the best matches...',
  generating_reply: 'Crafting recommendations...',
  handling_unrelated: 'Preparing a helpful response...', // For unrelated/non-shopping/unsafe queries
  complete: 'Almost done...',
};

// Helper export to force tree-shaking-safe named exports recognition
export const STAGE_LABEL_KEYS = Object.keys(STAGE_LABELS) as QueryStage[];

/**
 * Conversation context for maintaining state across queries
 */
export type ConversationContext = {
  lastIntent?: string | null;
  lastConstraints?: SearchConstraints | null;
  lastClassificationConstraints?: {
    concerns?: string[];
    skinTypes?: string[];
    hairTypes?: string[];
    applicationAreas?: string[];
    productTypes?: string[];
    collections?: string[];
    priceMinCents?: number;
    priceMaxCents?: number;
    mustHaveIngredients?: string[];
    avoidIngredients?: string[];
    madeWithout?: string[];
    ageGroups?: string[];
    genders?: string[];
    size?: string; // Product size constraint (e.g., "travel", "2.1 fl oz", "small")
  } | null;
  lastShownProductIds?: string[];
  lastUserQuery?: string | null;
  datasetContext?: DatasetContext | null;
};

/**
 * Pending suggestion types (legacy, kept for type compatibility)
 */
export type PendingSuggestionInput = {
  constraints: SearchConstraints;
  candidateIds: string[];
};

export type PendingSuggestionResult = PendingSuggestionInput & {
  summary: string;
};

