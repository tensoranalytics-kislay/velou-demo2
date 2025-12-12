/**
 * ChatWidget - Main Widget Component
 * 
 * This is a placeholder component. In a full implementation, this would:
 * 1. Use the hooks (useAssistantQuery, useChatPersistence, useAnalytics)
 * 2. Render the chat UI with message list, input, product cards
 * 3. Handle widget positioning, resizing, and state
 * 4. Integrate with the API client for all backend communication
 * 
 * For now, this is a minimal implementation that demonstrates the structure.
 */

import React, { useState, useEffect } from 'react';
import type { WidgetConfig, WidgetProps } from '../types/widget';
import { useAssistantQuery } from '../hooks/useAssistantQuery';
import { useChatPersistence } from '../hooks/useChatPersistence';
import { useAnalytics } from '../hooks/useAnalytics';
import { getOrCreateSessionId } from '../services/sessionManager';
import '../styles/widget.css';

/**
 * VelouWidget - Main widget component
 * 
 * @param props - Widget props containing configuration
 * 
 * @example
 * ```tsx
 * <VelouWidget
 *   config={{
 *     merchantId: 'acme-corp',
 *     apiKey: 'pk_live_xxx',
 *   }}
 * />
 * ```
 */
export default function VelouWidget({ config }: WidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId] = useState(() => getOrCreateSessionId(config.merchantId));

  // Initialize hooks
  const { messages, addMessage, clearMessages } = useChatPersistence({
    merchantId: config.merchantId,
  });

  const { sendMessage, response, loading, error, progress } = useAssistantQuery({
    merchantId: config.merchantId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    sessionId,
  });

  const { track, trackMessage, trackProductClick } = useAnalytics({
    merchantId: config.merchantId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    sessionId,
  });

  // Track widget load on mount
  useEffect(() => {
    track('widget_loaded', {
      pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
  }, [track]);

  // Handle new responses
  useEffect(() => {
    if (response) {
      addMessage({
        id: Date.now().toString(),
        role: 'assistant',
        content: response.replyText,
        productCards: response.productCards,
        followupText: response.followupText,
        noExactMatch: response.noExactMatch,
      });
    }
  }, [response, addMessage]);

  const handleSendMessage = async (message: string) => {
    // Add user message
    addMessage({
      id: Date.now().toString(),
      role: 'user',
      content: message,
    });

    // Track message
    trackMessage(message);

    // Send to assistant
    try {
      await sendMessage(message, {
        pageType: config.pageType || 'HOME',
        productContextId: config.productContextId,
      });
    } catch (err) {
      console.error('[Velou Widget] Failed to send message:', err);
    }
  };

  const handleProductClick = async (productId: string, productUrl: string) => {
    trackProductClick(productId, productUrl);
    config.onProductClick?.(productId, productUrl);
  };

  const position = config.position || 'bottom-right';
  const positionClass = `velou-widget-${position}`;

  return (
    <div className={`velou-widget-container ${positionClass}`}>
      {/* Floating button */}
      {!isOpen && (
        <button
          className="velou-widget-button"
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
            />
          </svg>
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div className="velou-widget-window">
          <div className="velou-widget-header">
            <h3>{config.brandName || 'Shopping'} Advisor</h3>
            <button onClick={() => setIsOpen(false)} aria-label="Close chat">
              ×
            </button>
          </div>
          <div className="velou-widget-body">
            {/* Message list */}
            <div className="velou-widget-messages">
              {messages.map((msg) => (
                <div key={msg.id} className={`velou-widget-message velou-widget-message-${msg.role}`}>
                  <div className="velou-widget-message-content">{msg.content}</div>
                  {msg.productCards && msg.productCards.length > 0 && (
                    <div className="velou-widget-products">
                      {msg.productCards.map((product) => (
                        <div key={product.id} className="velou-widget-product-card">
                          <img src={product.imageUrl} alt={product.title} />
                          <h4>{product.title}</h4>
                          <p>${(product.priceCents / 100).toFixed(2)}</p>
                          <button onClick={() => handleProductClick(product.id, product.productUrl)}>
                            View Product
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="velou-widget-loading">
                  {progress ? `Loading... ${progress.stage} (${Math.round(progress.progress)}%)` : 'Loading...'}
                </div>
              )}
              {error && (
                <div className="velou-widget-error">Error: {error.message}</div>
              )}
            </div>

            {/* Input */}
            <div className="velou-widget-input-container">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = e.currentTarget.querySelector('input') as HTMLInputElement;
                  if (input.value.trim()) {
                    handleSendMessage(input.value);
                    input.value = '';
                  }
                }}
              >
                <input
                  type="text"
                  placeholder="Ask for products..."
                  disabled={loading}
                  className="velou-widget-input"
                />
                <button type="submit" disabled={loading} className="velou-widget-send">
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

