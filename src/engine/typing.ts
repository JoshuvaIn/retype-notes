import { TypeableChar } from "../render/extract";
import { PluginSettings } from "../types";
import { isCharMatch, isPunctuation } from "./chars";
import { calculateStats, SessionStats, WpmSample } from "../stats";

export type EngineStatus = "idle" | "running" | "paused" | "completed";

export interface EngineEvents {
  onCharUpdate?: (charIndex: number, status: "pending" | "done" | "error" | "missed") => void;
  onCaretMove?: (charIndex: number) => void;
  onBlockChange?: (blockIndex: number) => void;
  onStatusChange?: (status: EngineStatus) => void;
  onStatsUpdate?: (stats: SessionStats) => void;
  onLiveWpm?: (wpm: number, accuracy: number, progressText: string) => void;
}

export class TypingEngine {
  chars: TypeableChar[];
  settings: PluginSettings;
  contentStyle: "text" | "ghost" | "exact" | "code";
  currentIndex: number = 0;
  status: EngineStatus = "idle";

  charsCorrect: number = 0;
  charsIncorrect: number = 0;
  charsExtra: number = 0;
  charsMissed: number = 0;

  startTime: number = 0;
  endTime: number = 0;
  elapsedMs: number = 0;
  lastKeystrokeTime: number = 0;

  troubleWordsMap: Record<string, number> = {};
  currentWordBuffer: string = "";
  currentWordHasError: boolean = false;

  timeline: WpmSample[] = [];
  sampleIntervalId?: any;

  events: EngineEvents = {};

  constructor(
    chars: TypeableChar[],
    settings: PluginSettings,
    events: EngineEvents = {},
    contentStyle: "text" | "ghost" | "exact" | "code" = "text"
  ) {
    this.chars = chars;
    this.settings = settings;
    this.events = events;
    this.contentStyle = contentStyle;
    this.skipGhostForward();
  }

  private skipGhostForward() {
    while (
      this.currentIndex < this.chars.length &&
      this.chars[this.currentIndex].isGhost
    ) {
      this.currentIndex++;
    }
  }

  start() {
    this.status = "running";
    this.startTime = Date.now();
    this.lastKeystrokeTime = this.startTime;
    this.skipGhostForward();
    this.events.onStatusChange?.("running");
    this.events.onCaretMove?.(this.currentIndex);
    this.startTicker();
  }

  private startTicker() {
    if (this.sampleIntervalId) clearInterval(this.sampleIntervalId);
    this.sampleIntervalId = setInterval(() => {
      if (this.status === "running") {
        // Auto-pause if idle timeout exceeded
        const now = Date.now();
        if (
          this.settings.idlePauseSeconds > 0 &&
          now - this.lastKeystrokeTime > this.settings.idlePauseSeconds * 1000
        ) {
          this.pause();
          return;
        }
        this.emitLiveProgress();
      }
    }, 400);
  }

  private emitLiveProgress() {
    const stats = this.getStats();
    const totalWords = Math.max(1, Math.round(this.chars.length / 5));
    const doneWords = Math.min(totalWords, Math.round(this.currentIndex / 5));
    this.events.onLiveWpm?.(
      stats.wpm,
      stats.accuracy,
      `${doneWords} / ${totalWords} words`
    );
  }

  pause() {
    if (this.status !== "running") return;
    this.status = "paused";
    this.elapsedMs += Date.now() - this.startTime;
    this.events.onStatusChange?.("paused");
    if (this.sampleIntervalId) {
      clearInterval(this.sampleIntervalId);
      this.sampleIntervalId = null;
    }
  }

  resume() {
    if (this.status !== "paused") return;
    this.status = "running";
    this.startTime = Date.now();
    this.lastKeystrokeTime = this.startTime;
    this.events.onStatusChange?.("running");
    this.startTicker();
  }

  destroy() {
    if (this.sampleIntervalId) {
      clearInterval(this.sampleIntervalId);
      this.sampleIntervalId = null;
    }
  }

  handleKey(key: string, ctrlKey: boolean = false) {
    // Ignore pure modifier keys
    if (
      key === "Shift" ||
      key === "Control" ||
      key === "Alt" ||
      key === "Meta" ||
      key === "CapsLock"
    ) {
      return;
    }

    if (this.status === "idle") {
      this.start();
    } else if (this.status === "paused") {
      this.resume();
    }

    if (this.status !== "running") return;

    this.lastKeystrokeTime = Date.now();

    // Ctrl+Backspace: clear entire current word
    if (key === "Backspace" && ctrlKey) {
      this.handleWordBackspace();
      this.emitLiveProgress();
      return;
    }

    // Normal Backspace handling
    if (key === "Backspace") {
      this.handleBackspace();
      this.emitLiveProgress();
      return;
    }

    // Space handling (word skip or match space)
    if (key === " ") {
      this.handleSpace();
      this.emitLiveProgress();
      return;
    }

    // Enter handling: treat as space if expected is space
    if (key === "Enter") {
      if (
        this.currentIndex < this.chars.length &&
        this.chars[this.currentIndex].char === " "
      ) {
        this.handleSpace();
        this.emitLiveProgress();
      }
      return;
    }

    // Character handling
    if (key.length === 1 && !ctrlKey) {
      this.handleCharacter(key);
      this.emitLiveProgress();
    }
  }

