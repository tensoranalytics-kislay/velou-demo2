/**
 * useAssistantQuery Hook
 * 
 * React hook for sending messages to the assistant and handling streaming responses
 */

import { useState, useCallback, useRef } from 'react';
import { WidgetApiClient } from '../services/apiClient';
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
export function useAssistantQuery(config: UseAssistantQueryConfig): UseAssistantQueryResult {
  const [response, setResponse] = useState<AssistantApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [sessionId] = useState<string>(config.sessionId || '');

  const apiClientRef = useRef<WidgetApiClient | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize API client
  if (!apiClientRef.current) {
    apiClientRef.current = new WidgetApiClient(
      config.merchantId,
      config.apiKey,
      config.baseUrl
    );
  }

  const sendMessage = useCallback(
    async (
      message: string,
      additionalRequest: Partial<AssistantApiRequest> = {}
    ): Promise<AssistantApiResponse | null> => {
      setLoading(true);
      setError(null);
      setProgress(null);
      setResponse(null);

      // Abort any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const retryCount = config.retryCount ?? 3;
      const retryDelay = config.retryDelay ?? 1000;

      let lastError: Error | null = null;

      for (let attempt = 0; attempt < retryCount; attempt++) {
        try {
          const generator = apiClientRef.current!.sendMessage(
            message,
            sessionId,
            additionalRequest
          );

          let finalResponse: AssistantApiResponse | null = null;

          for await (const event of generator) {
            // Check if aborted
            if (abortControllerRef.current?.signal.aborted) {
              throw new Error('Request aborted');
            }

            // Handle progress events
            if ('stage' in event && 'progress' in event) {
              const progressEvent = event as ProgressEvent;
              setProgress(progressEvent);
              config.onProgress?.(progressEvent);
            }

            // Handle final response
            if ('replyText' in event) {
              finalResponse = event as AssistantApiResponse;
              setResponse(finalResponse);
              config.onResponse?.(finalResponse);
            }
          }

          setLoading(false);
          return finalResponse;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          
          // Don't retry if aborted
          if (lastError.message === 'Request aborted') {
            setLoading(false);
            throw lastError;
          }

          // Don't retry on last attempt
          if (attempt < retryCount - 1) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
            continue;
          }

          setError(lastError);
          setLoading(false);
          config.onError?.(lastError);
          throw lastError;
        }
      }

      setLoading(false);
      throw lastError || new Error('Failed to send message');
    },
    [config, sessionId]
  );

  const reset = useCallback(() => {
    setResponse(null);
    setError(null);
    setProgress(null);
    setLoading(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    sendMessage,
    response,
    loading,
    error,
    progress,
    sessionId,
    reset,
  };
}


