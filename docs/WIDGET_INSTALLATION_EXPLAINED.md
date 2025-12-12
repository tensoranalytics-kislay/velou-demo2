# How the Velou Widget Installation Works - A to Z Guide

## For Non-Technical Users

This guide explains in simple, everyday language how the Velou shopping assistant widget gets installed on different types of ecommerce websites and how it works once it's there.

---

## Part 1: What is the Widget?

Think of the Velou widget like a **helpful sales assistant** that lives on your website. When customers visit your store, they see a small chat button (usually in the bottom-right corner). When they click it, they can ask questions like:

- "Show me summer dresses under $50"
- "What's your best-selling hand cream?"
- "Do you have anything in size medium?"

The widget uses artificial intelligence to understand what customers want and shows them relevant products from your catalog, just like a real salesperson would.

---

## Part 2: The Installation Process - Step by Step

### Step A: You Get Your Credentials

When you sign up for Velou, you get two important pieces of information:

1. **Your Merchant ID** - This is like your store's unique ID number (e.g., `acme-corp-123`)
2. **Your API Key** - This is like a password that proves the widget is allowed to access your store's data (e.g., `pk_live_abc123xyz`)

Think of it like this: Your Merchant ID is your store's address, and your API Key is the key to unlock the door.

### Step B: You Choose Your Platform

Velou works with different types of websites. The installation process is slightly different for each:

#### **Option 1: Shopify Store**
- **What it is:** Shopify is a popular platform for online stores
- **How it works:** You install the "Velou" app from the Shopify App Store (like installing an app on your phone)
- **What happens:** Once installed, the widget automatically appears on your Shopify store - no code needed!
- **Who does it:** You just click "Install" in the Shopify App Store, and it's done

#### **Option 2: WordPress Website**
- **What it is:** WordPress is a website builder used by many businesses
- **How it works:** You install a "plugin" (a small add-on) to your WordPress site
- **What happens:** The plugin adds the widget code to your site automatically
- **Who does it:** You download the plugin file, upload it to WordPress, and activate it

#### **Option 3: Custom Website (HTML/JavaScript)**
- **What it is:** A website built from scratch or using custom code
- **How it works:** You copy a small piece of code (like a recipe) and paste it into your website's HTML
- **What happens:** The code tells your website to load the Velou widget
- **Who does it:** Usually a web developer, but it's simple enough that many store owners can do it themselves

#### **Option 4: Wix or Squarespace**
- **What it is:** Website builders that let you create sites without coding
- **How it works:** Similar to custom websites - you add a code snippet to your site
- **What happens:** The widget appears on your site
- **Who does it:** You can usually do it yourself by adding the code in the site's settings

---

## Part 3: What Happens When You Install the Widget?

### The Installation Process (Behind the Scenes)

Here's what happens when you add the widget to your website:

1. **You Add the Code**
   - You copy a small script tag (a line of code) that looks like this:
   ```html
   <script src="https://cdn.velou.ai/widget.js"
     data-merchant-id="your-store-id"
     data-api-key="your-api-key">
   </script>
   ```
   - This code is like a recipe that tells your website: "Hey, go get the Velou widget and show it to visitors"

2. **Your Website Loads the Widget**
   - When someone visits your website, their browser (Chrome, Safari, etc.) reads this code
   - The browser says: "Oh, I need to load the Velou widget from Velou's servers"
   - It goes to Velou's servers and downloads the widget code (like downloading an app)

3. **The Widget Appears**
   - The widget code runs in the visitor's browser
   - A small chat button appears (usually in the bottom-right corner)
   - The button is styled to match your brand colors

4. **The Widget Connects to Velou**
   - The widget uses your API Key to "introduce itself" to Velou's servers
   - It says: "Hi, I'm from Store XYZ, here's my API key to prove it"
   - Velou's servers check: "Yes, that API key is valid, and that store is allowed to use the widget"
   - The connection is established!

---

## Part 4: How the Widget Works When Customers Use It

### When a Customer Clicks the Widget

1. **The Chat Window Opens**
   - Customer clicks the chat button
   - A chat window pops up (like a messaging app)
   - The widget shows a greeting message (e.g., "Hi! How can I help you find the perfect product?")

