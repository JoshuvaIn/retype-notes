import { PluginSettings } from "../types";

export interface SessionConfigBarOptions {
  viewMode: "ten-fast-fingers" | "in-note";
  contentStyle: "text" | "ghost" | "exact" | "code";
  timerSeconds: number;
  chunkLines: number;
  settings: PluginSettings;
  onChangeViewMode: (viewMode: "ten-fast-fingers" | "in-note") => void;
  onChangeContentStyle: (style: "text" | "ghost" | "exact" | "code") => void;
  onChangeTimer: (seconds: number) => void;
  onChangeChunkLines?: (chunkLines: number) => void;
  tenLines?: number;
  onChangeTenLines?: (lines: number) => void;
}

export class SessionConfigBar {
  private el: HTMLElement;
  private opts: SessionConfigBarOptions;

  constructor(parentEl: HTMLElement, opts: SessionConfigBarOptions) {
    this.opts = opts;
    this.el = parentEl.createDiv({ cls: "mt-config-bar" });
    this.render();
  }

  private getEnabledContentStyles(): Array<{
    id: "text" | "ghost" | "exact" | "code";
    label: string;
  }> {
    const all: Array<{ id: "text" | "ghost" | "exact" | "code"; label: string }> = [
      { id: "text", label: "text" },
      { id: "exact", label: "exact" },
      { id: "code", label: "code" },
    ];
    const filtered = all.filter(
      (item) => this.opts.settings.enabledContentCards?.[item.id] ?? true
    );
    return filtered.length > 0 ? filtered : all;
  }

  public render() {
    this.el.empty();

    // 1. View Mode Group: 10FastFingers | On Note
    const viewGroup = this.el.createDiv({ cls: "mt-config-group" });
    const views: Array<{ id: "ten-fast-fingers" | "in-note"; label: string }> = [
      { id: "ten-fast-fingers", label: "10fastfingers" },
      { id: "in-note", label: "on note" },
    ];
    views.forEach((v) => {
      const btn = viewGroup.createEl("button", {
        cls: `mt-config-pill ${this.opts.viewMode === v.id ? "is-active" : ""}`,
        text: v.label,
      });
      btn.onclick = (e) => {
        e.stopPropagation();
        if (this.opts.viewMode !== v.id) {
          this.opts.viewMode = v.id;
          this.opts.onChangeViewMode(v.id);
        }
      };
    });

    this.el.createSpan({ cls: "mt-config-divider", text: "|" });

    // 2. Content Style Group: text | ghost | exact | code
    const contentGroup = this.el.createDiv({ cls: "mt-config-group" });
    const styles = this.getEnabledContentStyles();
    styles.forEach((s) => {
      const btn = contentGroup.createEl("button", {
        cls: `mt-config-pill ${this.opts.contentStyle === s.id ? "is-active" : ""}`,
        text: s.label,
      });
      btn.onclick = (e) => {
        e.stopPropagation();
        if (this.opts.contentStyle !== s.id) {
          this.opts.contentStyle = s.id;
          this.render();
          this.opts.onChangeContentStyle(s.id);
        }
      };
    });

    this.el.createSpan({ cls: "mt-config-divider", text: "|" });

    // 3. Timer Group: 30s | 1m | 2m | 5m | ∞ untimed
    const timerGroup = this.el.createDiv({ cls: "mt-config-group" });
    const timers: Array<{ sec: number; label: string }> = [
      { sec: 30, label: "30s" },
      { sec: 60, label: "1m" },
      { sec: 120, label: "2m" },
      { sec: 300, label: "5m" },
      { sec: 0, label: "∞ untimed" },
    ];
    timers.forEach((t) => {
      const btn = timerGroup.createEl("button", {
        cls: `mt-config-pill ${this.opts.timerSeconds === t.sec ? "is-active" : ""}`,
        text: t.label,
      });
      btn.onclick = (e) => {
        e.stopPropagation();
        if (this.opts.timerSeconds !== t.sec) {
          this.opts.timerSeconds = t.sec;
          this.render();
          this.opts.onChangeTimer(t.sec);
        }
      };
    });

    // Live 10FastFingers controls: visible lines and words per session
    if (this.opts.viewMode === "ten-fast-fingers" && this.opts.onChangeTenLines) {
      this.el.createSpan({ cls: "mt-config-divider", text: "|" });
      const linesGroup = this.el.createDiv({ cls: "mt-config-group" });
      [2, 3, 4].forEach((n) => {
        const btn = linesGroup.createEl("button", {
          cls: `mt-config-pill ${this.opts.tenLines === n ? "is-active" : ""}`,
          text: `${n}L`,
          attr: { title: `${n} visible lines` },
        });
        btn.onclick = (e) => {
          e.stopPropagation();
          if (this.opts.tenLines !== n) {
            this.opts.tenLines = n;
            this.render();
            this.opts.onChangeTenLines?.(n);
          }
        };
      });
    }

    // 4. Chunk Lines Group: ONLY shown when in On Note mode AND Chunk Method is enabled in Settings
    if (
      this.opts.viewMode === "in-note" &&
      this.opts.settings.onNoteChunkMode &&
      this.opts.onChangeChunkLines
    ) {
      this.el.createSpan({ cls: "mt-config-divider", text: "|" });
      const chunkGroup = this.el.createDiv({ cls: "mt-config-group" });
      const lineOpts = [5, 6, 7];
      lineOpts.forEach((lines) => {
        const isActive = this.opts.chunkLines === lines;
        const btn = chunkGroup.createEl("button", {
          cls: `mt-config-pill ${isActive ? "is-active" : ""}`,
          text: `${lines}L`,
          attr: { title: `${lines} lines per chunk` },
        });
        btn.onclick = (e) => {
          e.stopPropagation();
          if (this.opts.chunkLines !== lines) {
            this.opts.chunkLines = lines;
            this.render();
            this.opts.onChangeChunkLines?.(lines);
          }
        };
      });
    }
  }

  /**
   * Smoothly hides & locks the configuration bar as soon as the user starts typing.
   */
  public hideOnStart() {
    this.el.addClass("is-hidden");
  }

  /**
   * Restores the configuration bar when the session is reset/restarted.
   */
  public showOnReset() {
    this.el.removeClass("is-hidden");
  }

  public getElement(): HTMLElement {
    return this.el;
  }
}
