export interface WpmRaceBarOptions {
  targetWpm: number;
  bestWpm?: number;
  mode: "speed" | "progress";
  visible: boolean;
  onModeToggle?: (newMode: "speed" | "progress") => void;
}

/**
 * Sleek, continuous, minimal WPM speed & pace rail.
 * Uses a single continuous 3px line with a smooth glowing fill, a subtle target tick,
 * and a clean inline right-hand readout (no floating tags or discontinuous dashes).
 */
export class WpmRaceBar {
  private el: HTMLElement;
  private trackEl!: HTMLElement;
  private fillEl!: HTMLElement;
  private targetDotEl!: HTMLElement;
  private userDotEl!: HTMLElement;
  private bestDotEl?: HTMLElement;
  private modeBadgeEl!: HTMLElement;
  private readoutEl!: HTMLElement;

  private targetWpm: number;
  private bestWpm?: number;
  private mode: "speed" | "progress";
  private maxScaleWpm: number;
  private onModeToggle?: (newMode: "speed" | "progress") => void;

  constructor(parentEl: HTMLElement, opts: WpmRaceBarOptions) {
    this.targetWpm = opts.targetWpm || 40;
    this.bestWpm = opts.bestWpm;
    this.mode = "progress";
    this.onModeToggle = opts.onModeToggle;
    this.maxScaleWpm = Math.max(
      80,
      Math.round(Math.max(this.targetWpm, this.bestWpm || 0) * 1.5)
    );

    this.el = parentEl.createDiv({ cls: "mt-race-bar" });
    if (!opts.visible) {
      this.el.addClass("mt-hidden");
    }
    this.render();
  }

  private render() {
    this.el.empty();

    this.modeBadgeEl = this.el.createSpan({
      cls: "mt-race-mode-label",
      text: "race",
    });

    // Continuous smooth 3px rail
    this.trackEl = this.el.createDiv({ cls: "mt-race-track" });
    this.fillEl = this.trackEl.createDiv({ cls: "mt-race-fill" });

    // Subtle Target Tick / Ring on the continuous rail
    const targetPct = this.getSpeedPercent(this.targetWpm);
    this.targetDotEl = this.trackEl.createDiv({
      cls: "mt-race-dot mt-race-dot-target",
      attr: { title: `Target Pace: ${this.targetWpm} WPM` },
    });
    this.targetDotEl.style.left = `${this.mode === "speed" ? targetPct : 0}%`;

    // Optional Personal Best Tick
    if (this.bestWpm && this.bestWpm > 0) {
      const bestPct = this.getSpeedPercent(this.bestWpm);
      this.bestDotEl = this.trackEl.createDiv({
        cls: "mt-race-dot mt-race-dot-best",
        attr: { title: `Personal Best: ${this.bestWpm} WPM` },
      });
      this.bestDotEl.style.left = `${this.mode === "speed" ? bestPct : 100}%`;
    }

    // Sleek Leading Dot on the continuous fill
    this.userDotEl = this.trackEl.createDiv({
      cls: "mt-race-dot mt-race-dot-user",
    });
    this.userDotEl.setCssProps({ left: "0%" });

    // Clean inline readout at the right end of the rail
    this.readoutEl = this.el.createSpan({
      cls: "mt-race-readout",
      text: `0 / ${this.targetWpm} wpm`,
    });
  }

  private getSpeedPercent(wpm: number): number {
    return Math.min(99, Math.max(1, Math.round((wpm / this.maxScaleWpm) * 100)));
  }

  public update(
    currentWpm: number,
    userProgressFraction: number = 0,
    elapsedSeconds: number = 0,
    totalWords: number = 50
  ) {
    const delta = currentWpm - this.targetWpm;
    const deltaStr =
      currentWpm === 0
        ? `target ${this.targetWpm}`
        : delta >= 0
        ? `+${delta}`
        : `${delta}`;
    this.readoutEl.setText(`${currentWpm} wpm (${deltaStr})`);

    // Dynamic state classes on both fill and leading dot
    const stateClasses = ["is-ahead", "is-closing", "is-pb"];
    this.userDotEl.removeClass(...stateClasses);
    this.fillEl.removeClass(...stateClasses);

    if (this.bestWpm && currentWpm > this.bestWpm) {
      this.userDotEl.addClass("is-pb");
      this.fillEl.addClass("is-pb");
    } else if (currentWpm >= this.targetWpm) {
      this.userDotEl.addClass("is-ahead");
      this.fillEl.addClass("is-ahead");
    } else if (currentWpm >= this.targetWpm * 0.88) {
      this.userDotEl.addClass("is-closing");
      this.fillEl.addClass("is-closing");
    }

    if (this.mode === "speed") {
      const targetPct = this.getSpeedPercent(this.targetWpm);
      const userPct = currentWpm <= 0 ? 0 : this.getSpeedPercent(currentWpm);
      this.targetDotEl.style.left = `${targetPct}%`;
      this.userDotEl.style.left = `${userPct}%`;
      this.fillEl.style.width = `${userPct}%`;
    } else {
      const expectedWordsDone = (elapsedSeconds / 60) * this.targetWpm;
      const ghostFraction = Math.min(1, expectedWordsDone / Math.max(1, totalWords));
      const ghostPct = Math.min(99, Math.max(0, Math.round(ghostFraction * 100)));
      const userPct = Math.min(99, Math.max(0, Math.round(userProgressFraction * 100)));

      this.targetDotEl.style.left = `${ghostPct}%`;
      this.userDotEl.style.left = `${userPct}%`;
      this.fillEl.style.width = `${userPct}%`;
    }
  }

  public getElement(): HTMLElement {
    return this.el;
  }
}
