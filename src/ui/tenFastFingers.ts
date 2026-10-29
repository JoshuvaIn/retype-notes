import { Platform } from "obsidian";
import { PluginSettings } from "../types";
import { normalizeChar } from "../engine/chars";
import { calculateStats, SessionStats } from "../stats";
import { ResultsStrip } from "./resultsStrip";
import { SessionConfigBar } from "./sessionConfigBar";
import { WpmRaceBar } from "./wpmRaceBar";

export interface TenFastFingersCallbacks {
  onRestart: () => void;
  onExit: () => void;
  onNextRandom: () => void;
  onWeakWords: (troubleWords: string[]) => void;
  onTypingStarted?: () => void;
  onSessionStoppedOrCompleted?: () => void;
  onSwitchViewMode?: (newView: "ten-fast-fingers" | "in-note") => void | Promise<void>;
  onSwitchContentStyle?: (newStyle: "text" | "ghost" | "exact" | "code") => void | Promise<void>;
  onChangeTimerSetting?: (seconds: number) => void | Promise<void>;
  onSettingsChanged?: () => void;
}

export class TenFastFingersSession {
  private hostEl: HTMLElement;
  private allWords: string[];
  private words: string[];
  private settings: PluginSettings;
  private contentStyle: "text" | "ghost" | "exact" | "code";
  private noteTitle: string;
  private bestWpm?: number;
  private callbacks: TenFastFingersCallbacks;

  private currentWordIndex: number = 0;
  private wordSpans: HTMLElement[] = [];
  private wordInnerEl!: HTMLElement;
  private wordBoxEl?: HTMLElement;
  private inputEl!: HTMLInputElement;
  private timerBadgeEl!: HTMLElement;
  private wpmEl!: HTMLElement;
  private progressFillEl!: HTMLElement;
  private accEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private configBar!: SessionConfigBar;
  private raceBar!: WpmRaceBar;

  private status: "idle" | "running" | "completed" = "idle";
  private startTime: number = 0;
  private durationLimitSeconds: number = 60;
  private remainingSeconds: number = 60;
  private timerIntervalId?: number | null;

  private correctWordsCount: number = 0;
  private wrongWordsCount: number = 0;
  private charsCorrect: number = 0;
  private charsIncorrect: number = 0;
  private troubleWordsMap: Record<string, number> = {};

  constructor(
    hostEl: HTMLElement,
    noteTitle: string,
    words: string[],
    contentStyle: "text" | "ghost" | "exact" | "code",
    settings: PluginSettings,
    callbacks: TenFastFingersCallbacks,
    bestWpm?: number
  ) {
    this.hostEl = hostEl;
    this.noteTitle = noteTitle;
    this.allWords = words;
    this.words = this.applyWordLimit(words, settings.tenFastWordLimit);
    this.contentStyle = contentStyle;
    this.settings = settings;
    this.callbacks = callbacks;
    this.bestWpm = bestWpm;

    this.durationLimitSeconds =
      settings.sessionTimerSeconds ?? settings.tenFastFingersDurationSeconds ?? 60;
    this.remainingSeconds = this.durationLimitSeconds;

    this.render();
  }

  private applyWordLimit(words: string[], limit: number): string[] {
    return limit > 0 && words.length > limit ? words.slice(0, limit) : words;
  }

