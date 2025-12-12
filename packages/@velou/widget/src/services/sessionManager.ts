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
export function getOrCreateSessionId(merchantId: string): string {
  if (typeof window === 'undefined') {
    // Server-side: generate a temporary ID
    return `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const storageKey = `velou_session_${merchantId}`;
  
  try {
    // Try to get existing session ID from sessionStorage
    const existing = sessionStorage.getItem(storageKey);
    if (existing) {
      return existing;
    }

    // Generate new session ID
    const sessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Store in sessionStorage
    sessionStorage.setItem(storageKey, sessionId);
    
    return sessionId;
  } catch (error) {
    // Fallback if sessionStorage is unavailable (private mode, etc.)
    console.warn('[Velou Widget] sessionStorage unavailable, using in-memory session ID');
    return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Persist session ID to sessionStorage
 * 
 * @param merchantId - Merchant identifier for namespacing
 * @param sessionId - Session ID to persist
 */
export function persistSessionId(merchantId: string, sessionId: string): void {
  if (typeof window === 'undefined') return;

  const storageKey = `velou_session_${merchantId}`;
  
  try {
    sessionStorage.setItem(storageKey, sessionId);
  } catch (error) {
    // Ignore storage errors (quota, private mode, etc.)
    console.warn('[Velou Widget] Failed to persist session ID:', error);
  }
}

/**
 * Clear session ID from sessionStorage
 * 
 * @param merchantId - Merchant identifier for namespacing
 */
export function clearSessionId(merchantId: string): void {
  if (typeof window === 'undefined') return;

  const storageKey = `velou_session_${merchantId}`;
  
  try {
    sessionStorage.removeItem(storageKey);
  } catch (error) {
    // Ignore removal errors
  }
}


