/**
 * @velou/widget - Main Entry Point
 *
 * NPM package entry point for React applications
 *
 * @example
 * ```tsx
 * import { VelouWidget } from '@velou/widget';
 *
 * function App() {
 *   return (
 *     <VelouWidget
 *       config={{
 *         merchantId: 'acme-corp',
 *         apiKey: 'pk_live_xxx',
 *         baseUrl: 'https://api.velou.ai',
 *       }}
 *     />
 *   );
 * }
 * ```
 */
export { default as VelouWidget } from './components/ChatWidget';
export type { WidgetConfig, WidgetProps } from './types/widget';
export type { Message, ProductCard } from './types/message';
export type { AssistantApiResponse, ProgressEvent } from './types/api';
export { useAssistantQuery, useChatPersistence, useAnalytics, } from './hooks';
export { WidgetApiClient, getOrCreateSessionId, persistSessionId, clearSessionId, } from './services';
export type * from './types';
//# sourceMappingURL=index.d.ts.map