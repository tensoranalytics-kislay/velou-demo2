/**
 * Widget API Client
 * 
 * Handles all HTTP communication with the Velou backend API
 */

import type {
  AssistantApiRequest,
  AssistantApiResponse,
  ProgressEvent,
  AnalyticsEvent,
} from '../types/api';

/**
 * Widget API Client class
 * 
 * Handles all API communication for the widget, including:
 * - Sending messages and receiving responses
 * - Streaming progress updates via SSE
 * - Fetching greetings, placeholders, and suggestions
 * - Tracking analytics events
 */
export class WidgetApiClient {
  private merchantId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(merchantId: string, apiKey: string, baseUrl: string = 'https://api.velou.ai') {
    this.merchantId = merchantId;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Get the base URL for API requests
   */
  private getApiUrl(path: string): string {
    return `${this.baseUrl}/api/widget/${this.merchantId}${path}`;
  }

  /**
   * Get default headers for API requests
   */
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'X-Merchant-Id': this.merchantId,
    };
  }

  /**
   * Send a message to the assistant and stream progress updates
   * 
   * @param message - User message
   * @param sessionId - Session ID
   * @param request - Additional request parameters
   * @returns Async generator yielding progress events and final response
   */
  async *sendMessage(
    message: string,
    sessionId: string,
    request: Partial<AssistantApiRequest> = {}
  ): AsyncGenerator<ProgressEvent | AssistantApiResponse, void, unknown> {
    const url = this.getApiUrl('/assistant/stream');
    
    const body: AssistantApiRequest = {
      sessionId,
      message,
      pageType: request.pageType || 'HOME',
      productContextId: request.productContextId,
      history: request.history,
      pendingSuggestion: request.pendingSuggestion,
      conversationContext: request.conversationContext,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      // Handle Server-Sent Events (SSE) stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              // Yield progress events
              if (data.type === 'progress') {
                yield {
                  stage: data.stage,
                  progress: data.progress,
                  queryType: data.queryType,
                } as ProgressEvent;
              }
              
              // Yield final response
              if (data.type === 'response') {
                yield data.response as AssistantApiResponse;
              }
            } catch (e) {
              // Skip malformed JSON
              console.warn('[Velou Widget] Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('[Velou Widget] Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Get greeting message for the chat
   * 
   * @returns Greeting text
   */
  async getGreeting(): Promise<string> {
    const url = this.getApiUrl('/chat/greeting');
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.greeting || "Hey there—I'm your shopping assistant. Tell me what you're looking for and I'll help you find the perfect products from our catalog.";
    } catch (error) {
      console.warn('[Velou Widget] Failed to fetch greeting:', error);
      return "Hey there—I'm your shopping assistant. Tell me what you're looking for and I'll help you find the perfect products from our catalog.";
    }
  }

  /**
   * Get placeholder text for the message input
   * 
   * @returns Placeholder text
   */
  async getPlaceholder(): Promise<string> {
    const url = this.getApiUrl('/chat/placeholder');
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.placeholder || 'Ask for products...';
    } catch (error) {
      console.warn('[Velou Widget] Failed to fetch placeholder:', error);
      return 'Ask for products...';
    }
  }

  /**
   * Get suggested prompts
   * 
   * @param lastMessage - Optional last user message for context-aware suggestions
   * @returns Array of suggested prompt strings
   */
  async getSuggestions(lastMessage?: string | null): Promise<string[]> {
    const url = lastMessage
      ? `${this.getApiUrl('/suggestions')}?lastMessage=${encodeURIComponent(lastMessage)}`
      : this.getApiUrl('/suggestions');
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.suggestions || [];
    } catch (error) {
      console.warn('[Velou Widget] Failed to fetch suggestions:', error);
      return ['popular items', 'best sellers', 'featured products'];
    }
  }

  /**
   * Track an analytics event
   * 
   * @param eventType - Type of event (e.g., 'product_click', 'message_sent')
   * @param sessionId - Session ID
   * @param data - Additional event data
   */
  async trackEvent(eventType: string, sessionId: string, data: Record<string, any> = {}): Promise<void> {
    const url = this.getApiUrl('/analytics/event');
    
    // Map widget's data structure to API's expected structure
    // API expects: { eventType, sessionId, payload, userDevice, userPage, userReferer, createdAt }
    const event = {
      eventType,
      sessionId,
      payload: data, // API expects 'payload', not 'data'
      userDevice: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      userPage: typeof window !== 'undefined' ? window.location.href : undefined,
      userReferer: typeof document !== 'undefined' ? document.referrer : undefined,
      createdAt: Date.now(),
    };

    try {
      // Fire and forget - don't block on analytics
      fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(event),
      }).catch((error) => {
        // Silently fail - analytics should never block user interaction
        console.warn('[Velou Widget] Failed to track event:', error);
      });
    } catch (error) {
      // Silently fail
      console.warn('[Velou Widget] Failed to track event:', error);
    }
  }
}

