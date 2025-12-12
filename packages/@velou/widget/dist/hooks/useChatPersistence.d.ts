/**
 * useChatPersistence Hook
 *
 * React hook for persisting chat messages to localStorage
 */
import type { Message } from '../types/message';
export interface UseChatPersistenceResult {
    messages: Message[];
    addMessage: (message: Message) => void;
    clearMessages: () => void;
    isLoading: boolean;
}
export interface UseChatPersistenceConfig {
    merchantId: string;
    storageKey?: string;
    debounceMs?: number;
    maxMessages?: number;
}
/**
 * Hook for persisting chat messages
 *
 * @param config - Configuration object
 * @returns Hook result with messages and persistence functions
 *
 * @example
 * ```tsx
 * const { messages, addMessage, clearMessages } = useChatPersistence({
 *   merchantId: 'acme-corp',
 * });
 * ```
 */
export declare function useChatPersistence(config: UseChatPersistenceConfig): UseChatPersistenceResult;
//# sourceMappingURL=useChatPersistence.d.ts.map