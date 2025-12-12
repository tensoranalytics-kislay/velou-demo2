'use client';

import type { ProductCard } from '@/lib/llm/orchestrator';
import ProductCarousel from '@/components/ProductCarousel/ProductCarousel';
import MarkdownText from './MarkdownText';
import AssistantAvatar from './AssistantAvatar';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  productCards?: ProductCard[];
  noExactMatch?: boolean;
  followupText?: string;
};

type MessageListProps = {
  messages: ChatMessage[];
  onProductClick?: (productId: string) => Promise<void> | void;
  onProductAsk?: (productId: string, productTitle: string, productImageUrl: string) => Promise<void> | void;
};

export default function MessageList({ messages, onProductClick, onProductAsk }: MessageListProps) {
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
                <div className="h-8 w-8 rounded-full bg-gray-400 flex items-center justify-center mt-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </div>
              ) : (
                <AssistantAvatar />
              )}
            </div>

            {/* Message Text Content (constrained width) */}
            <div className={`flex-1 min-w-0 ${message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
              <div className={`max-w-[95%] md:max-w-[80%] min-w-0 ${message.role === 'user' ? 'rounded-lg border border-rose-200/60 bg-white/90 px-3 py-2' : ''}`}>
                {message.role === 'assistant' ? (
                  <MarkdownText content={message.content} className="text-black" />
                ) : (
                  <p className="text-sm leading-relaxed text-black whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
            </div>
          </div>

          {/* Product Carousel (full width, extending to where user message icon ends) */}
          {message.role === 'assistant' && message.productCards && message.productCards.length > 0 && (
            <div className="mt-8 w-full -mr-2">
              <ProductCarousel products={message.productCards} onProductClick={onProductClick} onProductAsk={onProductAsk} />
            </div>
          )}

          {/* Optional follow-up text that appears after product cards, aligned as an assistant message */}
          {message.role === 'assistant' && message.followupText && (
            <div className="mt-6 sm:mt-8 flex items-start gap-3 pt-2 sm:pt-3">
              <div className="flex-shrink-0">
                <AssistantAvatar />
              </div>
              <div className="flex-1 min-w-0 flex justify-start">
                <div className="max-w-[95%] md:max-w-[80%] min-w-0">
                  <MarkdownText content={message.followupText} className="text-black" />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

