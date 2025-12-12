/**
 * CDN Loader Script
 * 
 * Standalone JavaScript loader for embedding the widget via CDN
 * No build tools required - works in any browser
 */

(function (global) {
  'use strict';

  // Configuration from script tag attributes
  const script = document.currentScript || document.querySelector('script[data-merchant-id]');
  const merchantId = script?.getAttribute('data-merchant-id');
  const apiKey = script?.getAttribute('data-api-key');
  const baseUrl = script?.getAttribute('data-base-url') || 'https://api.velou.ai';

  if (!merchantId || !apiKey) {
    console.error('[Velou Widget] Missing required attributes: data-merchant-id and data-api-key');
    return;
  }

  // Load CSS
  const loadCSS = () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${baseUrl}/widget/styles.css`;
    document.head.appendChild(link);
  };

  // Load React and ReactDOM if not already loaded
  const loadReact = () => {
    return new Promise((resolve) => {
      if (global.React && global.ReactDOM) {
        resolve();
        return;
      }

      const reactScript = document.createElement('script');
      reactScript.src = 'https://unpkg.com/react@18/umd/react.production.min.js';
      reactScript.onload = () => {
        const reactDOMScript = document.createElement('script');
        reactDOMScript.src = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js';
        reactDOMScript.onload = resolve;
        document.head.appendChild(reactDOMScript);
      };
      document.head.appendChild(reactScript);
    });
  };

  // Load widget bundle
  const loadWidget = () => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${baseUrl}/widget/bundle.js`;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  // Mount widget
  const mountWidget = (config) => {
    if (!global.VelouWidget) {
      console.error('[Velou Widget] Widget bundle not loaded');
      return;
    }

    // Create mount point
    let mountPoint = document.getElementById('velou-widget-root');
    if (!mountPoint) {
      mountPoint = document.createElement('div');
      mountPoint.id = 'velou-widget-root';
      document.body.appendChild(mountPoint);
    }

    // Render widget
    const root = global.ReactDOM.createRoot(mountPoint);
    root.render(global.React.createElement(global.VelouWidget.default || global.VelouWidget, {
      config: {
        merchantId,
        apiKey,
        baseUrl,
        ...config,
      },
    }));

    return root;
  };

  // Initialize
  let widgetRoot = null;

  const VelouWidgetAPI = {
    mount: (config = {}) => {
      if (widgetRoot) {
        console.warn('[Velou Widget] Widget already mounted');
        return;
      }

      loadCSS();
      loadReact()
        .then(loadWidget)
        .then(() => {
          widgetRoot = mountWidget(config);
        })
        .catch((error) => {
          console.error('[Velou Widget] Failed to load:', error);
        });
    },

    unmount: () => {
      if (widgetRoot) {
        widgetRoot.unmount();
        widgetRoot = null;
        const mountPoint = document.getElementById('velou-widget-root');
        if (mountPoint) {
          mountPoint.remove();
        }
      }
    },

    setMerchantId: (id) => {
      merchantId = id;
    },

    track: (eventType, data) => {
      // Track event via API
      fetch(`${baseUrl}/api/widget/${merchantId}/analytics/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Merchant-Id': merchantId,
        },
        body: JSON.stringify({
          eventType,
          sessionId: 'cdn-session',
          data,
          timestamp: Date.now(),
        }),
      }).catch(() => {
        // Silently fail
      });
    },
  };

  // Auto-mount if attributes are present
  if (merchantId && apiKey) {
    VelouWidgetAPI.mount();
  }

  // Expose global API
  global.VelouWidget = VelouWidgetAPI;

  // Also expose as window.VelouWidget for compatibility
  if (typeof window !== 'undefined') {
    window.VelouWidget = VelouWidgetAPI;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);


