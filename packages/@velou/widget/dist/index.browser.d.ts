/**
 * @velou/widget - Browser Entry Point
 *
 * Browser-specific entry point (for CDN usage)
 * Exports the same API as index.ts but optimized for browser environments
 */
export { default as VelouWidget } from './components/ChatWidget';
export type { WidgetConfig, WidgetProps } from './types/widget';
export type { Message, ProductCard } from './types/message';
export type { AssistantApiResponse, ProgressEvent } from './types/api';
export { useAssistantQuery, useChatPersistence, useAnalytics, } from './hooks';
export { WidgetApiClient, getOrCreateSessionId, persistSessionId, clearSessionId, } from './services';
export type * from './types';
//# sourceMappingURL=index.browser.d.ts.map