  private handleCharacter(typedChar: string) {
    this.skipGhostForward();
    if (this.currentIndex >= this.chars.length) return;

    let target = this.chars[this.currentIndex];
    const effectiveCaseSensitive =
      this.contentStyle === "exact" || this.settings.caseSensitive;
    const effectiveRequirePunct =
      this.contentStyle === "exact" ||
      this.contentStyle === "code" ||
      this.settings.requirePunctuation;

    const matches = isCharMatch(typedChar, target.char, {
      lenientSymbols: this.settings.lenientSymbols,
      caseSensitive: effectiveCaseSensitive,
      requirePunctuation: effectiveRequirePunct,
    });

    if (matches) {
      this.charsCorrect++;
      this.currentWordBuffer += target.char;
      this.events.onCharUpdate?.(this.currentIndex, "done");
      this.currentIndex++;
      this.skipGhostForward();
      this.events.onCaretMove?.(this.currentIndex);
      this.checkCompletion();
      return;
    }

    // In words-only mode (!effectiveRequirePunct), if current char(s) are punctuation and user typed the next letter after them, auto-complete punctuation
    if (!effectiveRequirePunct && isPunctuation(target.char)) {
      let lookahead = this.currentIndex;
      while (
        lookahead < this.chars.length &&
        (isPunctuation(this.chars[lookahead].char) || this.chars[lookahead].isGhost)
      ) {
        lookahead++;
      }
      if (
        lookahead < this.chars.length &&
        isCharMatch(typedChar, this.chars[lookahead].char, {
          lenientSymbols: this.settings.lenientSymbols,
          caseSensitive: effectiveCaseSensitive,
        })
      ) {
        while (this.currentIndex < lookahead) {
          if (!this.chars[this.currentIndex].isGhost) {
            this.charsCorrect++;
            this.events.onCharUpdate?.(this.currentIndex, "done");
          }
          this.currentIndex++;
        }
        // Now match the lookahead character
        this.charsCorrect++;
        this.currentWordBuffer += this.chars[this.currentIndex].char;
        this.events.onCharUpdate?.(this.currentIndex, "done");
        this.currentIndex++;
        this.skipGhostForward();
        this.events.onCaretMove?.(this.currentIndex);
        this.checkCompletion();
        return;
      }
    }

    // Mismatch
    this.charsIncorrect++;
    this.currentWordHasError = true;
    this.currentWordBuffer += target.char;
    this.events.onCharUpdate?.(this.currentIndex, "error");

    if (!this.settings.strictMode) {
      this.currentIndex++;
      this.skipGhostForward();
      this.events.onCaretMove?.(this.currentIndex);
    }

    this.checkCompletion();
  }

  private handleSpace() {
    this.skipGhostForward();
    if (this.currentIndex >= this.chars.length) return;

    const effectiveRequirePunct =
      this.contentStyle === "exact" ||
      this.contentStyle === "code" ||
      this.settings.requirePunctuation;

    // In words-only mode, if trailing punctuation precedes the space at the end of a word, auto-complete the punctuation when Space is pressed
    if (!effectiveRequirePunct && isPunctuation(this.chars[this.currentIndex].char)) {
      let lookahead = this.currentIndex;
      while (
        lookahead < this.chars.length &&
        (isPunctuation(this.chars[lookahead].char) || this.chars[lookahead].isGhost)
      ) {
        lookahead++;
      }
      if (lookahead >= this.chars.length || this.chars[lookahead].char === " ") {
        while (this.currentIndex < lookahead) {
          if (!this.chars[this.currentIndex].isGhost) {
            this.charsCorrect++;
            this.events.onCharUpdate?.(this.currentIndex, "done");
          }
          this.currentIndex++;
        }
        if (this.currentIndex >= this.chars.length) {
          this.flushWord();
          this.complete();
          return;
        }
      }
    }

    const target = this.chars[this.currentIndex];

    // If expected is space, normal match
    if (target.char === " ") {
      this.charsCorrect++;
      this.flushWord();
      this.events.onCharUpdate?.(this.currentIndex, "done");
      this.currentIndex++;
      this.skipGhostForward();
      this.events.onCaretMove?.(this.currentIndex);
      this.checkCompletion();
      return;
    }

    // Ignore accidental double-space right at the start of a new word
    if (this.currentIndex > 0 && this.chars[this.currentIndex - 1].char === " ") {
      return;
    }

    // If flow mode and we typed space in middle of word -> skip rest of word & mark missed
    if (!this.settings.strictMode) {
      while (
        this.currentIndex < this.chars.length &&
        this.chars[this.currentIndex].char !== " "
      ) {
        if (!this.chars[this.currentIndex].isGhost) {
          this.charsMissed++;
          this.events.onCharUpdate?.(this.currentIndex, "missed");
        }
        this.currentIndex++;
      }
      this.currentWordHasError = true;
      this.flushWord();

      // Mark the space itself done and advance to start of next word
      if (
        this.currentIndex < this.chars.length &&
        this.chars[this.currentIndex].char === " "
      ) {
        this.events.onCharUpdate?.(this.currentIndex, "done");
        this.currentIndex++;
      }
      this.skipGhostForward();
      this.events.onCaretMove?.(this.currentIndex);
      this.checkCompletion();
    }
  }

