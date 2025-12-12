/**
 * useAnalytics Hook
 * 
 * React hook for tracking analytics events
 */

import { useCallback, useRef } from 'react';
import { WidgetApiClient } from '../services/apiClient';

export interface UseAnalyticsResult {
  track: (eventType: string, data?: Record<string, any>) => void;
  trackMessage: (message: string) => void;
  trackProductClick: (productId: string, productUrl: string) => void;
}

export interface UseAnalyticsConfig {
  merchantId: string;
  apiKey: string;
  baseUrl?: string;
  sessionId: string;
  enabled?: boolean;
}

/**
 * Hook for tracking analytics events
 * 
 * @param config - Configuration object
 * @returns Hook result with tracking functions
 * 
 * @example
 * ```tsx
 * const { track, trackProductClick } = useAnalytics({
 *   merchantId: 'acme-corp',
 *   apiKey: 'pk_live_xxx',
 *   sessionId: 'session-123',
 * });
 * 
 * trackProductClick('product-456', 'https://example.com/product');
 * ```
 */
export function useAnalytics(config: UseAnalyticsConfig): UseAnalyticsResult {
  const enabled = config.enabled !== false;
  const apiClientRef = useRef<WidgetApiClient | null>(null);
  const eventQueueRef = useRef<Array<{ eventType: string; data: Record<string, any> }>>([]);
  const isOnlineRef = useRef(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Initialize API client
  if (!apiClientRef.current) {
    apiClientRef.current = new WidgetApiClient(
      config.merchantId,
      config.apiKey,
      config.baseUrl
    );
  }

  // Handle online/offline events
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      isOnlineRef.current = true;
      // Flush queued events when coming back online
      const queue = eventQueueRef.current;
      eventQueueRef.current = [];
      queue.forEach((event) => {
        apiClientRef.current?.trackEvent(event.eventType, config.sessionId, event.data);
      });
    });

    window.addEventListener('offline', () => {
      isOnlineRef.current = false;
    });
  }

  const track = useCallback(
    (eventType: string, data: Record<string, any> = {}) => {
      if (!enabled) return;

      if (isOnlineRef.current) {
        // Send immediately if online
        apiClientRef.current?.trackEvent(eventType, config.sessionId, data);
      } else {
        // Queue for later if offline
        eventQueueRef.current.push({ eventType, data });
      }
    },
    [config, enabled]
  );

  const trackMessage = useCallback(
    (message: string) => {
      track('message_sent', { messageLength: message.length });
    },
    [track]
  );

  const trackProductClick = useCallback(
    (productId: string, productUrl: string) => {
      track('product_click', { productId, productUrl });
    },
    [track]
  );

  return {
    track,
    trackMessage,
    trackProductClick,
  };
}

