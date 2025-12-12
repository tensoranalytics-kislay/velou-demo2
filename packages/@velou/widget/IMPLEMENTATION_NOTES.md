# @velou/widget Implementation Notes

## Package Structure Created

The widget package has been created at `packages/@velou/widget/` with the following structure:

```
packages/@velou/widget/
├── package.json              # NPM package configuration
├── tsconfig.json             # TypeScript configuration
├── webpack.config.js         # Build configuration
├── .npmignore                # Files to exclude from npm package
├── README.md                  # Package documentation
├── src/
│   ├── components/
│   │   ├── ChatWidget.tsx    # Main widget component (simplified)
│   │   └── index.ts
│   ├── hooks/
│   │   ├── useAssistantQuery.ts    # ✅ Complete
│   │   ├── useChatPersistence.ts   # ✅ Complete
│   │   ├── useAnalytics.ts          # ✅ Complete
│   │   └── index.ts
│   ├── services/
│   │   ├── apiClient.ts      # ✅ Complete - WidgetApiClient
│   │   ├── sessionManager.ts # ✅ Complete
│   │   └── index.ts
│   ├── types/
│   │   ├── widget.ts         # ✅ Complete
│   │   ├── api.ts            # ✅ Complete
│   │   ├── message.ts        # ✅ Complete
│   │   └── index.ts
│   ├── styles/
│   │   ├── widget.css        # ✅ Complete - Encapsulated styles
│   │   └── reset.css         # ✅ Complete
│   ├── CDN/
│   │   └── loader.js         # ✅ Complete - Standalone CDN loader
│   ├── index.ts              # ✅ Complete - NPM entry point
│   └── index.browser.ts      # ✅ Complete - Browser entry point
└── dist/                     # Build output (generated)
```

## What's Complete

### ✅ Core Infrastructure
- Package configuration (package.json, tsconfig.json, webpack.config.js)
- TypeScript types for all public APIs
- Build system with webpack
- NPM package structure

### ✅ Services Layer
- **WidgetApiClient**: Complete HTTP client with:
  - Streaming message support (SSE)
  - Greeting, placeholder, suggestions endpoints
  - Analytics event tracking
  - Error handling and retries
- **SessionManager**: Session ID management using sessionStorage

### ✅ React Hooks
- **useAssistantQuery**: Complete hook for sending messages and handling responses
- **useChatPersistence**: Complete hook for localStorage persistence
- **useAnalytics**: Complete hook for event tracking with offline queuing

### ✅ CDN Loader
- Standalone JavaScript loader
- Auto-mounts from script tag attributes
- Loads React and widget bundle dynamically
- Global API: `VelouWidget.mount()`, `VelouWidget.unmount()`, etc.

### ✅ Styles
- Encapsulated CSS with CSS custom properties
- Responsive design
- No Tailwind dependencies
- Prevents style conflicts with host pages

## What Needs Implementation

### ⚠️ Components (Simplified Placeholder)

The `ChatWidget.tsx` component is a **simplified placeholder**. For production, you need to:

1. **Extract full components from main app**:
   - `ChatPanel.tsx` - Full message list, input, suggestions
   - `MessageList.tsx` - Message rendering with product cards
   - `MessageInput.tsx` - Input with product context
   - `ProductCarousel.tsx` - Product card carousel
   - `QueryProgressBar.tsx` - Progress indicator
   - `SuggestedPrompts.tsx` - Prompt suggestions
   - `AssistantAvatar.tsx` - Avatar component
   - `MarkdownText.tsx` - Markdown rendering

2. **Refactor components to be standalone**:
   - Remove all `@/` imports (replace with relative imports)
   - Remove Tailwind classes (replace with CSS classes from `widget.css`)
   - Remove dependencies on main app services
   - Use widget hooks and services instead

3. **Enhance ChatWidget**:
   - Add drag/resize functionality
   - Add position customization
   - Add theme customization
   - Add full product card rendering
   - Add markdown support for messages

## Next Steps

1. **Extract and refactor components**:
   ```bash
   # Copy components from src/components/Chat/ to packages/@velou/widget/src/components/
   # Then refactor to remove dependencies
   ```

2. **Update API endpoints**:
   - The widget expects endpoints at `/api/widget/{merchantId}/...`
   - You'll need to create these endpoints in the main app:
     - `POST /api/widget/{merchantId}/assistant/stream`
     - `GET /api/widget/{merchantId}/chat/greeting`
     - `GET /api/widget/{merchantId}/chat/placeholder`
     - `GET /api/widget/{merchantId}/suggestions`
     - `POST /api/widget/{merchantId}/analytics/event`

3. **Build and test**:
   ```bash
   cd packages/@velou/widget
   npm install
   npm run build
   ```

4. **Publish to npm** (when ready):
   ```bash
   npm publish --access public
   ```

## API Endpoints Required

The widget expects the following API structure:

```
POST /api/widget/{merchantId}/assistant/stream
  - Body: AssistantApiRequest
  - Response: SSE stream with progress events and final response

GET /api/widget/{merchantId}/chat/greeting
  - Response: { greeting: string }

GET /api/widget/{merchantId}/chat/placeholder
  - Response: { placeholder: string }

GET /api/widget/{merchantId}/suggestions?lastMessage=...
  - Response: { suggestions: string[] }

POST /api/widget/{merchantId}/analytics/event
  - Body: AnalyticsEvent
  - Response: { success: boolean }
```

All endpoints should:
- Accept `X-API-Key` header for authentication
- Accept `X-Merchant-Id` header (or extract from URL)
- Return appropriate CORS headers
- Handle rate limiting per API key

## Testing

1. **Local development**:
   ```bash
   cd packages/@velou/widget
   npm run dev
   ```

2. **Test in main app**:
   ```tsx
   import { VelouWidget } from '@velou/widget';
   // Use in your app
   ```

3. **Test CDN loader**:
   ```html
   <script src="http://localhost:3000/widget.js" 
     data-merchant-id="test"
     data-api-key="test-key"></script>
   ```

## Notes

- The widget is designed to be **completely standalone** - no dependencies on the main app
- All communication happens via API calls
- Session management uses sessionStorage (per-tab isolation)
- Analytics events are queued when offline and sent when online
- CSS is encapsulated to prevent conflicts with host pages
- TypeScript definitions are included for full type safety