  private handleWordBackspace() {
    // First clear any error state on the current character (e.g. in strict mode)
    if (
      this.currentIndex < this.chars.length &&
      !this.chars[this.currentIndex].isGhost
    ) {
      this.events.onCharUpdate?.(this.currentIndex, "pending");
    }

    if (this.currentIndex <= 0) {
      this.currentWordBuffer = "";
      this.currentWordHasError = false;
      this.events.onCaretMove?.(this.currentIndex);
      return;
    }

    // Step back past any ghost or space characters immediately preceding the caret
    while (
      this.currentIndex > 0 &&
      (this.chars[this.currentIndex - 1].isGhost ||
        this.chars[this.currentIndex - 1].char === " ")
    ) {
      this.currentIndex--;
      if (!this.chars[this.currentIndex].isGhost) {
        this.events.onCharUpdate?.(this.currentIndex, "pending");
      }
    }

    // Step back to the beginning of the word (until preceding space or start)
    while (
      this.currentIndex > 0 &&
      this.chars[this.currentIndex - 1].char !== " "
    ) {
      this.currentIndex--;
      if (!this.chars[this.currentIndex].isGhost) {
        this.events.onCharUpdate?.(this.currentIndex, "pending");
      }
    }

    this.skipGhostForward();
    this.currentWordBuffer = "";
    this.currentWordHasError = false;
    this.events.onCaretMove?.(this.currentIndex);
  }

  private handleBackspace() {
    if (this.currentIndex <= 0) return;

    // In strict mode, if current character is in error state, clear error on current char first
    if (
      this.settings.strictMode &&
      this.currentIndex < this.chars.length &&
      this.chars[this.currentIndex].spanRef?.classList.contains("mt-error")
    ) {
      this.events.onCharUpdate?.(this.currentIndex, "pending");
      return;
    }

    this.currentIndex--;
    while (this.currentIndex > 0 && this.chars[this.currentIndex].isGhost) {
      this.currentIndex--;
    }

    this.events.onCharUpdate?.(this.currentIndex, "pending");
    this.currentWordBuffer = this.currentWordBuffer.slice(0, -1);
    this.events.onCaretMove?.(this.currentIndex);
  }

  private flushWord() {
    const trimmed = this.currentWordBuffer.trim();
    if (trimmed && this.currentWordHasError) {
      this.troubleWordsMap[trimmed] = (this.troubleWordsMap[trimmed] || 0) + 1;
    }
    this.currentWordBuffer = "";
    this.currentWordHasError = false;
  }

  private checkCompletion() {
    if (this.currentIndex >= this.chars.length) {
      this.flushWord();
      this.complete();
    }
  }

  complete() {
    this.status = "completed";
    this.endTime = Date.now();
    this.elapsedMs += this.endTime - this.startTime;
    if (this.sampleIntervalId) {
      clearInterval(this.sampleIntervalId);
      this.sampleIntervalId = null;
    }
    this.emitLiveProgress();
    this.events.onStatusChange?.("completed");

    const finalStats = this.getStats();
    this.events.onStatsUpdate?.(finalStats);
  }

  getStats(): SessionStats {
    const totalTime =
      this.status === "running"
        ? this.elapsedMs + (Date.now() - this.startTime)
        : this.elapsedMs;

    return calculateStats({
      charsCorrect: this.charsCorrect,
      charsIncorrect: this.charsIncorrect,
      charsExtra: this.charsExtra,
      charsMissed: this.charsMissed,
      durationMs: totalTime,
      troubleWordsMap: this.troubleWordsMap,
      timeline: this.timeline,
    });
  }
}
