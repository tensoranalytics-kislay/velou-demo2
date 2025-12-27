'use client';

import type { ProductCard } from '@/lib/llm/orchestrator/cards';
import type { ActionProposal } from '@/lib/loccitane/actions';
import ProductCarousel from '@/components/ProductCarousel/ProductCarousel';
import MarkdownText from './MarkdownText';
import AssistantAvatar from './AssistantAvatar';
import UserAvatar from './UserAvatar';
import ActionChips from './ActionChips';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  productCards?: ProductCard[];
  noExactMatch?: boolean;
  followupText?: string; // Legacy - for non-product follow-ups
  replyTextAfter?: string; // Second part of reply (after product cards) - for product recommendations
  actions?: ActionProposal[];
};

type MessageListProps = {
  messages: ChatMessage[];
  onProductClick?: (productId: string) => Promise<void> | void;
  onProductAsk?: (productId: string, productTitle: string, productImageUrl: string) => Promise<void> | void;
  onProductFindSimilar?: (productId: string, productTitle: string, productImageUrl: string) => Promise<void> | void;
  onActionClick?: (actionId: string) => void;
};

export default function MessageList({ messages, onProductClick, onProductAsk, onProductFindSimilar, onActionClick }: MessageListProps) {
  return (
    <div className="space-y-8 sm:space-y-10 pb-8 sm:pb-12 md:pb-16 overflow-x-hidden">
      {messages.map((message) => (
        <div key={message.id} className="w-full pt-2 sm:pt-3">
          {/* Text message with avatar */}
          <div
            className={`flex items-start gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div className="flex-shrink-0">
              {message.role === 'user' ? (
                <UserAvatar />
              ) : (
                <AssistantAvatar />
              )}
            </div>

            {/* Message Text Content (constrained width) */}
            <div className={`flex-1 min-w-0 ${message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
              <div className={`max-w-[95%] md:max-w-[80%] min-w-0 ${message.role === 'user' ? 'rounded-lg border border-rose-200/60 bg-white/90 px-3 py-2' : ''}`}>
                {message.role === 'assistant' ? (
                  <MarkdownText 
                    content={message.content} 
                    className="text-black"
                    productCards={message.productCards || []}
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-black whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
            </div>
          </div>

          {/* Product Carousel (full width, extending to where user message icon ends) */}
          {message.role === 'assistant' && message.productCards && message.productCards.length > 0 && (
            <div className="mt-8 w-full -mr-2">
              {(() => {
                // Debug: Log to verify onProductFindSimilar is passed
                console.log('[MessageList] Rendering ProductCarousel with props:', {
                  productCount: message.productCards.length,
                  hasOnProductClick: !!onProductClick,
                  hasOnProductAsk: !!onProductAsk,
                  hasOnProductFindSimilar: !!onProductFindSimilar,
                  onProductFindSimilarType: typeof onProductFindSimilar,
                });
                return null;
              })()}
              <ProductCarousel 
                products={message.productCards} 
                onProductClick={onProductClick} 
                onProductAsk={onProductAsk} 
                onProductFindSimilar={onProductFindSimilar} 
              />
            </div>
          )}

          {/* Optional follow-up text that appears after product cards, aligned as an assistant message */}
          {/* Prioritize replyTextAfter for product recommendations, fallback to followupText for other cases */}
          {message.role === 'assistant' && (() => {
            const hasReplyTextAfter = message.replyTextAfter !== undefined && message.replyTextAfter !== null && message.replyTextAfter.trim().length > 0;
            const hasFollowupText = message.followupText !== undefined && message.followupText !== null && message.followupText.trim().length > 0;
            const hasProductCards = message.productCards && message.productCards.length > 0;
            const contentToRender = message.replyTextAfter || message.followupText || '';
            const hasContent = contentToRender.trim().length > 0;
            
            // Debug logging for product card messages
            if (hasProductCards) {
              console.log('[MessageList] replyTextAfter render check:', {
                messageId: message.id,
                hasReplyTextAfter,
                hasFollowupText,
                hasProductCards: hasProductCards,
                productCardCount: message.productCards?.length || 0,
                replyTextAfterLength: message.replyTextAfter?.length || 0,
                replyTextAfterPreview: message.replyTextAfter?.substring(0, 150) || 'null/undefined',
                hasContent,
                willRender: hasContent && (hasReplyTextAfter || hasFollowupText),
              });
            }
            
            // Always render if there's content to show (either replyTextAfter or followupText)
            return hasContent;
          })() && (
            <div className="mt-6 sm:mt-8 flex items-start gap-3 pt-2 sm:pt-3">
              <div className="flex-shrink-0">
                <AssistantAvatar />
              </div>
              <div className="flex-1 min-w-0 flex justify-start">
                <div className="max-w-[95%] md:max-w-[80%] min-w-0">
                  {/* Render content - prioritize replyTextAfter, fallback to followupText */}
                  <MarkdownText 
                    content={message.replyTextAfter || message.followupText || ''} 
                    className="text-black"
                    productCards={message.productCards || []}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action chips (quick-reply buttons) */}
          {message.role === 'assistant' && message.actions && message.actions.length > 0 && (
            <div className="mt-4 flex items-center gap-3 pt-2 sm:pt-3">
              <div className="flex-shrink-0">
                <AssistantAvatar noTransform />
              </div>
              <div className="flex-1 min-w-0 flex items-center justify-start">
                <div className="max-w-[95%] md:max-w-[80%] min-w-0">
                  <ActionChips 
                    actions={message.actions} 
                    onActionClick={onActionClick || (() => {})}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

