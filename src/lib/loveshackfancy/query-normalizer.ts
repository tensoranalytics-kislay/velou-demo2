/**
 * Query Normalizer
 * 
 * Normalizes user queries by removing filler words and standardizing format.
 */

/**
 * Normalize query for search by removing filler words and standardizing
 */
export function normalizeQueryForSearch(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Remove common filler words
  const fillerWords = [
    'i want', 'i need', 'i\'m looking for', 'looking for', 'show me', 'find me',
    'can you', 'please', 'i would like', 'i\'d like', 'give me', 'get me',
    'help me find', 'help me', 'i need help', 'search for', 'search'
  ];

  let normalized = query.toLowerCase().trim();

  // Remove filler words
  for (const filler of fillerWords) {
    const regex = new RegExp(`^${filler}\\s+`, 'i');
    normalized = normalized.replace(regex, '');
  }

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized || query; // Fallback to original if empty
}
