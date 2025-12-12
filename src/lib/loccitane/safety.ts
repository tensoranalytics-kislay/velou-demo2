/**
 * Safety & Domain Gate
 * 
 * Rule-based safety checking and domain filtering for user queries.
 * Returns early for unsafe or non-shopping queries without hitting LLM or search.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 2)
 */

export type SafetyCheckResult =
  | { safe: true }
  | { safe: false; reason: 'unsafe' | 'non_shopping' | 'self_harm' };

/**
 * Patterns that indicate self-harm or emotional crisis
 * These require compassionate, supportive responses (not product recommendations)
 */
const SELF_HARM_PATTERNS = [
  // Direct self-harm statements
  /\b(suicide|suicidal|kill\s+myself|end\s+my\s+life|take\s+my\s+life|hurt\s+myself|harm\s+myself)\b/gi,
  /\b(want\s+to\s+die|wanna\s+die|don't\s+want\s+to\s+live|don't\s+want\s+to\s+be\s+here)\b/gi,
  /\b(ending\s+it\s+all|ending\s+everything|end\s+it\s+all)\b/gi,
  
  // Emotional crisis indicators
  /\b(can't\s+go\s+on|can't\s+take\s+it|giving\s+up|nothing\s+matters|no\s+point|hopeless)\b/gi,
  /\b(severe\s+depression|deep\s+depression|clinical\s+depression|mental\s+health\s+crisis)\b/gi,
  /\b(having\s+a\s+breakdown|mental\s+breakdown|emotional\s+breakdown)\b/gi,
  
  // Crisis hotline keywords
  /\b(crisis\s+hotline|suicide\s+hotline|helpline|crisis\s+line)\b/gi,
];

/**
 * Patterns that indicate unsafe content (excluding self-harm, which is handled separately)
 */
const UNSAFE_PATTERNS = [
  // Explicit sexual content (not product-related)
  /\b(porn|xxx|nude|naked|sex|sexual|erotic|adult\s+content)\b/gi,
  
  // Hate speech indicators
  /\bhate\s+(blacks|jews|muslims|asians|jewish|black|muslim|asian)\b/gi,
  /\bracist\b/gi,
  /\bnazi\b/gi,
  /\bslur\b/gi,
  
  // Violence (excluding self-harm which is handled separately)
  /\b(violence|murder|assault|rape|abuse)\b/gi,
];

/**
 * Patterns that indicate non-shopping queries
 */
const NON_SHOPPING_PATTERNS = [
  // General conversation
  /^(write|tell|give|make|create|do|can\s+you)\s+(me\s+)?(a\s+)?(poem|joke|story|song|recipe|code|program|essay|letter)/i,
  
  // Math/science questions
  /^(what|how|why|when|where|who)\s+(is|are|was|were|does|do|did|will|can)\s+(1\+1|2\+2|the\s+speed|gravity|physics|chemistry|biology)/i,
  
  // Time/weather
  /^(what\s+(time|date|day|weather)|what's\s+(the\s+)?(time|date|day|weather))/i,
  
  // General knowledge
  /^(who\s+(is|was|are|were)|what\s+(is|was|are|were)|where\s+(is|was|are|were)|when\s+(is|was|are|were))\s+(president|capital|country|city|planet|star)/i,
  
  // Non-product requests
  /^(help\s+me\s+with|explain|teach|learn|tutorial|guide)\s+(math|science|history|language|programming|cooking)/i,
];

/**
 * Check if a query is safe and shopping-related
 * 
 * Returns early for unsafe content or clearly non-shopping queries.
 * This prevents unnecessary LLM calls and search operations.
 * 
 * @param message - User query message
 * @returns SafetyCheckResult indicating if query is safe and shopping-related
 */
export function checkQuerySafety(message: string): SafetyCheckResult {
  if (!message || typeof message !== 'string') {
    return { safe: true }; // Empty/null messages are safe (will be handled elsewhere)
  }
  
  const normalized = message.trim();
  if (normalized.length === 0) {
    return { safe: true };
  }
  
  // Check for self-harm/crisis FIRST (highest priority, needs compassionate response)
  // Reset regex lastIndex to avoid state issues
  for (const pattern of SELF_HARM_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    if (pattern.test(normalized)) {
      return { safe: false, reason: 'self_harm' };
    }
  }
  
  // Check for other unsafe content
  for (const pattern of UNSAFE_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    if (pattern.test(normalized)) {
      return { safe: false, reason: 'unsafe' };
    }
  }
  
  // Check for non-shopping queries
  for (const pattern of NON_SHOPPING_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    if (pattern.test(normalized)) {
      return { safe: false, reason: 'non_shopping' };
    }
  }
  
  // Default: safe
  return { safe: true };
}

