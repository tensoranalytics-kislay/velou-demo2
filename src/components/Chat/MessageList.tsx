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
            <div className="mt-6 sm:mt-8 flex items-start gap-3">
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

function AssistantAvatar() {
  // Palette constrained to the requested colors
  const colorOne = '#D61F2B';
  const colorTwo = '#FF2157';
  const colorThree = '#FEE'; // #FFEEEE
  const colorFore = '#FEE'; // same light tint
  const colorFive = '#FFF';

  return (
    <div className="relative mt-1 h-8 w-8" style={{ transform: 'translateY(-5px)' }}>
      <div className="loader">
        <div className="sphere" />
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <defs>
            <mask id="waves" maskUnits="userSpaceOnUse">
              <g fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5,50 C25,50 30,20 50,20 C70,20 75,50 95,50" />
                <path d="M5,50 C25,50 30,20 50,20 C70,20 75,50 95,50" />
                <path d="M5,50 C25,50 30,80 50,80 C70,80 75,50 95,50" />
                <path d="M5,50 C25,50 30,80 50,80 C70,80 75,50 95,50" />
              </g>
            </mask>
            <mask id="blurriness" maskUnits="userSpaceOnUse">
              <g>
                <circle cx="50" cy="50" r="50" fill="white" />
                <ellipse cx="50" cy="50" rx="25" ry="25" fill="black" />
              </g>
            </mask>
            <mask id="clipping" maskUnits="userSpaceOnUse">
              <ellipse cx="50" cy="50" rx="25" ry="50" fill="white" />
            </mask>
            <mask id="fade" maskUnits="userSpaceOnUse">
              <ellipse cx="50" cy="50" rx="45" ry="50" fill="white" />
            </mask>
          </defs>
          <g id="shapes" mask="url(#fade)">
            <g mask="url(#clipping)">
              <circle cx="50" cy="50" r="50" fill="currentColor" mask="url(#waves)" />
            </g>
            <g mask="url(#blurriness)">
              <circle cx="50" cy="50" r="50" fill="currentColor" mask="url(#waves)" />
            </g>
          </g>
        </svg>
      </div>
      <style jsx>{`
        .loader {
          --color-one: ${colorOne};
          --color-two: ${colorTwo};
          --color-three: ${colorThree};
          --color-fore: ${colorFore};
          --color-five: ${colorFive};
          --time-animation: 2.2s;
          --size: 32px;
          --sync-offset: -1000s;
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          border-radius: 50%;
        }

        .loader .sphere {
          display: flex;
          justify-content: center;
          align-items: center;
          position: relative;
          border-radius: 50%;
          width: var(--size);
          height: var(--size);
          background: radial-gradient(
            circle at 80% 20%,
            rgba(255, 255, 255, 1) 0%,
            rgba(255, 255, 255, 0.8) 20%,
            rgba(255, 255, 255, 0.4) 50%,
            rgba(255, 255, 255, 0) 70%
          );
        }

        .loader .sphere::before {
          content: '';
          position: absolute;
          display: flex;
          justify-content: center;
          align-items: center;
          width: var(--size);
          height: var(--size);
          border-radius: 50%;
          box-shadow:
            inset calc(var(--size) / -20) calc(var(--size) / -20) calc(var(--size) / 10) var(--color-fore),
            inset calc(var(--size) / 10) 0 calc(var(--size) / 5) var(--color-three);
          animation: rotation calc(var(--time-animation) * 2) linear infinite;
          animation-delay: var(--sync-offset);
        }

        .loader .sphere::after {
          content: '';
          position: absolute;
          display: flex;
          justify-content: center;
          align-items: center;
          width: var(--size);
          height: var(--size);
          border-radius: 50%;
          z-index: -1;
          background: radial-gradient(
              circle at 80% 20%,
              rgba(255, 255, 255, 0.7) 0%,
              rgba(255, 255, 255, 0.5) 30%,
              rgba(255, 255, 255, 0) 70%
            ),
            linear-gradient(120deg, var(--color-one) 20%, var(--color-two) 80%);
          animation: rotation calc(var(--time-animation) * 2) linear infinite;
          animation-delay: var(--sync-offset);
        }

        .loader svg {
          position: absolute;
          display: flex;
          justify-content: center;
          align-items: center;
          width: var(--size);
          height: var(--size);
          animation: rotation calc(var(--time-animation) * 3) cubic-bezier(0.7, 0.6, 0.3, 0.4) infinite;
          color: var(--color-one);
          animation-delay: var(--sync-offset);
        }

        .loader svg #shapes circle {
          fill: var(--color-five);
        }

        .loader svg #blurriness g,
        .loader svg #clipping ellipse,
        .loader svg #shapes g:nth-of-type(2),
        .loader svg #fade ellipse {
          filter: blur(6px);
        }

        .loader svg #waves g path {
          will-change: d;
          stroke-width: 6px;
        }

        .loader svg #waves g path:nth-of-type(1) {
          animation: wave-one var(--time-animation) cubic-bezier(0.7, 0.6, 0.3, 0.4) infinite;
          animation-delay: var(--sync-offset);
        }

        .loader svg #waves g path:nth-of-type(2) {
          animation: wave-two var(--time-animation) cubic-bezier(0.7, 0.6, 0.3, 0.4)
            calc(var(--time-animation) / -2) infinite reverse;
          animation-delay: var(--sync-offset);
        }

        .loader svg #waves g path:nth-of-type(3) {
          animation: wave-one var(--time-animation) cubic-bezier(0.7, 0.6, 0.3, 0.4)
            calc(var(--time-animation) / -2) infinite;
          animation-delay: var(--sync-offset);
        }

        .loader svg #waves g path:nth-of-type(4) {
          animation: wave-two var(--time-animation) cubic-bezier(0.7, 0.6, 0.3, 0.4) infinite reverse;
          animation-delay: var(--sync-offset);
        }

        @keyframes wave-one {
          0% {
            d: path('M5,50 C10,50 15,50 20,50 C25,50 30,50 95,50');
          }
          50% {
            d: path('M5,50 C25,50 30,20 50,20 C70,20 75,50 95,50');
          }
          100% {
            d: path('M5,50 C70,50 75,50 80,50 C85,50 90,50 95,50');
          }
        }

        @keyframes wave-two {
          0% {
            d: path('M5,50 C10,50 15,50 20,50 C25,50 30,50 95,50');
          }
          50% {
            d: path('M5,50 C25,50 30,80 50,80 C70,80 75,50 95,50');
          }
          100% {
            d: path('M5,50 C70,50 75,50 80,50 C85,50 90,50 95,50');
          }
        }

        @keyframes rotation {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

      `}</style>
    </div>
  );
}

