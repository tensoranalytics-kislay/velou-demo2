'use client';

import type { ProductCard } from '@/lib/llm/orchestrator';
import ProductCarousel from '@/components/ProductCarousel/ProductCarousel';
import MarkdownText from './MarkdownText';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  productCards?: ProductCard[];
  noExactMatch?: boolean;
};

type MessageListProps = {
  messages: ChatMessage[];
  onProductClick?: (productId: string) => Promise<void> | void;
};

export default function MessageList({ messages, onProductClick }: MessageListProps) {
  return (
    <div className="space-y-8 sm:space-y-10 pb-4 sm:pb-6 overflow-x-hidden">
      {messages.map((message) => (
        <div key={message.id} className="w-full">
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
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center -mt-1">
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
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </div>
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
              <ProductCarousel products={message.productCards} onProductClick={onProductClick} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

