/**
 * Message types for the chat widget
 */

export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  productCards?: ProductCard[];
  noExactMatch?: boolean;
  followupText?: string;
}

export interface ProductCard {
  id: string;
  title: string;
  priceCents: number;
  salePriceCents?: number | null;
  currency: string;
  imageUrl: string;
  productUrl: string;
  keyAttributes: string[];
  queryChips?: Array<{ label: string; why: string }>;
  reason: string;
  stockStatus?: 'in_stock' | 'out_of_stock' | 'low_stock';
}

export interface StoredChatMessage {
  role: MessageRole;
  text: string;
  productCards?: ProductCard[];
  followupText?: string;
  noExactMatch?: boolean;
  ts: number;
}


