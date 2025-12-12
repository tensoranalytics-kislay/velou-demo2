/**
 * Widget API Client
 *
 * Handles all HTTP communication with the Velou backend API
 */
import type { AssistantApiRequest, AssistantApiResponse, ProgressEvent } from '../types/api';
/**
 * Widget API Client class
 *
 * Handles all API communication for the widget, including:
 * - Sending messages and receiving responses
 * - Streaming progress updates via SSE
 * - Fetching greetings, placeholders, and suggestions
 * - Tracking analytics events
 */
export declare class WidgetApiClient {
    private merchantId;
    private apiKey;
    private baseUrl;
    constructor(merchantId: string, apiKey: string, baseUrl?: string);
    /**
     * Get the base URL for API requests
     */
    private getApiUrl;
    /**
     * Get default headers for API requests
     */
    private getHeaders;
    /**
     * Send a message to the assistant and stream progress updates
     *
     * @param message - User message
     * @param sessionId - Session ID
     * @param request - Additional request parameters
     * @returns Async generator yielding progress events and final response
     */
    sendMessage(message: string, sessionId: string, request?: Partial<AssistantApiRequest>): AsyncGenerator<ProgressEvent | AssistantApiResponse, void, unknown>;
    /**
     * Get greeting message for the chat
     *
     * @returns Greeting text
     */
    getGreeting(): Promise<string>;
    /**
     * Get placeholder text for the message input
     *
     * @returns Placeholder text
     */
    getPlaceholder(): Promise<string>;
    /**
     * Get suggested prompts
     *
     * @param lastMessage - Optional last user message for context-aware suggestions
     * @returns Array of suggested prompt strings
     */
    getSuggestions(lastMessage?: string | null): Promise<string[]>;
    /**
     * Track an analytics event
     *
     * @param eventType - Type of event (e.g., 'product_click', 'message_sent')
     * @param sessionId - Session ID
     * @param data - Additional event data
     */
    trackEvent(eventType: string, sessionId: string, data?: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=apiClient.d.ts.map