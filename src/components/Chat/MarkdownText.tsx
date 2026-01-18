'use client';

import React from 'react';
import type { ProductCard } from '@/lib/llm/orchestrator/cards';

type MarkdownTextProps = {
  content: string;
  className?: string;
  productCards?: ProductCard[]; // Optional product cards for linking product names
};

/**
 * Splits paragraphs that contain multiple sentences into separate paragraphs.
 * Each sentence (ending with . ? !) becomes its own paragraph.
 * This ensures the "before product cards" section has one sentence per paragraph.
 */
function splitParagraphsBySentences(content: string): string {
  // Split by double newlines (existing paragraph breaks) first
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  const processedParagraphs: string[] = [];
  
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    
    // Split by sentence endings (. ? !) followed by space, newline, or end of string
    // Pattern: sentence ending (. ? !) followed by whitespace or end of string
    // This regex uses positive lookahead to split on sentence endings without consuming the delimiter
    const sentenceEndRegex = /([.!?]+)(?=\s+|$)/g;
    
    // Find all sentence endings and their positions
    const sentenceEnds: number[] = [];
    let match;
    while ((match = sentenceEndRegex.exec(trimmed)) !== null) {
      // Position after the sentence ending (including the punctuation)
      sentenceEnds.push(match.index + match[0].length);
    }
    
    // If no sentence endings found, keep the paragraph as-is
    if (sentenceEnds.length === 0) {
      processedParagraphs.push(trimmed);
      continue;
    }
    
    // Split into sentences
    let lastIndex = 0;
    for (const endIndex of sentenceEnds) {
      const sentence = trimmed.slice(lastIndex, endIndex).trim();
      if (sentence.length > 0) {
        processedParagraphs.push(sentence);
      }
      lastIndex = endIndex;
    }
    
    // Add any remaining text after the last sentence ending
    if (lastIndex < trimmed.length) {
      const remaining = trimmed.slice(lastIndex).trim();
      if (remaining.length > 0) {
        processedParagraphs.push(remaining);
      }
    }
  }
  
  // Join with double newlines to preserve paragraph structure
  return processedParagraphs.join('\n\n');
}

/**
 * Simple markdown renderer for assistant messages
 * Supports: **bold**, *italic*, - bullets, paragraphs, and product name links
 */
