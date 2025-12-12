/**
 * API request and response types
 */

import type { ProductCard } from './message';

export type PageType = 'HOME' | 'PLP' | 'PDP';

export interface ConversationContext {
  lastIntent: string | null;
  lastConstraints: Record<string, any> | null;
  lastShownProductIds: string[];
  lastUserQuery: string | null;
}

export interface AssistantApiRequest {
  sessionId: string;
  pageType: PageType;
  productContextId?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pendingSuggestion?: {
    constraints: Record<string, any>;
    candidateIds: string[];
  };
  conversationContext?: ConversationContext;
}

export interface AssistantApiResponse {
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  pendingSuggestion?: {
    constraints: Record<string, any>;
    candidateIds: string[];
    queryText: string;
  } | null;
  intent?: 'discovery' | 'pdp_suitability' | 'other';
  resolvedConstraints?: Record<string, any>;
  usedFollowUpContext?: boolean;
  followupText?: string;
}

export interface ProgressEvent {
  stage: string;
  progress: number;
  queryType?: 'discovery' | 'product_qa' | 'non_contextual';
}

export interface AnalyticsEvent {
  eventType: string;
  sessionId: string;
  data: Record<string, any>;
  timestamp: number;
}


