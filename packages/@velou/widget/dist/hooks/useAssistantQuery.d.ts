/**
 * useAssistantQuery Hook
 *
 * React hook for sending messages to the assistant and handling streaming responses
 */
import type { AssistantApiResponse, ProgressEvent, AssistantApiRequest } from '../types/api';
export interface UseAssistantQueryResult {
    sendMessage: (message: string, additionalRequest?: Partial<AssistantApiRequest>) => Promise<AssistantApiResponse | null>;
    response: AssistantApiResponse | null;
    loading: boolean;
    error: Error | null;
    progress: ProgressEvent | null;
    sessionId: string;
    reset: () => void;
}
export interface UseAssistantQueryConfig {
    merchantId: string;
    apiKey: string;
    baseUrl?: string;
    sessionId?: string;
    onProgress?: (progress: ProgressEvent) => void;
    onResponse?: (response: AssistantApiResponse) => void;
    onError?: (error: Error) => void;
    retryCount?: number;
    retryDelay?: number;
}
/**
 * Hook for sending messages to the assistant
 *
 * @param config - Configuration object
 * @returns Hook result with sendMessage function and state
 *
 * @example
 * ```tsx
 * const { sendMessage, response, loading, error } = useAssistantQuery({
 *   merchantId: 'acme-corp',
 *   apiKey: 'pk_live_xxx',
 * });
 *
 * const handleSend = async () => {
 *   const result = await sendMessage('Show me summer dresses');
 *   console.log('Response:', result);
 * };
 * ```
 */
export declare function useAssistantQuery(config: UseAssistantQueryConfig): UseAssistantQueryResult;
//# sourceMappingURL=useAssistantQuery.d.ts.map