import { SessionStats } from "../stats";

export class ResultsStrip {
  private el: HTMLElement;
  private onNext: () => void;
  private onRetry: () => void;
  private onWeakWords: () => void;
  private onClose: () => void;

  constructor(
    parentEl: HTMLElement,
    stats: SessionStats,
    callbacks: {
      onNext: () => void;
      onRetry: () => void;
      onWeakWords: () => void;
      onClose: () => void;
    }
  ) {
    this.onNext = callbacks.onNext;
    this.onRetry = callbacks.onRetry;
    this.onWeakWords = callbacks.onWeakWords;
    this.onClose = callbacks.onClose;

    this.el = parentEl.createDiv({ cls: "mt-results-strip" });
    this.render(stats);
  }

  private render(stats: SessionStats) {
    this.el.empty();

    // Stats summary line
    const summaryRow = this.el.createDiv({ cls: "mt-results-row" });
    summaryRow.createSpan({ cls: "mt-stat-main", text: `${stats.wpm} wpm` });
    summaryRow.createSpan({ cls: "mt-stat-badge", text: `${stats.accuracy}% acc` });
    summaryRow.createSpan({ cls: "mt-stat-sub", text: `raw ${stats.rawWpm}` });
    summaryRow.createSpan({ cls: "mt-stat-sub", text: `consistency ${stats.consistency}%` });
    summaryRow.createSpan({
      cls: "mt-stat-sub",
      text: `chars ${stats.charsCorrect}/${stats.charsIncorrect}/${stats.charsExtra}/${stats.charsMissed}`,
    });

    // Trouble words
    if (stats.troubleWords.length > 0) {
      const troubleRow = this.el.createDiv({ cls: "mt-trouble-row" });
      troubleRow.createSpan({ text: "Trouble words: ", cls: "mt-trouble-label" });
      stats.troubleWords.slice(0, 5).forEach((w) => {
        troubleRow.createSpan({ text: w, cls: "mt-trouble-chip" });
      });
    }

    // Actions
    const actionsRow = this.el.createDiv({ cls: "mt-results-actions" });

    const nextBtn = actionsRow.createEl("button", { text: "Next (Tab)", cls: "mod-cta" });
    nextBtn.onclick = () => this.onNext();

    const retryBtn = actionsRow.createEl("button", { text: "Retry (Enter)" });
    retryBtn.onclick = () => this.onRetry();

    if (stats.troubleWords.length > 0) {
      const weakBtn = actionsRow.createEl("button", { text: "Weak Words" });
      weakBtn.onclick = () => this.onWeakWords();
    }

    const closeBtn = actionsRow.createEl("button", { text: "Close (Esc)" });
    closeBtn.onclick = () => this.onClose();
  }

  destroy() {
    this.el.remove();
  }
}
