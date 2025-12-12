/**
 * Session Management
 *
 * Handles session ID generation and persistence using sessionStorage
 * (not localStorage, for cross-domain safety and per-tab isolation)
 */
/**
 * Get or create a session ID for the current browser tab
 * Uses sessionStorage to ensure unique session per tab
 *
 * @param merchantId - Merchant identifier for namespacing
 * @returns Session ID string
 */
export declare function getOrCreateSessionId(merchantId: string): string;
/**
 * Persist session ID to sessionStorage
 *
 * @param merchantId - Merchant identifier for namespacing
 * @param sessionId - Session ID to persist
 */
export declare function persistSessionId(merchantId: string, sessionId: string): void;
/**
 * Clear session ID from sessionStorage
 *
 * @param merchantId - Merchant identifier for namespacing
 */
export declare function clearSessionId(merchantId: string): void;
//# sourceMappingURL=sessionManager.d.ts.map