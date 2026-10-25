import { describe, it, expect, beforeEach } from "vitest";
import { TenFastFingersSession } from "../src/ui/tenFastFingers";
import { DEFAULT_SETTINGS } from "../src/types";

// Polyfill Obsidian's HTMLElement helper methods for jsdom unit tests
function polyfillObsidianDom() {
  const proto = HTMLElement.prototype as any;
  if (!proto.empty) {
    proto.empty = function () {
      this.innerHTML = "";
    };
  }
  if (!proto.addClass) {
    proto.addClass = function (...classes: string[]) {
      classes.forEach((c) => {
        if (c) this.classList.add(...c.split(/\s+/).filter(Boolean));
      });
    };
  }
  if (!proto.removeClass) {
    proto.removeClass = function (...classes: string[]) {
      classes.forEach((c) => {
        if (c) this.classList.remove(...c.split(/\s+/).filter(Boolean));
      });
    };
  }
  if (!proto.toggleClass) {
    proto.toggleClass = function (cls: string, state?: boolean) {
      this.classList.toggle(cls, state);
    };
  }
  if (!proto.setText) {
    proto.setText = function (text: string) {
      this.textContent = text;
    };
  }
  if (!proto.createEl) {
    proto.createEl = function (tag: string, opts?: any) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.type) (el as any).type = opts.type;
      if (opts?.attr) {
        for (const [k, v] of Object.entries(opts.attr)) {
          el.setAttribute(k, String(v));
        }
      }
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createDiv) {
    proto.createDiv = function (opts?: any) {
      return this.createEl("div", opts);
    };
  }
  if (!proto.createSpan) {
    proto.createSpan = function (opts?: any) {
      return this.createEl("span", opts);
    };
  }
}

describe("TenFastFingersSession UI & Word Mechanics", () => {
  beforeEach(() => {
    polyfillObsidianDom();
  });

  it("renders 2-line word box, input box, countdown timer, and marks words green/red on submission", () => {
    const host = document.createElement("div");
    const words = ["Every", "power", "system", "will", "sooner", "or", "later"];

    const session = new TenFastFingersSession(
      host,
      "Relay Basics",
      words,
      "text",
      DEFAULT_SETTINGS,
      {
        onRestart: () => {},
        onChangeMode: () => {},
        onExit: () => {},
        onNextRandom: () => {},
        onWeakWords: () => {},
      }
    );

    const wordSpans = host.querySelectorAll(".mt-10ff-word");
    expect(wordSpans.length).toBe(7);
    expect(wordSpans[0].classList.contains("mt-10ff-active")).toBe(true);

    // Top configuration bar is initially visible before typing starts
    const configBar = host.querySelector(".mt-config-bar");
    expect(configBar).not.toBeNull();
    expect(configBar?.classList.contains("is-hidden")).toBe(false);

    // TypeRacer WPM racing track is rendered with target dot and user dot
    expect(host.querySelector(".mt-race-bar")).not.toBeNull();
    expect(host.querySelector(".mt-race-dot-target")).not.toBeNull();
    expect(host.querySelector(".mt-race-dot-user")).not.toBeNull();

    // 1. Submit first word correctly ("Every") -> config bar auto-hides!
    session.submitCurrentWord("Every");
    expect(configBar?.classList.contains("is-hidden")).toBe(true);
    expect(wordSpans[0].classList.contains("mt-10ff-correct")).toBe(true);
    expect(wordSpans[1].classList.contains("mt-10ff-active")).toBe(true);

    // 2. Submit second word wrongly ("powerr")
    session.submitCurrentWord("powerr");
    expect(wordSpans[1].classList.contains("mt-10ff-wrong")).toBe(true);
    expect(wordSpans[2].classList.contains("mt-10ff-active")).toBe(true);

    // 3. Mistype prefix of 3rd word ("system" -> "syz") and verify active-error red highlight
    const inputEl = host.querySelector(".mt-10ff-input") as HTMLInputElement;
    inputEl.value = "syz";
    inputEl.dispatchEvent(new Event("input"));
    expect(wordSpans[2].classList.contains("mt-10ff-active-error")).toBe(true);

    // Fix input prefix to "sys" -> error highlight clears
    inputEl.value = "sys";
    inputEl.dispatchEvent(new Event("input"));
    expect(wordSpans[2].classList.contains("mt-10ff-active-error")).toBe(false);

    session.destroy();
  });
});
