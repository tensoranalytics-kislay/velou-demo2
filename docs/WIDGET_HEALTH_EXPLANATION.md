# Widget Health Status Explanation

## Why Widget Shows "Disconnected"

The widget health status is determined by checking for a `widget_loaded` analytics event in the database. The status shows:

- **Connected**: Widget sent a `widget_loaded` event within the last 24 hours
- **Degraded**: Widget sent an event within 24 hours but has >10 errors
- **Disconnected**: No `widget_loaded` event found, or last event was >24 hours ago

## How to Get "Connected" Status

The widget must be **actually loaded on a webpage** for the health status to update. Simply building the widget package doesn't trigger the event.

### Steps:

1. **Embed the widget on a page:**
   ```html
   <script src="https://cdn.velou.ai/widget.js" 
     data-merchant-id="your-merchant-id"
     data-api-key="pk_live_xxx"></script>
   ```

2. **Or use React:**
   ```tsx
   import { VelouWidget } from '@velou/widget';
   
   <VelouWidget config={{
     merchantId: 'your-merchant-id',
     apiKey: 'pk_live_xxx',
   }} />
   ```

3. **Load the page in a browser** - The widget automatically sends a `widget_loaded` event when it mounts

4. **Check admin page** - The health status should update to "Connected" within a few seconds

## Testing Locally

To test the widget health locally:

1. **Start the dev server:**
   ```bash
   npm run dev
   ```

2. **Create a test HTML page:**
   ```html
   <!DOCTYPE html>
   <html>
   <head>
     <title>Widget Test</title>
   </head>
   <body>
     <h1>Widget Test Page</h1>
     <div id="velou-widget-root"></div>
     
     <script src="http://localhost:3000/api/widget/test-loader.js"></script>
     <script>
       // Or manually mount
       window.VelouWidget.mount({
         merchantId: 'default-merchant-1d1e7488-8031-4dd5-8808-a8842813455f',
         apiKey: 'pk_live_xxx', // Get from admin page
       });
     </script>
   </body>
   </html>
   ```

3. **Open the page in a browser** - Widget will send `widget_loaded` event

4. **Check admin page** - Health should show "Connected"

## Troubleshooting

### Widget Still Shows "Disconnected"

1. **Check browser console** for errors:
   - CORS errors? → Add your origin to allowed origins in admin
   - 401 errors? → Check API key is correct
   - 403 errors? → Origin not in whitelist

2. **Check network tab** in browser DevTools:
   - Look for POST request to `/api/widget/{merchantId}/analytics/event`
   - Should return 200 status
   - Check request payload includes `eventType: "widget_loaded"`

3. **Check server logs:**
   ```bash
   # Look for analytics events
   grep "widget_analytics_event_received" logs
   ```

4. **Verify database:**
   ```sql
   SELECT * FROM "AnalyticsEvent" 
   WHERE "eventType" = 'widget_loaded' 
   AND "merchantId" = 'your-merchant-id'
   ORDER BY "createdAt" DESC 
   LIMIT 1;
   ```

### Event Not Being Stored

- Check `trackEvent` function in `AnalyticsService.ts` is working
- Check database connection
- Check Prisma schema matches database

## Fixed Issues

✅ **Fixed:** Analytics route now uses correct `merchantId` variable  
✅ **Fixed:** Widget API client now sends `payload` instead of `data`  
✅ **Fixed:** Widget sends `userDevice`, `userPage`, `userReferer` fields  
✅ **Fixed:** Widget tracks `widget_loaded` event on mount

## Next Steps

1. Rebuild the widget package:
   ```bash
   cd packages/@velou/widget
   npm run build
   ```

2. Load widget on a test page

3. Check admin page - health should update to "Connected"


