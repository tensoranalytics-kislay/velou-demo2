'use client';

import React from 'react';

type MarkdownTextProps = {
  content: string;
  className?: string;
};

/**
 * Simple markdown renderer for assistant messages
 * Supports: **bold**, *italic*, - bullets, and paragraphs
 */
export default function MarkdownText({ content, className = '' }: MarkdownTextProps) {
  if (!content) return null;
  
  // Split by double newlines for paragraphs
  const paragraphs = content.split(/\n\n+/).filter(Boolean);

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
                      {renderInlineMarkdown(text)}
                    </li>
                  );
                })}
            </ul>
          );
        }

        // Regular paragraph
        return (
          <p key={pIdx} className="text-sm leading-relaxed my-2 first:mt-0 last:mb-0">
            {renderInlineMarkdown(paragraph.trim())}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Renders inline markdown: **bold** and *italic*
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return text;
  
  const parts: React.ReactNode[] = [];
  let currentIndex = 0;
  let keyCounter = 0;

  // Regex to match **bold** first, then *italic* (to avoid conflicts)
  // Match **bold** first (more specific)
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
  
  // Combine and sort all matches
  const allMatches = [
    ...boldMatches.map((m) => ({ ...m, type: 'bold' as const })),
    ...italicMatches.map((m) => ({ ...m, type: 'italic' as const })),
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
    
    // Add the matched markdown
    if (match.type === 'bold') {
      parts.push(<strong key={`bold-${keyCounter++}`}>{match.content}</strong>);
    } else {
      parts.push(<em key={`italic-${keyCounter++}`}>{match.content}</em>);
    }
    
    currentIndex = match.end;
  }
  
  // Add remaining text
  if (currentIndex < text.length) {
    parts.push(text.slice(currentIndex));
  }
  
  return parts.length > 0 ? <>{parts}</> : text;
}