  private pickGreeting(): string {
    const greetings = [
      "Start typing here…",
      "Welcome, let us type…",
      "Ready when you are…",
      "Take a breath, then begin…",
      "Let the words flow…",
      "Hello again, start typing…",
      "Slow is smooth, smooth is fast…",
      "Type the first word to begin…",
      "A fresh page, let us go…",
      "Settle in and start typing…",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  private render() {
    this.hostEl.empty();

    const overlay = this.hostEl.createDiv({
      cls: "mt-overlay mt-overlay-tab mt-10ff-container",
    });
    this.overlayEl = overlay;

    // 1. Monkeytype-Style Visual Configuration Bar (auto-hides when typing starts)
    this.configBar = new SessionConfigBar(overlay, {
      viewMode: "ten-fast-fingers",
      contentStyle: this.contentStyle,
      timerSeconds: this.durationLimitSeconds,
      chunkLines: this.settings.onNoteChunkLines,
      tenLines: this.settings.tenFastLines ?? 3,
      onChangeTenLines: (lines) => {
        this.settings.tenFastLines = lines;
        this.callbacks.onSettingsChanged?.();
        this.wordBoxEl?.style.setProperty("--mt-10ff-lines", String(lines));
        this.resetSession();
      },
      settings: this.settings,
      onChangeViewMode: (newView) => {
        void this.callbacks.onSwitchViewMode?.(newView);
      },
      onChangeContentStyle: (newStyle) => {
        this.contentStyle = newStyle;
        void this.callbacks.onSwitchContentStyle?.(newStyle);
      },
      onChangeTimer: (seconds) => {
        this.durationLimitSeconds = seconds;
        this.remainingSeconds = seconds;
        this.timerBadgeEl.setText(this.formatTimer(this.remainingSeconds));
        void this.callbacks.onChangeTimerSetting?.(seconds);
        this.inputEl.focus();
      },
    });

    // 2. Top Header Strip
    const headerStrip = overlay.createDiv({ cls: "mt-header-strip" });
    const leftGroup = headerStrip.createDiv({ cls: "mt-header-left" });
    leftGroup.createSpan({
      cls: "mt-header-title",
      text: this.noteTitle,
    });
    leftGroup.createSpan({
      cls: "mt-header-badge",
      text: `10FASTFINGERS · ${this.contentStyle.toUpperCase()}`,
    });

    const centerStats = headerStrip.createDiv({ cls: "mt-header-live-stats" });
    this.timerBadgeEl = centerStats.createSpan({
      cls: "mt-live-timer-pill",
      text: this.formatTimer(this.remainingSeconds),
      attr: { title: "Remaining session time" },
    });
    this.wpmEl = centerStats.createSpan({
      cls: "mt-live-wpm",
      text: "0 WPM",
    });
    this.accEl = centerStats.createSpan({
      cls: "mt-live-acc",
      text: "100% acc",
    });
    this.progressEl = centerStats.createSpan({
      cls: "mt-live-progress",
      text: `0 / ${this.words.length} words · 0%`,
    });

    if (!this.settings.liveWpm) {
      this.wpmEl.addClass("mt-hidden");
      this.accEl.addClass("mt-hidden");
    }

    const progressLine = headerStrip.createDiv({ cls: "mt-10ff-progress-line" });
    this.progressFillEl = progressLine.createDiv({ cls: "mt-10ff-progress-fill" });

    const rightActions = headerStrip.createDiv({ cls: "mt-header-actions" });
    const restartTopBtn = rightActions.createEl("button", {
      text: "Restart",
      cls: "mt-header-btn",
    });
    restartTopBtn.onclick = () => this.resetSession();

    const exitBtn = rightActions.createEl("button", {
      text: "Exit (Esc)",
      cls: "mt-header-btn",
    });
    exitBtn.onclick = () => this.callbacks.onExit();

    // 3. Sleek Continuous WPM Rail
    this.raceBar = new WpmRaceBar(overlay, {
      targetWpm: this.settings.targetWpm || 40,
      bestWpm: this.bestWpm,
      mode: "progress",
      visible: this.settings.showWpmRaceTrack ?? true,
    });

    // 4. Classic 10FastFingers Stage
    const stage = overlay.createDiv({ cls: "mt-10ff-stage" });

    // 2-Line Word Box
    const wordBox = stage.createDiv({ cls: "mt-10ff-word-box" });
    this.wordBoxEl = wordBox;
    wordBox.style.setProperty("--mt-10ff-lines", String(this.settings.tenFastLines ?? 3));
    this.wordInnerEl = wordBox.createDiv({ cls: "mt-10ff-word-inner" });

    this.wordSpans = this.words.map((word, idx) => {
      const span = this.wordInnerEl.createSpan({
        cls: `mt-10ff-word ${idx === 0 ? "mt-10ff-active" : ""}`,
        text: word,
      });
      return span;
    });

    // Control Bar below the word box (Input + Quick Restart Button)
    const controlBar = stage.createDiv({ cls: "mt-10ff-control-bar" });

    this.inputEl = controlBar.createEl("input", {
      type: "text",
      cls: "mt-10ff-input",
      attr: {
        placeholder: this.pickGreeting(),
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
      },
    });

    const restartBtn = controlBar.createEl("button", {
      cls: "mt-10ff-restart-btn",
      text: "↻",
      attr: { title: "Restart (Alt+R)" },
    });
    restartBtn.onclick = () => {
      this.resetSession();
    };

    stage.createDiv({
      cls: "mt-10ff-hint",
      text: Platform.isMobile
        ? "Type the highlighted word, then press space"
        : "Press Space, Shift, or Enter to jump to the next word · Ctrl+Backspace clears word · Esc shows results, Esc again exits",
    });

    this.bindEvents();
    window.setTimeout(() => this.inputEl?.focus(), 50);
  }

  private formatTimer(seconds: number): string {
    if (this.durationLimitSeconds === 0 && this.status === "idle") {
      return "∞";
    }
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  private bindEvents() {
    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // Esc mid-session shows the WPM results; Esc again exits.
        if (this.status === "running") {
          this.completeSession();
        } else {
          this.callbacks.onExit();
        }
        return;
      }

      if (this.status === "completed") {
        e.preventDefault();
        return;
      }

      // Word submission keys: Space, Enter, or Shift (when input has characters)
      if (e.key === " " || e.key === "Enter" || e.key === "Shift") {
        const currentVal = this.inputEl.value.trim();
        if (currentVal.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          this.submitCurrentWord(currentVal);
        } else if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // Start session timer & hide config bar on first printable keystroke
      if (this.status === "idle" && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        this.startTimer();
      }
    });

    this.inputEl.addEventListener("input", () => {
      if (this.status === "completed") return;
      if (this.status === "idle" && this.inputEl.value.length > 0) {
        this.startTimer();
      }
      // Mobile virtual keyboards often send no usable keydown for Space: submit on a trailing space.
      if (this.inputEl.value.length > 1 && /s$/.test(this.inputEl.value)) {
        const word = this.inputEl.value.trim();
        if (word) {
          this.submitCurrentWord(word);
          return;
        }
      }
      this.updateActiveWordHighlight();
    });
  }

  private startTimer() {
    this.inputEl.placeholder = "";
    if (this.status !== "idle") return;
    this.status = "running";
    this.startTime = Date.now();
    this.configBar.hideOnStart();
    this.callbacks.onTypingStarted?.();
    this.inputEl.focus();

    if (this.timerIntervalId) window.clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => {
      if (this.status !== "running") return;
      const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);

      if (this.durationLimitSeconds > 0) {
        this.remainingSeconds = Math.max(0, this.durationLimitSeconds - elapsedSec);
        this.timerBadgeEl.setText(this.formatTimer(this.remainingSeconds));
        this.emitLiveMetrics();
        if (this.remainingSeconds <= 0) {
          this.completeSession();
        }
      } else {
        this.remainingSeconds = elapsedSec;
        this.timerBadgeEl.setText(this.formatTimer(this.remainingSeconds));
        this.emitLiveMetrics();
      }
    }, 250);
  }

  private normalizeWord(w: string): string {
    const effectiveCaseSensitive =
      this.contentStyle === "exact" || this.settings.caseSensitive;
    let out = "";
    for (const ch of w) {
      let c = this.settings.lenientSymbols ? normalizeChar(ch) : ch;
      if (!effectiveCaseSensitive) {
        c = c.toLowerCase();
      }
      out += c;
    }
    return out;
  }

  private lastValidInput = "";

  /** Strict mode: reject a wrong character and flash the word instead of letting it through. */
  private flashStrictError() {
    const span = this.wordSpans[this.currentWordIndex];
    if (!span) return;
    span.addClass("mt-10ff-active-error");
    window.setTimeout(() => span.removeClass("mt-10ff-active-error"), 220);
  }

  private updateActiveWordHighlight() {
    const activeSpan = this.wordSpans[this.currentWordIndex];
    if (!activeSpan) return;

    const targetWord = this.words[this.currentWordIndex] || "";
    const typed = this.inputEl.value;

    const normTarget = this.normalizeWord(targetWord);
    const normTyped = this.normalizeWord(typed);

    const isPrefixMatch = normTarget.startsWith(normTyped);
    if (this.settings.strictMode && !isPrefixMatch) {
      this.inputEl.value = this.lastValidInput;
      this.charsIncorrect++;
      this.flashStrictError();
      return;
    }
    this.lastValidInput = typed;
    activeSpan.toggleClass("mt-10ff-active-error", !isPrefixMatch);
  }

  public submitCurrentWord(typedValue?: string) {
    if (this.status === "completed") return;
    if (this.status === "idle") {
      this.startTimer();
    }

    const typed = (typedValue ?? this.inputEl.value).trim();
    if (!typed) return;

    const targetWord = this.words[this.currentWordIndex] || "";
    const isExactMatch = this.normalizeWord(typed) === this.normalizeWord(targetWord);

    if (this.settings.strictMode && !isExactMatch) {
      this.flashStrictError();
      return;
    }

    const activeSpan = this.wordSpans[this.currentWordIndex];
    if (activeSpan) {
      activeSpan.removeClass("mt-10ff-active", "mt-10ff-active-error");
      activeSpan.addClass(isExactMatch ? "mt-10ff-correct" : "mt-10ff-wrong");
    }

    if (isExactMatch) {
      this.correctWordsCount++;
      this.charsCorrect += targetWord.length + 1;
    } else {
      this.wrongWordsCount++;
      this.charsIncorrect += targetWord.length + 1;
      const cleanTrouble = targetWord.replace(/[.,;:!?()[\]{}"']/g, "") || targetWord;
      this.troubleWordsMap[cleanTrouble] = (this.troubleWordsMap[cleanTrouble] || 0) + 1;
    }

    this.inputEl.value = "";
    this.lastValidInput = "";
    this.currentWordIndex++;

    if (this.currentWordIndex >= this.words.length) {
      this.emitLiveMetrics();
      this.completeSession();
      return;
    }

    const nextSpan = this.wordSpans[this.currentWordIndex];
    if (nextSpan) {
      nextSpan.addClass("mt-10ff-active");
      this.scrollWordLineIntoView(nextSpan);
    }

    this.emitLiveMetrics();
  }

  private scrollWordLineIntoView(activeSpan: HTMLElement) {
    const firstSpan = this.wordSpans[0];
    if (!firstSpan) return;
    const baseTop = firstSpan.offsetTop;
    const currentTop = activeSpan.offsetTop - baseTop;
    this.wordInnerEl.style.transform = `translateY(-${currentTop}px)`;
  }

  private emitLiveMetrics() {
    const stats = this.getStats();
    this.wpmEl.setText(`${stats.wpm} WPM`);
    this.accEl.setText(`${stats.accuracy}% acc`);
    const pct = Math.round((this.currentWordIndex / Math.max(1, this.words.length)) * 100);
    this.progressEl.setText(`${this.currentWordIndex} / ${this.words.length} words · ${pct}%`);
    this.progressFillEl.style.width = `${pct}%`;

    const elapsedSec =
      this.status === "idle" ? 0 : (Date.now() - this.startTime) / 1000;
    const progressFraction = this.currentWordIndex / Math.max(1, this.words.length);
    this.raceBar.update(stats.wpm, progressFraction, elapsedSec, this.words.length);
  }

  public getStats(): SessionStats {
    const elapsedMs =
      this.status === "idle" ? 0 : Date.now() - this.startTime;

    return calculateStats({
      charsCorrect: this.charsCorrect,
      charsIncorrect: this.charsIncorrect,
      charsExtra: 0,
      charsMissed: 0,
      durationMs: elapsedMs,
      troubleWordsMap: this.troubleWordsMap,
      timeline: [],
    });
  }

  private completeSession() {
    if (this.status === "completed") return;
    this.status = "completed";
    if (this.timerIntervalId) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }

    this.callbacks.onSessionStoppedOrCompleted?.();
    this.configBar?.showOnReset();

    this.inputEl.disabled = true;
    this.inputEl.placeholder = "Session finished!";

    const stats = this.getStats();
    new ResultsStrip(this.overlayEl, stats, {
      onNext: () => this.callbacks.onNextRandom(),
      onRetry: () => this.resetSession(),
      onWeakWords: () => this.callbacks.onWeakWords(stats.troubleWords),
      onClose: () => this.callbacks.onExit(),
    });
  }

  public resetSession() {
    if (this.timerIntervalId) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    this.callbacks.onSessionStoppedOrCompleted?.();
    this.currentWordIndex = 0;
    this.lastValidInput = "";
    this.status = "idle";
    this.remainingSeconds = this.durationLimitSeconds;
    this.correctWordsCount = 0;
    this.wrongWordsCount = 0;
    this.charsCorrect = 0;
    this.charsIncorrect = 0;
    this.troubleWordsMap = {};
    this.render();
  }

  public destroy() {
    if (this.timerIntervalId) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    this.overlayEl?.remove();
  }
}
