/**
 * Widget configuration and props
 */

import type { Message, ProductCard } from './message';
import type { PageType } from './api';

export interface WidgetConfig {
  merchantId: string;
  apiKey: string;
  baseUrl?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'custom';
  customPosition?: { top?: number; left?: number; right?: number; bottom?: number };
  width?: number;
  height?: number;
  brandName?: string;
  vertical?: string;
  theme?: {
    primaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    surfaceColor?: string;
  };
  onProductClick?: (productId: string, productUrl: string) => void | Promise<void>;
  onProductAsk?: (productId: string, productTitle: string, productImageUrl: string) => void;
  onMessage?: (message: Message) => void;
  pageType?: PageType;
  productContextId?: string;
}

export interface WidgetProps {
  config: WidgetConfig;
}

export interface WidgetState {
  isOpen: boolean;
  messages: Message[];
  isLoading: boolean;
  sessionId: string;
  pageType: PageType;
  productContextId?: string;
}