2. **Customer Types a Question**
   - Customer types something like: "Show me red dresses under $100"
   - The widget sends this message to Velou's servers
   - The message includes:
     - What the customer asked
     - Your store's ID (so Velou knows which products to search)
     - The API key (to prove it's allowed)

3. **Velou's AI Understands the Request**
   - Velou's artificial intelligence reads the customer's question
   - It figures out what they want:
     - Category: Dresses
     - Color: Red
     - Price: Under $100
   - It searches your product catalog for matching items

4. **Velou Finds Products**
   - The AI searches through all your products
   - It finds dresses that are:
     - Red (or have red in the name/description)
     - Priced under $100
   - It ranks them by how well they match (best matches first)

5. **Velou Generates a Response**
   - The AI writes a friendly response like: "I found 5 red dresses under $100! Here are my top picks..."
   - It creates product cards showing:
     - Product image
     - Product name
     - Price
     - A short description
     - A "View Product" button

6. **The Response Appears in the Widget**
   - The widget receives the response from Velou's servers
   - It displays the message and product cards in the chat window
   - Customer can click "View Product" to go to the product page

7. **Customer Can Ask Follow-Up Questions**
   - Customer might ask: "Do you have any in size medium?"
   - The widget remembers the previous conversation
   - It searches the same red dresses, but filters for size medium
   - Shows updated results

---

## Part 5: Security and Privacy - How It's Protected

### API Key Security

- Your API Key is like a password - it proves the widget is allowed to access your store
- The widget sends the API key with every request
- Velou's servers check: "Is this API key valid? Is it active? Is it from the right store?"
- If the API key is wrong or expired, the request is rejected

### Origin Whitelist (Domain Security)

- You can specify which websites are allowed to use your widget
- For example, you might say: "Only allow the widget on `mystore.com`"
- If someone tries to use your widget on a different website, it won't work
- This prevents unauthorized use of your widget

### CORS (Cross-Origin Resource Sharing)

- This is a security feature that prevents websites from stealing data
- When the widget tries to talk to Velou's servers, the browser checks: "Is this website allowed to make this request?"
- Only websites you've approved can use your widget

---

## Part 6: Different Installation Methods Explained

### Method 1: Shopify App Store (Easiest)

**What you do:**
1. Go to Shopify App Store
2. Search for "Velou"
3. Click "Install"
4. Authorize the app
5. Done!

**What happens behind the scenes:**
- Shopify automatically adds the widget code to your store
- The widget appears on all pages of your store
- You don't need to touch any code

**Best for:** Shopify store owners who want the easiest installation

---

### Method 2: WordPress Plugin

**What you do:**
1. Download the Velou plugin file
2. Go to WordPress admin → Plugins → Add New
3. Upload the plugin file
4. Activate the plugin
5. Enter your Merchant ID and API Key in the plugin settings
6. Save

**What happens behind the scenes:**
- The plugin adds the widget code to your WordPress theme
- The code is added to every page automatically
- The widget appears on your site

**Best for:** WordPress website owners who are comfortable installing plugins

---

### Method 3: Custom Website (Code Snippet)

**What you do:**
1. Copy the script tag from the Velou admin panel
2. Open your website's HTML file (or use your website builder's code editor)
3. Find the `</body>` tag (usually near the bottom)
4. Paste the script tag just before `</body>`
5. Save and publish your website

**What the code looks like:**
```html
<script src="https://cdn.velou.ai/widget.js"
  data-merchant-id="your-store-id"
  data-api-key="your-api-key">
</script>
```

**What happens behind the scenes:**
- When someone visits your website, their browser reads this code
- The browser downloads the widget from Velou's servers
- The widget appears on your site

**Best for:** Custom websites, or websites built with HTML/JavaScript

---

### Method 4: Wix / Squarespace

**What you do:**
1. Copy the script tag from the Velou admin panel
2. In Wix: Go to Settings → Custom Code → Add Code to Head
3. In Squarespace: Go to Settings → Advanced → Code Injection → Footer
4. Paste the script tag
5. Save

**What happens behind the scenes:**
- The website builder adds the code to your site
- The widget loads when visitors come to your site

**Best for:** Wix or Squarespace users who want to add custom functionality

---

## Part 7: How the Widget Stays Updated

