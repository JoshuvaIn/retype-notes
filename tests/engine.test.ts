import { describe, it, expect } from "vitest";
import { isCharMatch, normalizeChar } from "../src/engine/chars";
import { calculateStats } from "../src/stats";
import { calculateSrsRating, updateSrs } from "../src/srs";
import { TypingEngine } from "../src/engine/typing";
import { DEFAULT_SETTINGS } from "../src/types";
import { TypeableChar } from "../src/render/extract";

function makeChars(text: string): TypeableChar[] {
  return Array.from(text).map((ch) => ({
    char: ch,
    expected: ch.toLowerCase(),
    blockIndex: 0,
    isGhost: false,
    isHeading: false,
    headingPath: "Test",
  }));
}

describe("Characters Engine", () => {
  it("normalizes lenient em-dash and curly quotes", () => {
    expect(normalizeChar("—", { lenientSymbols: true })).toBe("-");
    expect(normalizeChar("“", { lenientSymbols: true })).toBe('"');
    expect(normalizeChar("’", { lenientSymbols: true })).toBe("'");
  });

  it("matches case insensitive by default", () => {
    expect(isCharMatch("a", "A", { caseSensitive: false })).toBe(true);
    expect(isCharMatch("a", "A", { caseSensitive: true })).toBe(false);
  });
});

describe("TypingEngine Mechanics", () => {
  it("clears the current word on Ctrl+Backspace", () => {
    const chars = makeChars("hello world");
    const statuses: Record<number, string> = {};
    const engine = new TypingEngine(chars, DEFAULT_SETTINGS, {
      onCharUpdate: (idx, st) => {
        statuses[idx] = st;
      },
    });

    // Type "hello wor"
    for (const ch of "hello wor") {
      engine.handleKey(ch, false);
    }
    expect(engine.currentIndex).toBe(9);

    // Press Ctrl+Backspace -> should rewind to start of "world" (index 6)
    engine.handleKey("Backspace", true);
    expect(engine.currentIndex).toBe(6);
    expect(statuses[6]).toBe("pending");
    expect(statuses[7]).toBe("pending");
    expect(statuses[8]).toBe("pending");
    engine.destroy();
  });

  it("emits live WPM and progress updates as keys are typed", () => {
    const chars = makeChars("relay basics");
    let liveProgress = "";
    const engine = new TypingEngine(chars, DEFAULT_SETTINGS, {
      onLiveWpm: (_wpm, _acc, progressText) => {
        liveProgress = progressText;
      },
    });

    engine.handleKey("r", false);
    expect(liveProgress).toContain("words");
    engine.destroy();
  });
});

describe("Statistics Module", () => {
  it("calculates accurate WPM and raw WPM", () => {
    const stats = calculateStats({
      charsCorrect: 25,
      charsIncorrect: 2,
      charsExtra: 0,
      charsMissed: 0,
      durationMs: 30000,
      troubleWordsMap: { test: 2 },
    });

    expect(stats.wpm).toBe(10);
    expect(stats.accuracy).toBe(93);
    expect(stats.troubleWords).toEqual(["test"]);
  });
});

describe("SRS Repetition", () => {
  it("advances interval on high accuracy rating", () => {
    const rating = calculateSrsRating(99, 50, 40);
    expect(rating).toBe(5);

    const srs = updateSrs(undefined, rating, new Date("2026-10-22"));
    expect(srs.interval).toBe(1);
    expect(srs.repetitions).toBe(1);
  });
});
