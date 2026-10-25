import { describe, it, expect } from "vitest";
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
    headingPath: "Stress",
  }));
}

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("Engine stress", () => {
  for (const strictMode of [false, true]) {
    it(`finishes 60k chars with random typos, backspaces and junk keys (strict=${strictMode})`, () => {
      const text = "The quick brown fox jumps over the lazy dog, again and again. ".repeat(1000);
      const rand = rng(42);
      let completed = false;
      const engine = new TypingEngine(
        makeChars(text),
        { ...DEFAULT_SETTINGS, strictMode },
        { onStatsUpdate: () => (completed = true) }
      );
      const junk = ["Shift", "Tab", "Enter", "ArrowLeft", "Escape", "F5", "é", "🙂"];
      const started = performance.now();
      let guard = 0;
      while (!completed && guard++ < 400000) {
        const expected = text[engine.currentIndex] ?? " ";
        const r = rand();
        if (r < 0.04) engine.handleKey(junk[Math.floor(rand() * junk.length)], false);
        else if (r < 0.08) engine.handleKey("Backspace", false);
        else if (r < 0.1) engine.handleKey("Backspace", true);
        else if (r < 0.15) engine.handleKey("#", false);
        else engine.handleKey(expected, false);
      }
      expect(completed).toBe(true);
      expect(engine.getStats().accuracy).toBeGreaterThan(0);
      expect(performance.now() - started).toBeLessThan(5000);
      engine.destroy();
    });
  }
});
