# @velou/widget

Velou Shopping Assistant Widget - Embeddable chat widget for any website.

## Installation

```bash
npm install @velou/widget
```

## Quick Start

### React Application

```tsx
import { VelouWidget } from '@velou/widget';

function App() {
  return (
    <VelouWidget
      config={{
        merchantId: 'your-merchant-id',
        apiKey: 'pk_live_xxx',
        baseUrl: 'https://api.velou.ai', // Optional, defaults to https://api.velou.ai
      }}
    />
  );
}
```

### CDN (Vanilla JavaScript)

```html
<script src="https://cdn.velou.ai/widget.js" 
  data-merchant-id="your-merchant-id"
  data-api-key="pk_live_xxx"></script>

<script>
  // Widget is automatically mounted
  // Or manually:
  VelouWidget.mount({
    merchantId: 'your-merchant-id',
    apiKey: 'pk_live_xxx',
  });
</script>
```

## Configuration

### WidgetConfig

```typescript
interface WidgetConfig {
  merchantId: string;           // Required: Your merchant ID
  apiKey: string;               // Required: Your API key
  baseUrl?: string;             // Optional: API base URL (default: https://api.velou.ai)
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'custom';
  customPosition?: { top?: number; left?: number; right?: number; bottom?: number };
  width?: number;               // Default: 540px
  height?: number;              // Default: 600px
  brandName?: string;           // Your brand name
  vertical?: string;            // Your vertical (e.g., 'fashion', 'electronics')
  theme?: {
    primaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    surfaceColor?: string;
  };
  onProductClick?: (productId: string, productUrl: string) => void;
  onProductAsk?: (productId: string, productTitle: string, productImageUrl: string) => void;
  onMessage?: (message: Message) => void;
  pageType?: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
}
```

## Advanced Usage

### Using Hooks Directly

```tsx
import { useAssistantQuery, useChatPersistence, useAnalytics } from '@velou/widget';

function CustomChat() {
  const { sendMessage, response, loading } = useAssistantQuery({
    merchantId: 'acme-corp',
    apiKey: 'pk_live_xxx',
    sessionId: 'session-123',
  });

  const { messages, addMessage } = useChatPersistence({
    merchantId: 'acme-corp',
  });

  const { trackProductClick } = useAnalytics({
    merchantId: 'acme-corp',
    apiKey: 'pk_live_xxx',
    sessionId: 'session-123',
  });

  const handleSend = async () => {
    const result = await sendMessage('Show me summer dresses');
    if (result) {
      addMessage({
        id: Date.now().toString(),
        role: 'assistant',
        content: result.replyText,
        productCards: result.productCards,
      });
    }
  };

  return (
    <div>
      {/* Your custom UI */}
    </div>
  );
}
```

### Using API Client Directly

```tsx
import { WidgetApiClient } from '@velou/widget';

const client = new WidgetApiClient('acme-corp', 'pk_live_xxx');

// Send a message with streaming
async function sendMessage() {
  const generator = client.sendMessage('Show me dresses', 'session-123');
  
  for await (const event of generator) {
    if ('stage' in event) {
      console.log('Progress:', event.stage, event.progress);
    } else {
      console.log('Response:', event.replyText);
    }
  }
}

// Get greeting
const greeting = await client.getGreeting();

// Get suggestions
const suggestions = await client.getSuggestions('last message');

// Track event
await client.trackEvent('product_click', 'session-123', {
  productId: 'prod-123',
  productUrl: 'https://example.com/product',
});
```

## API Reference

### Components

- **VelouWidget**: Main widget component

### Hooks

- **useAssistantQuery**: Hook for sending messages and receiving responses
- **useChatPersistence**: Hook for persisting chat messages
- **useAnalytics**: Hook for tracking analytics events

### Services

- **WidgetApiClient**: HTTP client for API communication
- **getOrCreateSessionId**: Get or create a session ID
- **persistSessionId**: Persist session ID to storage
- **clearSessionId**: Clear session ID from storage

## TypeScript Support

Full TypeScript definitions are included. Import types as needed:

```typescript
import type {
  WidgetConfig,
  Message,
  ProductCard,
  AssistantApiResponse,
  ProgressEvent,
} from '@velou/widget';
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

MIT

## Support

For issues and questions, visit [https://velou.ai/support](https://velou.ai/support)


