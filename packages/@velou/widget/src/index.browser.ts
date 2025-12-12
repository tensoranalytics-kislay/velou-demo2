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

// Export hooks
export {
  useAssistantQuery,
  useChatPersistence,
  useAnalytics,
} from './hooks';

// Export services
export {
  WidgetApiClient,
  getOrCreateSessionId,
  persistSessionId,
  clearSessionId,
} from './services';

// Export all types
export type * from './types';