export default function MarkdownText({ content, className = '', productCards = [] }: MarkdownTextProps) {
  if (!content) return null;
  
  // Split paragraphs by sentences first (one sentence per paragraph)
  const contentWithSplitSentences = splitParagraphsBySentences(content);
  
  // Split by double newlines for paragraphs
  const paragraphs = contentWithSplitSentences.split(/\n\n+/).filter(Boolean);

  return (
    <div className={className}>
      {paragraphs.map((paragraph, pIdx) => {
        // Check if it's a bullet list
        const lines = paragraph.split('\n');
        const isBulletList = lines.some((line) => /^[-*]\s+/.test(line.trim()));

        if (isBulletList) {
          return (
            <ul key={pIdx} className="list-disc list-inside space-y-1 my-2 ml-4">
              {lines
                .filter((line) => /^[-*]\s+/.test(line.trim()))
                .map((line, lIdx) => {
                  const text = line.replace(/^[-*]\s+/, '');
                  return (
                    <li key={lIdx} className="text-sm leading-relaxed">
                      {renderInlineMarkdown(text, productCards)}
                    </li>
                  );
                })}
            </ul>
          );
        }

        // Regular paragraph
        return (
          <p key={pIdx} className="text-sm leading-relaxed my-2 first:mt-0 last:mb-0">
            {renderInlineMarkdown(paragraph.trim(), productCards)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Renders inline markdown: **bold**, *italic*, and product name links
 */
function renderInlineMarkdown(text: string, productCards: ProductCard[] = []): React.ReactNode {
  if (!text) return text;
  
  const parts: React.ReactNode[] = [];
  let currentIndex = 0;
  let keyCounter = 0;

  // Build product name mapping for linking
  // Extract base product names and variations for flexible matching
  const productNameMap = new Map<string, { url: string; fullTitle: string; originalTitle: string }>();
  
  if (productCards.length > 0) {
    // Debug: Log product cards received
    console.log('[MarkdownText] Building product name map from productCards:', {
      productCardsCount: productCards.length,
      productTitles: productCards.map(c => c.title),
      productUrls: productCards.map(c => c.productUrl),
      hasProductUrls: productCards.map(c => !!c.productUrl),
    });
    
    productCards.forEach((card) => {
      // Skip cards without productUrl - they can't be hyperlinked
      if (!card.productUrl) {
        console.warn('[MarkdownText] Product card missing productUrl, skipping hyperlink:', {
          productId: card.id,
          productTitle: card.title,
        });
        return;
      }
      
      const originalTitle = card.title.trim();
      
      // Extract the base product name (everything before " in " or " in," or similar patterns)
      // This handles cases like "Mystara Satin Maxi Dress in pink" matching "Mystara Satin Maxi Dress in Pink"
      const baseNameMatch = originalTitle.match(/^(.+?)(?:\s+in\s+[^,]+(?:,|$)|$)/i);
      let baseName = baseNameMatch ? baseNameMatch[1].trim() : originalTitle;
      
      // Extract shorter product name (before "for", "by", "Size:", etc.)
      // This handles: "Ciris Bead Mini Dress for Women in Shell" -> "Ciris Bead Mini Dress"
      const shorterNameMatch = baseName.match(/^(.+?)(?:\s+(?:for|by|Size:|size:)\s+|$)/i);
      const shorterName = shorterNameMatch ? shorterNameMatch[1].trim() : baseName;
      
      // Normalize for matching (lowercase, remove extra spaces)
      const normalizedBase = baseName.toLowerCase().replace(/\s+/g, ' ').trim();
      const normalizedShorter = shorterName.toLowerCase().replace(/\s+/g, ' ').trim();
      const normalizedFull = originalTitle.toLowerCase().replace(/\s+/g, ' ').trim();
      
      // Store base name (without "in color")
      if (normalizedBase && !productNameMap.has(normalizedBase)) {
        productNameMap.set(normalizedBase, { url: card.productUrl!, fullTitle: originalTitle, originalTitle });
      }
      
      // Store shorter name (without "for Women", "by Brand", "Size: X", etc.)
      if (normalizedShorter && normalizedShorter !== normalizedBase && !productNameMap.has(normalizedShorter)) {
        productNameMap.set(normalizedShorter, { url: card.productUrl!, fullTitle: originalTitle, originalTitle });
      }
      
      // Store full title (with "in color")
      if (normalizedFull && !productNameMap.has(normalizedFull)) {
        productNameMap.set(normalizedFull, { url: card.productUrl!, fullTitle: originalTitle, originalTitle });
      }
      
      // Store with "The" prefix for all variations
      if (normalizedBase) {
        const withThe = `the ${normalizedBase}`;
        if (!productNameMap.has(withThe)) {
          productNameMap.set(withThe, { url: card.productUrl!, fullTitle: originalTitle, originalTitle });
        }
      }
      
      if (normalizedShorter && normalizedShorter !== normalizedBase) {
        const withTheShorter = `the ${normalizedShorter}`;
        if (!productNameMap.has(withTheShorter)) {
          productNameMap.set(withTheShorter, { url: card.productUrl!, fullTitle: originalTitle, originalTitle });
        }
      }
      
      if (normalizedFull) {
        const withTheFull = `the ${normalizedFull}`;
        if (!productNameMap.has(withTheFull)) {
          productNameMap.set(withTheFull, { url: card.productUrl!, fullTitle: originalTitle, originalTitle });
        }
      }
    });
    
    // Debug: Log product name map
    console.log('[MarkdownText] Product name map built:', {
      mapSize: productNameMap.size,
      mapKeys: Array.from(productNameMap.keys()).slice(0, 10), // First 10 keys
    });
  } else {
    console.log('[MarkdownText] No productCards provided, product hyperlinks will not work');
  }

  // Regex to match **bold** first, then *italic*, then product names
  const boldRegex = /\*\*([^*]+)\*\*/g;
  const italicRegex = /\*([^*]+)\*/g;
  
  // First pass: find all bold matches
  const boldMatches: Array<{ start: number; end: number; content: string }> = [];
  let match;
  
  while ((match = boldRegex.exec(text)) !== null) {
    boldMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[1],
    });
  }
  
  // Second pass: find italic matches that don't overlap with bold
  const italicMatches: Array<{ start: number; end: number; content: string }> = [];
  while ((match = italicRegex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    // Check if this italic match overlaps with any bold match
    const overlaps = boldMatches.some(
      (bm) => !(end <= bm.start || start >= bm.end)
    );
    if (!overlaps) {
      italicMatches.push({
        start,
        end,
        content: match[1],
      });
    }
  }
  
  // Third pass: find product name matches (only if we have product cards)
  const productMatches: Array<{ start: number; end: number; content: string; url: string }> = [];
  if (productCards.length > 0 && productNameMap.size > 0) {
    // Sort product names by length (longest first) to prefer longer, more specific matches
    const sortedProductNames = Array.from(productNameMap.entries())
      .sort((a, b) => b[0].length - a[0].length);
    
    // Debug: Log text being searched
    console.log('[MarkdownText] Searching for product names in text:', {
      textLength: text.length,
      textPreview: text.substring(0, 100),
      productNamesToSearch: sortedProductNames.slice(0, 5).map(([name]) => name),
    });
    
    // Try to match product names in the text
    // Look for patterns like "Product Name in color" or just "Product Name" or "The Product Name"
    for (const [normalizedName, { url, originalTitle }] of sortedProductNames) {
      // Create a regex that matches the product name (case-insensitive, word boundaries)
      // Handle variations like "Mystara Satin Maxi Dress" or "Mystara Satin Maxi Dress in pink" or "The Mystara Satin Maxi Dress"
      const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // More flexible pattern: match product name with optional "The" prefix and optional "in color" suffix
      // Handle multiple contexts: word boundaries, after punctuation, at start/end of text
      // This pattern is more flexible to catch product names in various contexts
      const productRegex = new RegExp(
        `(?:^|[\\s.,!?;:()"']|\\b)(?:the\\s+)?(${escapedName})(?:\\s+in\\s+[^.!?,\\s]+)?(?=[\\s.,!?;:()"']|\\b|$)`,
        'gi'
      );
      
      // Reset regex lastIndex to avoid issues with global regex
      productRegex.lastIndex = 0;
      
      while ((match = productRegex.exec(text)) !== null) {
        // match[0] is the full match (may include leading whitespace/punctuation, "The", and "in color")
        // match[1] is the captured product name (without "The")
        const fullMatch = match[0];
        const productNameOnly = match[1]; // This is what we want to hyperlink
        
        // Find where the product name actually starts in the text (excluding leading whitespace/punctuation and "The")
        let productNameStart = match.index;
        
        // Skip leading whitespace, punctuation, or word boundary characters
        const leadingMatch = fullMatch.match(/^[\s.,!?;:()"'"]+/);
        if (leadingMatch) {
          productNameStart = match.index + leadingMatch[0].length;
        }
        
        // Check if the product name part starts with "The " (case-insensitive)
        const namePart = fullMatch.replace(/^[\s.,!?;:()"'"]+/, '');
        if (/^the\s+/i.test(namePart)) {
          // Product name starts after "The " (4 characters)
          productNameStart += 4;
        }
        
        // Find where the product name ends (including optional "in color" but excluding "The")
        // The product name in the full match starts after any leading whitespace/punctuation and "The " prefix
        const namePartWithoutThe = namePart.replace(/^the\s+/i, '');
        const productNameWithColor = namePartWithoutThe.trim();
        
        // Remove trailing punctuation/whitespace from the match
        const cleanProductName = productNameWithColor.replace(/[\s.,!?;:()"'"]+$/, '');
        
        // Calculate end position
        const end = productNameStart + cleanProductName.length;
        
        // Extract the text that will be hyperlinked (product name + optional "in color", but not "The" or leading/trailing punctuation)
        const matchedText = text.slice(productNameStart, end);
        
        // Use productNameStart and end for the match boundaries
        const start = productNameStart;
        
        // Debug: Log match found
        console.log('[MarkdownText] Product name match found:', {
          normalizedName,
          originalTitle,
          matchedText,
          start,
          end,
          fullMatch,
          productNameOnly,
          matchIndex: match.index,
        });
        
        // Check if this product match overlaps with any bold or italic match
        const overlapsWithMarkdown = [
          ...boldMatches,
          ...italicMatches,
        ].some((m) => !(end <= m.start || start >= m.end));
        
        if (!overlapsWithMarkdown) {
          // Check if this overlaps with an existing product match (prefer longer matches)
          const overlappingIndex = productMatches.findIndex(
            (pm) => !(end <= pm.start || start >= pm.end)
          );
          
          if (overlappingIndex < 0) {
            // No overlap, add new match
            productMatches.push({
              start,
              end,
              content: matchedText,
              url,
            });
          } else {
            // Overlap exists, replace if this match is longer
            const existingMatch = productMatches[overlappingIndex];
            if (matchedText.length > existingMatch.content.length) {
              productMatches[overlappingIndex] = {
                start,
                end,
                content: matchedText,
                url,
              };
            }
          }
        }
      }
    }
    
    // Sort product matches by start position
    productMatches.sort((a, b) => a.start - b.start);
    
    // Debug: Log final product matches
    console.log('[MarkdownText] Final product matches:', {
      matchCount: productMatches.length,
      matches: productMatches.map(m => ({ content: m.content, url: m.url, start: m.start, end: m.end })),
    });
  }
  
  // Combine and sort all matches
  const allMatches = [
    ...boldMatches.map((m) => ({ ...m, type: 'bold' as const })),
    ...italicMatches.map((m) => ({ ...m, type: 'italic' as const })),
    ...productMatches.map((m) => ({ ...m, type: 'product' as const })),
  ].sort((a, b) => a.start - b.start);
  
  // Build parts
  for (const match of allMatches) {
    // Add text before the match
    if (match.start > currentIndex) {
      const beforeText = text.slice(currentIndex, match.start);
      if (beforeText) {
        parts.push(beforeText);
      }
    }
    
    // Add the matched markdown or product link
    if (match.type === 'bold') {
      parts.push(<strong key={`bold-${keyCounter++}`}>{match.content}</strong>);
    } else if (match.type === 'italic') {
      parts.push(<em key={`italic-${keyCounter++}`}>{match.content}</em>);
    } else if (match.type === 'product') {
      // Ensure URL is valid before creating link
      if (!match.url) {
        console.warn('[MarkdownText] Product match has no URL, rendering as plain text:', {
          content: match.content,
          start: match.start,
          end: match.end,
        });
        parts.push(match.content);
      } else {
        parts.push(
          <a
            key={`product-${keyCounter++}`}
            href={match.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-rose-600 hover:text-rose-700 underline font-medium transition-colors"
            onClick={(e) => {
              // Allow default link behavior (opens in new tab)
              e.stopPropagation();
            }}
          >
            {match.content}
          </a>
        );
      }
    }
    
    currentIndex = match.end;
  }
  
  // Add remaining text
  if (currentIndex < text.length) {
    parts.push(text.slice(currentIndex));
  }
  
  return parts.length > 0 ? <>{parts}</> : text;
}

