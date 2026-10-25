export interface WpmSample {
  timestampMs: number;
  wpm: number;
  rawWpm: number;
  errorsSoFar: number;
}

export interface SessionStats {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  charsTotal: number;
  charsCorrect: number;
  charsIncorrect: number;
  charsExtra: number;
  charsMissed: number;
  troubleWords: string[];
  timeline: WpmSample[];
}

/**
 * Calculate standard typing statistics.
 * Standard formula:
 * 1 word = 5 characters.
 * Raw WPM = (Total Typed Chars / 5) / (Time in Minutes)
 * Net WPM = (Correct Chars / 5) / (Time in Minutes)
 * Accuracy = Correct Chars / (Total Typed Chars + Missed Chars) * 100
 */
export function calculateStats(params: {
  charsCorrect: number;
  charsIncorrect: number;
  charsExtra: number;
  charsMissed: number;
  durationMs: number;
  troubleWordsMap: Record<string, number>;
  timeline?: WpmSample[];
}): SessionStats {
  const {
    charsCorrect,
    charsIncorrect,
    charsExtra,
    charsMissed,
    durationMs,
    troubleWordsMap,
    timeline = [],
  } = params;

  // Use at least 2.5 seconds (2.5 / 60 min) as the denominator so initial keystrokes don't spike to 4000 WPM
  const minutes = Math.max(durationMs / 60000, 2.5 / 60);
  const totalTyped = charsCorrect + charsIncorrect + charsExtra;
  const rawWpm = Math.round((totalTyped / 5) / minutes);
  const wpm = Math.max(0, Math.round((charsCorrect / 5) / minutes));

  const totalAttempted = totalTyped + charsMissed;
  const accuracy = totalAttempted > 0 
    ? Math.round((charsCorrect / totalAttempted) * 100) 
    : 100;

  // Calculate consistency from timeline samples
  let consistency = 100;
  if (timeline.length > 2) {
    const wpms = timeline.map(s => s.wpm);
    const mean = wpms.reduce((a, b) => a + b, 0) / wpms.length;
    if (mean > 0) {
      const variance = wpms.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / wpms.length;
      const stdDev = Math.sqrt(variance);
      // Coefficient of variation based consistency
      const cov = (stdDev / mean) * 100;
      consistency = Math.max(0, Math.min(100, Math.round(100 - cov)));
    }
  }

  // Sort trouble words by frequency
  const troubleWords = Object.entries(troubleWordsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  return {
    wpm,
    rawWpm,
    accuracy,
    consistency,
    durationMs,
    charsTotal: charsCorrect + charsMissed,
    charsCorrect,
    charsIncorrect,
    charsExtra,
    charsMissed,
    troubleWords,
    timeline,
  };
}
