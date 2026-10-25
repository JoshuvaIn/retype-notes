/**
 * Map of common unicode / non-standard keyboard symbols to simple equivalents or auto-fill
 */
export const LENIENT_MAP: Record<string, string> = {
  "—": "-", // em dash
  "–": "-", // en dash
  "−": "-", // minus sign
  "×": "x", // multiplication
  "·": "*", // middle dot
  "•": "*", // bullet
  "°": "deg",
  "“": '"', // left curly double quote
  "”": '"', // right curly double quote
  "‘": "'", // left curly single quote
  "’": "'", // right curly single quote
  "…": "...", // ellipsis
  "«": '"',
  "»": '"',
  "½": "1/2",
  "¼": "1/4",
  "¾": "3/4",
  "²": "2",
  "³": "3",
  "µ": "u", // micro
  "±": "+/-",
};

/**
 * Normalizes an input character or expected character based on typing settings.
 */
export function normalizeChar(
  char: string,
  options: {
    lenientSymbols?: boolean;
    caseSensitive?: boolean;
    requirePunctuation?: boolean;
  } = {}
): string {
  let c = char;

  if (options.lenientSymbols && LENIENT_MAP[c]) {
    c = LENIENT_MAP[c];
  }

  if (!options.caseSensitive) {
    c = c.toLowerCase();
  }

  return c;
}

/**
 * Checks if a character matches the expected character according to settings.
 */
export function isCharMatch(
  typed: string,
  expected: string,
  options: {
    lenientSymbols?: boolean;
    caseSensitive?: boolean;
    requirePunctuation?: boolean;
  } = {}
): boolean {
  if (typed === expected) return true;

  const normTyped = normalizeChar(typed, options);
  const normExpected = normalizeChar(expected, options);

  return normTyped === normExpected;
}

/**
 * Checks if a character is a punctuation symbol that might be skipped in words-only mode.
 */
export function isPunctuation(char: string): boolean {
  return /^[^\p{L}\p{N}\s]$/u.test(char);
}
