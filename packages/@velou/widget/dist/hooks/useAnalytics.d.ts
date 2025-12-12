/**
 * useAnalytics Hook
 *
 * React hook for tracking analytics events
 */
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
export declare function useAnalytics(config: UseAnalyticsConfig): UseAnalyticsResult;
//# sourceMappingURL=useAnalytics.d.ts.map