### Automatic Updates

- The widget code lives on Velou's servers (not on your website)
- When Velou releases updates (new features, bug fixes), they update the code on their servers
- Your website automatically gets the latest version - no action needed from you!

### Why This is Good

- You don't need to manually update anything
- You always have the latest features
- Bug fixes are applied automatically
- Security updates happen automatically

---

## Part 8: Monitoring and Analytics

### Installation Status

In your Velou admin panel, you can see:

- **Widget Health:** Is the widget working? (Connected / Degraded / Disconnected)
- **Last Detected:** When was the widget last seen on your website?
- **Metrics:** How many requests? How many errors? Average response time?

### What This Tells You

- **Connected:** Widget is working perfectly ✅
- **Degraded:** Widget is working but having some issues ⚠️
- **Disconnected:** Widget not detected - might not be installed correctly ❌

### Analytics Events

The widget tracks:
- When customers open the chat
- What questions they ask
- Which products they click on
- How long conversations last

This helps you understand how customers are using the widget and what they're looking for.

---

## Part 9: Troubleshooting Common Issues

### Widget Not Showing Up

**Possible causes:**
1. Code not added correctly
2. API key wrong or expired
3. Website domain not in the allowed origins list
4. Browser blocking the widget (ad blocker, privacy settings)

**How to fix:**
1. Check that the script tag is in your HTML
2. Verify your API key is correct
3. Add your website domain to the allowed origins list
4. Try a different browser or disable ad blockers

### Widget Shows Error Messages

**Possible causes:**
1. API key invalid
2. Network connection issues
3. Velou servers temporarily down

**How to fix:**
1. Check your API key in the admin panel
2. Check your internet connection
3. Wait a few minutes and try again

### Widget Not Responding

**Possible causes:**
1. No products in your catalog
2. API key expired
3. Rate limit exceeded (too many requests)

**How to fix:**
1. Make sure you've uploaded products to your catalog
2. Regenerate your API key if needed
3. Wait a few minutes and try again

---

## Part 10: The Complete Flow - From Installation to Customer Interaction

### The Full Journey

1. **You Sign Up for Velou**
   - You create an account
   - You get your Merchant ID and API Key
   - You upload your product catalog

2. **You Install the Widget**
   - You choose your platform (Shopify, WordPress, Custom, etc.)
   - You follow the installation instructions
   - You add the widget code to your website

3. **You Configure the Widget**
   - You add your website domain to the allowed origins list
   - You customize the widget appearance (colors, position, etc.)
   - You test the widget to make sure it works

4. **A Customer Visits Your Website**
   - They see your website normally
   - They notice a small chat button in the corner
   - They're curious and click it

5. **The Widget Opens**
   - A chat window appears
   - The widget shows a greeting: "Hi! How can I help you?"
   - The customer can start typing

6. **Customer Asks a Question**
   - Customer types: "Show me blue jeans"
   - The widget sends this to Velou's servers
   - Velou's AI searches your catalog

7. **Velou Responds**
   - AI finds matching products
   - AI writes a friendly response
   - Response and product cards appear in the chat

8. **Customer Interacts**
   - Customer clicks on a product
   - They're taken to the product page
   - They might ask follow-up questions
   - They might make a purchase!

9. **You See the Results**
   - In your Velou admin panel, you see:
     - How many customers used the widget
     - What questions they asked
     - Which products they clicked on
     - Conversion rates

---

## Summary: The Simple Version

**In the simplest terms:**

1. You add a small piece of code to your website (like adding a recipe to a cookbook)
2. When customers visit your site, their browser reads this code
3. The browser goes to Velou's servers and downloads the widget
4. The widget appears on your website as a chat button
5. When customers click it, they can ask questions
6. The widget sends questions to Velou's AI
7. The AI searches your products and responds
8. Customers see product recommendations in the chat
9. They can click products to view them or make purchases

**That's it!** The widget is like having a helpful sales assistant that works 24/7 on your website, answering customer questions and showing them products they might like.

---

## Need Help?

If you have questions or run into issues:
- Check the troubleshooting section in your Velou admin panel
- Contact Velou support
- Review the installation instructions for your specific platform

The widget is designed to be simple to install and use, but if you need help, we're here for you!

