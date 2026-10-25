import { describe, it, expect } from "vitest";
import {
  extractTypeableChars,
  extractWordsFromChars,
  buildSmartChunks,
} from "../src/render/extract";
import { DEFAULT_SETTINGS } from "../src/types";

describe("Extraction Pipeline on Relay Basics Fixture", () => {
  it("strips frontmatter, tables, math, code, links, callout titles, and punctuation in text mode while preserving Preview DOM structure", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="frontmatter">title: Relay Basics</div>
      <h1>Relay Basics</h1>
      <div class="callout" data-callout="summary">
        <div class="callout-title"><div class="callout-title-inner">In one line</div></div>
        <div class="callout-content">
          <p>A protective relay is a sensing device.</p>
        </div>
      </div>
      <h2>Purpose</h2>
      <p>Every power system will sooner or later face faults, short circuits, and overloads.</p>
      <div class="math math-inline">$I = \\frac{V}{R}$</div>
      <pre><code>def check_fault(current): return True</code></pre>
      <p>See <a class="internal-link" href="Fault Types">Fault Types</a> for details.</p>
      <table><tr><th>Relay Type</th></tr><tr><td>Overcurrent</td></tr></table>
      <p>Key terms: <strong>pickup current</strong>.</p>
    `;

    const result = extractTypeableChars(container, {
      contentStyle: "text",
      settings: DEFAULT_SETTINGS,
    });

    const fullExtractedText = result.allChars.map((c) => c.char).join("");

    // Verify typeable text contains the core words with punctuation stripped in text mode
    expect(fullExtractedText).toContain("Relay Basics");
    expect(fullExtractedText).toContain("A protective relay is a sensing device");
    expect(fullExtractedText).toContain(
      "Every power system will sooner or later face faults short circuits and overloads"
    );
    expect(fullExtractedText).toContain("Key terms pickup current");

    // Verify Preview DOM elements (callout box & strong tag) are preserved in-place
    expect(container.querySelector(".callout")).not.toBeNull();
    expect(container.querySelector("strong")).not.toBeNull();

    // Verify skipped content is completely absent
    expect(fullExtractedText).not.toContain("title: Relay Basics");
    expect(fullExtractedText).not.toContain("In one line");
    expect(fullExtractedText).not.toContain("check_fault");
    expect(fullExtractedText).not.toContain("Fault Types");
    expect(fullExtractedText).not.toContain("Overcurrent");
    expect(fullExtractedText).not.toContain("$");
    expect(fullExtractedText).not.toContain(",");
  });

  it("retains punctuation when contentStyle is exact", () => {
    const container = document.createElement("div");
    container.innerHTML = `<p>Faults: short circuits, earth faults, and overloads.</p>`;

    const result = extractTypeableChars(container, {
      contentStyle: "exact",
      settings: DEFAULT_SETTINGS,
    });

    const fullExtractedText = result.allChars.map((c) => c.char).join("");
    expect(fullExtractedText).toBe("Faults: short circuits, earth faults, and overloads.");
  });

  it("filters by selected section headings and removes unselected sections from DOM", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <h1>Relay Basics</h1>
      <p>Intro paragraph</p>
      <h2>Purpose</h2>
      <p>Purpose paragraph</p>
      <h2>Try to achieve</h2>
      <p>Target section paragraph</p>
    `;

    const result = extractTypeableChars(container, {
      contentStyle: "text",
      settings: DEFAULT_SETTINGS,
      targetHeadingPaths: ["Try to achieve"],
    });

    const fullExtractedText = result.allChars.map((c) => c.char).join("");
    expect(fullExtractedText).toContain("Try to achieve");
    expect(fullExtractedText).toContain("Target section paragraph");
    expect(fullExtractedText).not.toContain("Intro paragraph");
    expect(fullExtractedText).not.toContain("Purpose paragraph");
  });

  it("marks links as ghost when contentStyle is ghost and excludes ghost words from 10FastFingers word list", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <p>Review <a class="internal-link" href="Faults">Faults</a> now.</p>
    `;

    const result = extractTypeableChars(container, {
      contentStyle: "ghost",
      settings: DEFAULT_SETTINGS,
    });

    const ghostChars = result.allChars.filter((c) => c.isGhost);
    expect(ghostChars.length).toBeGreaterThan(0);
    expect(ghostChars.map((c) => c.char).join("")).toBe("Faults");

    const words = extractWordsFromChars(result.allChars);
    expect(words).toEqual(["Review", "now."]);
  });

  it("correctly filters by targetHeadingPaths even when skipHeadingText is true (no section duplication)", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <h1>Relay Basics</h1>
      <p>Intro paragraph</p>
      <h2>Purpose</h2>
      <p>Purpose unique text</p>
      <h2>Try to achieve</h2>
      <p>Achieve unique text</p>
    `;

    const result = extractTypeableChars(container, {
      contentStyle: "text",
      settings: { ...DEFAULT_SETTINGS, skipHeadingText: true },
      targetHeadingPaths: ["Purpose"],
    });

    const fullExtractedText = result.allChars.map((c) => c.char).join("");
    expect(fullExtractedText).toBe("Purpose unique text");
    expect(fullExtractedText).not.toContain("Achieve unique text");
    expect(fullExtractedText).not.toContain("Intro paragraph");
  });

  it("splits long text into 5-7 line sentence-aware chunks with 1-line lookahead peekText", () => {
    const container = document.createElement("div");
    const longPara = Array.from({ length: 18 })
      .map((_, i) => `Sentence number ${i + 1} explains how protective relays isolate electrical grid faults.`)
      .join(" ");
    container.innerHTML = `<p>${longPara}</p>`;

    const { allChars } = extractTypeableChars(container, {
      contentStyle: "exact",
      settings: DEFAULT_SETTINGS,
    });

    const chunks = buildSmartChunks(allChars, 6, true);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].startCharIdx).toBe(0);
    expect(chunks[0].peekText.length).toBeGreaterThan(10);
    expect(chunks[chunks.length - 1].endCharIdx).toBe(allChars.length - 1);
    expect(chunks[chunks.length - 1].peekText).toBe("");
  });
});
