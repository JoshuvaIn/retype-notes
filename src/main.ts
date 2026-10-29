import {
  Plugin,
  TFile,
  TFolder,
  MarkdownView,
  MarkdownRenderer,
  Component,
  Notice,
  WorkspaceLeaf,
  Platform,
} from "obsidian";
import { DEFAULT_DATA, PluginData, StyleChoice } from "./types";
import { MonkeyTypingSettingTab } from "./settings";
import {
  extractTypeableChars,
  extractWordsFromChars,
  buildSmartChunks,
  TextChunk,
} from "./render/extract";
import { TypingEngine } from "./engine/typing";
import { ResultsStrip } from "./ui/resultsStrip";
import {
  MonkeyTypingPreviewView,
  VIEW_TYPE_MONKEY_PREVIEW,
} from "./ui/previewView";
import { TenFastFingersSession } from "./ui/tenFastFingers";
import { SessionConfigBar } from "./ui/sessionConfigBar";
import { WpmRaceBar } from "./ui/wpmRaceBar";
import { FocusMode } from "./ui/focusMode";
import { OutlineIntegrationManager } from "./ui/outlineIntegration";

export default class RetypeNotesPlugin extends Plugin {
  data: PluginData = DEFAULT_DATA;
  activeEngine?: TypingEngine;
  activeTenFastSession?: TenFastFingersSession;
  activeOverlayEl?: HTMLElement;
  activeRenderComp?: Component;
  activeOnNoteTimerId?: number;
  activeGhostTimerId?: number;
  lastActiveFile?: TFile;
  focusMode!: FocusMode;
  outlineIntegration!: OutlineIntegrationManager;

  async onload() {
    await this.loadPluginData();
    this.focusMode = new FocusMode(this.app);
    this.outlineIntegration = new OutlineIntegrationManager(this);
    this.outlineIntegration.bindOutlineLeaves();

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.outlineIntegration.bindOutlineLeaves();
      })
    );

    // Register settings tab
    this.addSettingTab(new MonkeyTypingSettingTab(this.app, this));

    // Register dedicated 10FastFingers typing view
    this.registerView(
      VIEW_TYPE_MONKEY_PREVIEW,
      (leaf: WorkspaceLeaf) => new MonkeyTypingPreviewView(leaf)
    );

    // Track last active markdown file so sidebar actions always know which note to use
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          this.lastActiveFile = file;
        }
      })
    );

    const initialFile = this.app.workspace.getActiveFile();
    if (initialFile && initialFile.extension === "md") {
      this.lastActiveFile = initialFile;
    }

    // Register context menu items
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addSeparator();
          menu.addItem((item) => {
            item
              .setTitle("Retype: whole note")
              .setIcon("keyboard")
              .onClick(() => void this.startTypingSession(file, "whole"));
          });
        } else if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle("Retype: random paragraph from here")
              .setIcon("dice")
              .onClick(() => void this.startRandomSession(file));
          });
        }
      })
    );

    // Register commands
    this.addCommand({
      id: "retype-active-note",
      name: "Type active note",
      callback: () => {
        const file = this.getTargetMarkdownFile();
        if (file) {
          void this.startTypingSession(file, "whole");
        } else {
          new Notice("Open a markdown note first.");
        }
      },
    });

    this.addCommand({
      id: "retype-random-paragraph",
      name: "Random paragraph",
      callback: () => {
        const folderPath = this.data.settings.defaultRandomFolder;
        const folder = folderPath
          ? this.app.vault.getAbstractFileByPath(folderPath)
          : this.app.vault.getRoot();
        if (folder instanceof TFolder) {
          void this.startRandomSession(folder);
        } else {
          void this.startRandomSession(this.app.vault.getRoot());
        }
      },
    });

    this.addCommand({
      id: "retype-exit-session",
      name: "Exit active session",
      callback: () => this.stopActiveSession(true),
    });
  }

  onunload() {
    this.outlineIntegration?.destroy();
    this.stopActiveSession(true);
  }

  async loadPluginData() {
    const loaded = (await this.loadData()) as Partial<PluginData> | null;
    this.data = Object.assign({}, DEFAULT_DATA, loaded || {});
    this.data.settings = Object.assign(
      {},
      DEFAULT_DATA.settings,
      loaded?.settings || {}
    );
    if ((this.data.settings.typingViewMode as string) === "preview-tab") {
      this.data.settings.typingViewMode = "ten-fast-fingers";
    }
    this.data.settings.enabledContentCards = Object.assign(
      {},
      DEFAULT_DATA.settings.enabledContentCards,
      loaded?.settings?.enabledContentCards || {}
    );
    // Ghost content style and the Speed Gauge race mode were removed.
    this.data.settings.enabledContentCards.ghost = false;
    if (this.data.settings.defaultContentStyle === "ghost") {
      this.data.settings.defaultContentStyle = "text";
    }
    this.data.settings.wpmRaceMode = "progress";
  }

  async savePluginData() {
    await this.saveData(this.data);
  }

  private getTargetMarkdownFile(): TFile | null {
    const active = this.app.workspace.getActiveFile();
    if (active && active.extension === "md") return active;
    if (this.lastActiveFile) return this.lastActiveFile;
    const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of mdLeaves) {
      const v = leaf.view as MarkdownView;
      if (v?.file) return v.file;
    }
    return null;
  }

  private getBestWpmForFile(file: TFile): number | undefined {
    const noteData = this.data.notes?.[file.path];
    if (!noteData || !noteData.runs || noteData.runs.length === 0) return undefined;
    return Math.max(...noteData.runs.map((r) => r.wpm));
  }

  private enterFocusModeIfEnabled() {
    this.focusMode?.enter({
      enabled: this.data.settings.autoToggleSidebars ?? true,
      left: this.data.settings.autoToggleLeft ?? true,
      right: this.data.settings.autoToggleRight ?? true,
    });
  }

  private exitFocusMode() {
    this.focusMode?.exit();
  }

  public stopActiveSession(closePreviewLeaf: boolean = false) {
    this.exitFocusMode();
    if (this.activeGhostTimerId) {
      window.clearInterval(this.activeGhostTimerId);
      this.activeGhostTimerId = undefined;
    }
    if (this.activeOnNoteTimerId) {
      window.clearInterval(this.activeOnNoteTimerId);
      this.activeOnNoteTimerId = undefined;
    }
    if (this.activeEngine) {
      this.activeEngine.destroy();
      this.activeEngine = undefined;
    }
    if (this.activeTenFastSession) {
      this.activeTenFastSession.destroy();
      this.activeTenFastSession = undefined;
    }
    if (this.activeRenderComp) {
      this.activeRenderComp.unload();
      this.activeRenderComp = undefined;
    }
    if (this.activeOverlayEl) {
      this.activeOverlayEl.remove();
      this.activeOverlayEl = undefined;
    }
    if (closePreviewLeaf) {
      const leaves = this.app.workspace.getLeavesOfType(
        VIEW_TYPE_MONKEY_PREVIEW
      );
      leaves.forEach((l) => l.detach());
    }
  }

  async startRandomSession(folder: TFolder) {
    const mdFiles: TFile[] = [];
    const excluded = new Set(this.data.settings.excludeFolders || []);
    const collectFiles = (f: TFolder) => {
      if (excluded.has(f.name) && f !== folder) return;
      for (const child of f.children) {
        if (child instanceof TFile && child.extension === "md") {
          mdFiles.push(child);
        } else if (
          child instanceof TFolder &&
          this.data.settings.includeSubfolders
        ) {
          collectFiles(child);
        }
      }
    };
    collectFiles(folder);

    if (mdFiles.length === 0) {
      new Notice(`No markdown files found in folder "${folder.path || "/"}"`);
      return;
    }

    const randomFile = mdFiles[Math.floor(Math.random() * mdFiles.length)];
    void this.startTypingSession(randomFile, "random");
  }

  /**
   * Launches the typing session directly using the saved view & content style
   * (no modal popup — all mode & timer controls live right in the top bar of the typing window).
   */
  async startTypingSession(
    file: TFile,
    mode: "whole" | "section" | "random",
    targetHeadingPaths?: string[]
  ) {
    this.stopActiveSession(false);
    this.lastActiveFile = file;

    const defaultChoice: StyleChoice = {
      contentStyle: this.data.settings.defaultContentStyle || "text",
      typingViewMode: this.data.settings.typingViewMode || "ten-fast-fingers",
    };
    await this.launchWithChoice(file, mode, defaultChoice, targetHeadingPaths);
  }

  public async launchWithChoice(
    file: TFile,
    mode: "whole" | "section" | "random",
    choice: StyleChoice,
    targetHeadingPaths?: string[]
  ) {
    const viewMode =
      choice.typingViewMode ||
      this.data.settings.typingViewMode ||
      "ten-fast-fingers";

    if (viewMode === "ten-fast-fingers") {
      const existingLeaves = this.app.workspace.getLeavesOfType(
        VIEW_TYPE_MONKEY_PREVIEW
      );
      let leaf: WorkspaceLeaf;
      if (existingLeaves.length > 0) {
        leaf = existingLeaves[0];
      } else {
        leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: VIEW_TYPE_MONKEY_PREVIEW,
          active: true,
        });
      }
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      const previewView = leaf.view as MonkeyTypingPreviewView;
      previewView.setSessionTitle(
        file,
        `10FastFingers · ${choice.contentStyle.toUpperCase()}`,
        () => this.stopActiveSession(false)
      );
      const hostEl = previewView.getMountContainer();
      await this.mountTenFastFingersAndRun(
        file,
        hostEl,
        mode,
        choice,
        targetHeadingPaths
      );
    } else {
      // Close any leftover 10FastFingers tab if switching to On Note mode
      const previewLeaves = this.app.workspace.getLeavesOfType(
        VIEW_TYPE_MONKEY_PREVIEW
      );
      previewLeaves.forEach((l) => l.detach());

      // Find existing MarkdownView for this file or open one
      let targetView: MarkdownView | null = null;
      const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
      for (const l of mdLeaves) {
        const v = l.view as MarkdownView;
        if (v?.file?.path === file.path) {
          targetView = v;
          this.app.workspace.setActiveLeaf(l, { focus: true });
          break;
        }
      }
      if (!targetView) {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        targetView = leaf.view as MarkdownView;
      }
      if (!targetView) {
        new Notice("Could not open note view.");
        return;
      }
      await this.mountOverlayAndRun(
        file,
        targetView.contentEl,
        mode,
        choice,
        targetHeadingPaths,
        false
      );
    }
  }

  private async mountTenFastFingersAndRun(
    file: TFile,
    hostContainerEl: HTMLElement,
    mode: "whole" | "section" | "random",
    choice: StyleChoice,
    targetHeadingPaths?: string[]
  ) {
    this.stopActiveSession(false);
    const content = await this.app.vault.cachedRead(file);

    const tempDiv = createDiv();
    const comp = new Component();
    comp.load();
    await MarkdownRenderer.render(
      this.app,
      content,
      tempDiv,
      file.path,
      comp
    );

    const { blocks, allChars } = extractTypeableChars(tempDiv, {
      contentStyle: choice.contentStyle,
      settings: this.data.settings,
      targetHeadingPaths,
    });
    comp.unload();

    let activeChars = allChars;
    if (mode === "random" && blocks.length > 1) {
      const minChars = this.data.settings.minParagraphChars || 60;
      const eligible = blocks.filter(
        (b) => !b.chars[0]?.isHeading && b.chars.length >= minChars
      );
      const chosenBlock =
        eligible.length > 0
          ? eligible[Math.floor(Math.random() * eligible.length)]
          : blocks[Math.floor(Math.random() * blocks.length)];
      activeChars = chosenBlock.chars;
    }

    const words = extractWordsFromChars(activeChars);
    if (words.length === 0) {
      new Notice("No typeable words found under current rules.");
      this.stopActiveSession(true);
      return;
    }

    this.activeTenFastSession = new TenFastFingersSession(
      hostContainerEl,
      file.basename,
      words,
      choice.contentStyle,
      this.data.settings,
      {
        onTypingStarted: () => {
          this.enterFocusModeIfEnabled();
        },
        onSessionStoppedOrCompleted: () => {
          this.exitFocusMode();
        },
        onRestart: () => {
          this.exitFocusMode();
          void this.mountTenFastFingersAndRun(
            file,
            hostContainerEl,
            mode,
            choice,
            targetHeadingPaths
          );
        },
        onExit: () => {
          this.stopActiveSession(true);
        },
        onNextRandom: () => {
          void this.startRandomSession(this.app.vault.getRoot());
        },
        onSwitchViewMode: async (newView) => {
          this.data.settings.typingViewMode = newView;
          await this.savePluginData();
          await this.launchWithChoice(
            file,
            mode,
            { contentStyle: choice.contentStyle, typingViewMode: newView },
            targetHeadingPaths
          );
        },
        onSwitchContentStyle: async (newStyle) => {
          this.data.settings.defaultContentStyle = newStyle;
          await this.savePluginData();
          await this.mountTenFastFingersAndRun(
            file,
            hostContainerEl,
            mode,
            { contentStyle: newStyle, typingViewMode: "ten-fast-fingers" },
            targetHeadingPaths
          );
        },
        onSettingsChanged: () => {
          void this.savePluginData();
        },
        onChangeTimerSetting: async (sec) => {
          this.data.settings.sessionTimerSeconds = sec;
          this.data.settings.tenFastFingersDurationSeconds = sec;
          await this.savePluginData();
        },
        onWeakWords: (troubleWords) => {
          if (troubleWords.length === 0) return;
          const drillWords: string[] = [];
          troubleWords.forEach((w) => drillWords.push(w, w, w));
          this.activeTenFastSession?.destroy();
          this.activeTenFastSession = new TenFastFingersSession(
            hostContainerEl,
            `${file.basename} (Weak Words)`,
            drillWords,
            choice.contentStyle,
            this.data.settings,
            {
              onTypingStarted: () => this.enterFocusModeIfEnabled(),
              onSessionStoppedOrCompleted: () => this.exitFocusMode(),
              onRestart: () => {},
              onExit: () => this.stopActiveSession(true),
              onNextRandom: () =>
                void this.startRandomSession(this.app.vault.getRoot()),
              onWeakWords: () => {},
            },
            this.getBestWpmForFile(file)
          );
        },
      },
      this.getBestWpmForFile(file)
    );
  }

  private async mountOverlayAndRun(
    file: TFile,
    hostContainerEl: HTMLElement,
    mode: "whole" | "section" | "random",
    choice: StyleChoice,
    targetHeadingPaths?: string[],
    isDedicatedTab: boolean = false
  ) {
    this.stopActiveSession(false);
    // Remove any existing overlay inside hostContainerEl so overlays never stack
    hostContainerEl
      .querySelectorAll(".mt-overlay")
      .forEach((el) => el.remove());

    const content = await this.app.vault.cachedRead(file);

    const overlay = hostContainerEl.createDiv({
      cls: `mt-overlay ${isDedicatedTab ? "mt-overlay-tab" : "mt-overlay-in-note"}`,
    });
    this.activeOverlayEl = overlay;

    // 1. Top Visual Configuration Bar (Auto-Hides When Typing Starts)
    let sessionTimerSeconds = this.data.settings.sessionTimerSeconds ?? 60;
    let remainingTimerSec = sessionTimerSeconds;

    const configBar = new SessionConfigBar(overlay, {
      viewMode: "in-note",
      contentStyle: choice.contentStyle,
      timerSeconds: sessionTimerSeconds,
      chunkLines: this.data.settings.onNoteChunkLines,
      settings: this.data.settings,
      onChangeViewMode: async (newView) => {
        this.data.settings.typingViewMode = newView;
        await this.savePluginData();
        await this.launchWithChoice(
          file,
          mode,
          { contentStyle: choice.contentStyle, typingViewMode: newView },
          targetHeadingPaths
        );
      },
      onChangeContentStyle: async (newStyle) => {
        this.data.settings.defaultContentStyle = newStyle;
        await this.savePluginData();
        await this.mountOverlayAndRun(
          file,
          hostContainerEl,
          mode,
          { contentStyle: newStyle, typingViewMode: "in-note" },
          targetHeadingPaths,
          isDedicatedTab
        );
      },
      onChangeTimer: async (sec) => {
        sessionTimerSeconds = sec;
        remainingTimerSec = sec;
        this.data.settings.sessionTimerSeconds = sec;
        this.data.settings.tenFastFingersDurationSeconds = sec;
        timerPillSpan.setText(this.formatOnNoteTimer(sec, true));
        await this.savePluginData();
        overlay.focus();
      },
      onChangeChunkLines: async (chunkLines) => {
        this.data.settings.onNoteChunkLines = chunkLines;
        await this.savePluginData();
        await this.mountOverlayAndRun(
          file,
          hostContainerEl,
          mode,
          choice,
          targetHeadingPaths,
          isDedicatedTab
        );
      },
    });

    // 2. Sticky Header Strip (Single compact row: Title, Chunk Nav, Live WPM, Timer, Actions)
    const headerStrip = overlay.createDiv({ cls: "mt-header-strip" });
    const leftGroup = headerStrip.createDiv({ cls: "mt-header-left" });
    leftGroup.createSpan({
      cls: "mt-header-title",
      text: `${file.basename}`,
    });
    leftGroup.createSpan({
      cls: "mt-header-badge",
      text: `ON NOTE · ${choice.contentStyle.toUpperCase()}`,
    });

    // Chunk Navigation Pill ([ ◀ Chunk 1/3 ▶ ]) — ONLY shown when Chunk Method is enabled in Settings
    const chunkNavGroup = leftGroup.createDiv({ cls: "mt-chunk-nav" });
    const prevChunkBtn = chunkNavGroup.createEl("button", {
      cls: "mt-chunk-nav-btn",
      text: "◀",
      attr: { title: "Previous Chunk (Alt+Left)" },
    });
    const chunkLabelSpan = chunkNavGroup.createSpan({
      cls: "mt-chunk-nav-label",
      text: "Chunk 1/1",
    });
    const nextChunkBtn = chunkNavGroup.createEl("button", {
      cls: "mt-chunk-nav-btn",
      text: "▶",
      attr: { title: "Next Chunk (Alt+Right)" },
    });

    const centerStats = headerStrip.createDiv({ cls: "mt-header-live-stats" });
    const wpmSpan = centerStats.createSpan({
      cls: "mt-live-wpm",
      text: "0 WPM",
    });
    const accSpan = centerStats.createSpan({
      cls: "mt-live-acc",
      text: "100% acc",
    });
    const timerPillSpan = centerStats.createSpan({
      cls: "mt-live-timer-pill",
      text: this.formatOnNoteTimer(sessionTimerSeconds, true),
    });
    const progressSpan = centerStats.createSpan({
      cls: "mt-live-progress",
      text: "0 / 0 words",
    });
    if (!this.data.settings.liveWpm) {
      wpmSpan.addClass("mt-hidden");
      accSpan.addClass("mt-hidden");
    }

    const rightActions = headerStrip.createDiv({ cls: "mt-header-actions" });
    const restartBtn = rightActions.createEl("button", {
      text: "Restart",
      cls: "mt-header-btn",
    });
    restartBtn.onclick = (e) => {
      e.stopPropagation();
      this.exitFocusMode();
      void this.mountOverlayAndRun(
        file,
        hostContainerEl,
        mode,
        choice,
        targetHeadingPaths,
        isDedicatedTab
      );
    };

    const exitBtn = rightActions.createEl("button", {
      text: "Exit (Esc)",
      cls: "mt-header-btn",
    });
    exitBtn.onclick = (e) => {
      e.stopPropagation();
      this.stopActiveSession(true);
    };

    // 3. Sleek Continuous WPM Rail
    const raceBar = new WpmRaceBar(overlay, {
      targetWpm: this.data.settings.targetWpm || 40,
      bestWpm: this.getBestWpmForFile(file),
      mode: this.data.settings.wpmRaceMode || "speed",
      visible: this.data.settings.showWpmRaceTrack ?? true,
    });

    // 4. Inner preview body with Obsidian's native .markdown-preview-view .markdown-rendered classes
    const previewBody = overlay.createDiv({
      cls: "mt-preview-body markdown-preview-view markdown-rendered",
    });
    const previewSizer = previewBody.createDiv({
      cls: "markdown-preview-sizer",
    });

    const comp = new Component();
    comp.load();
    this.activeRenderComp = comp;
    await MarkdownRenderer.render(
      this.app,
      content,
      previewSizer,
      file.path,
      comp
    );

    // Extract typeable characters & wrap spans in-place
    const { blocks, allChars } = extractTypeableChars(previewSizer, {
      contentStyle: choice.contentStyle,
      settings: this.data.settings,
      targetHeadingPaths,
    });

    if (allChars.length === 0) {
      new Notice("No typeable text found under current rules.");
      this.stopActiveSession(true);
      return;
    }

    // If Random mode, pick a single eligible paragraph block
    let activeChars = allChars;
    if (mode === "random" && blocks.length > 1) {
      const minChars = this.data.settings.minParagraphChars || 60;
      const eligible = blocks.filter(
        (b) => !b.chars[0]?.isHeading && b.chars.length >= minChars
      );
      const chosenBlock =
        eligible.length > 0
          ? eligible[Math.floor(Math.random() * eligible.length)]
          : blocks[Math.floor(Math.random() * blocks.length)];

      blocks.forEach((b) => {
        if (b !== chosenBlock) {
          b.blockEl.remove();
        }
      });
      activeChars = chosenBlock.chars;
    }

    // Real word count (matching TOC sidebar instead of chars / 5)
    const realWordsList = extractWordsFromChars(activeChars);
    const totalWords = Math.max(1, realWordsList.length);
    progressSpan.setText(`0 / ${totalWords} words`);

    // 5. Smart Chunking Setup (ONLY active when onNoteChunkMode is enabled in Settings)
    const chunks: TextChunk[] = this.data.settings.onNoteChunkMode
      ? buildSmartChunks(
          activeChars,
          this.data.settings.onNoteChunkLines || 6,
          this.data.settings.onNoteSmartSentenceBreak ?? true
        )
      : [
          {
            chunkIndex: 0,
            startCharIdx: 0,
            endCharIdx: activeChars.length - 1,
            peekText: "",
          },
        ];

    let activeChunkIndex = 0;
    const peekBoxEl = previewBody.createDiv({ cls: "mt-chunk-peek" });

    if (!this.data.settings.onNoteChunkMode || chunks.length <= 1) {
      chunkNavGroup.addClass("mt-hidden");
      peekBoxEl.addClass("mt-hidden");
    }

    const applyChunkVisibility = (cIdx: number) => {
      activeChunkIndex = Math.max(0, Math.min(chunks.length - 1, cIdx));
      const chunk = chunks[activeChunkIndex];
      chunkLabelSpan.setText(`Chunk ${activeChunkIndex + 1}/${chunks.length}`);

      if (!this.data.settings.onNoteChunkMode || chunks.length <= 1) {
        return;
      }

      const visibleBlocks = new Set<number>();
      for (let i = 0; i < activeChars.length; i++) {
        const ch = activeChars[i];
        const inChunk = i >= chunk.startCharIdx && i <= chunk.endCharIdx;
        if (ch.spanRef) {
          ch.spanRef.toggleClass("mt-hidden", !inChunk);
        }
        if (inChunk) {
          visibleBlocks.add(ch.blockIndex);
        }
      }

      for (const b of blocks) {
        b.blockEl.toggleClass("mt-hidden", !visibleBlocks.has(b.blockIndex));
      }

      if (this.data.settings.onNoteNextChunkPeek && chunk.peekText) {
        peekBoxEl.removeClass("mt-hidden");
        peekBoxEl.setText(`Next: ${chunk.peekText}`);
      } else {
        peekBoxEl.addClass("mt-hidden");
      }
    };

    applyChunkVisibility(0);

    // 6. Create Engine
    const engine = new TypingEngine(
      activeChars,
      this.data.settings,
      {
        onStatusChange: (status) => {
          if (status === "running") {
            // Auto-hide top configuration bar and enter FocusMode on first keystroke!
            configBar.hideOnStart();
            this.enterFocusModeIfEnabled();
            overlay.focus();

            if (!this.activeOnNoteTimerId) {
              const timerStartTs = Date.now();
              this.activeOnNoteTimerId = window.setInterval(() => {
                if (engine.status !== "running") return;
                const elapsedSec = Math.floor((Date.now() - timerStartTs) / 1000);
                if (sessionTimerSeconds > 0) {
                  remainingTimerSec = Math.max(0, sessionTimerSeconds - elapsedSec);
                  timerPillSpan.setText(this.formatOnNoteTimer(remainingTimerSec, false));
                  if (remainingTimerSec <= 0) {
                    engine.complete();
                  }
                } else {
                  timerPillSpan.setText(this.formatOnNoteTimer(elapsedSec, false));
                }
              }, 250);
            }
          }
        },
        onCharUpdate: (idx, status) => {
          const item = activeChars[idx];
          if (item?.spanRef) {
            const spaceClass = item.char === " " ? " mt-space" : "";
            item.spanRef.className = `mt-char mt-${status}${spaceClass}`;
          }
        },
        onCaretMove: (idx) => {
          if (this.data.settings.onNoteChunkMode && chunks.length > 1) {
            const currentChunk = chunks[activeChunkIndex];
            if (idx > currentChunk.endCharIdx || idx < currentChunk.startCharIdx) {
              const targetChunk = chunks.findIndex(
                (c) => idx >= c.startCharIdx && idx <= c.endCharIdx
              );
              if (targetChunk !== -1 && targetChunk !== activeChunkIndex) {
                applyChunkVisibility(targetChunk);
              }
            }
          }

          previewSizer
            .querySelectorAll(".mt-caret")
            .forEach((el) => el.classList.remove("mt-caret"));
          const item = activeChars[idx];
          if (item?.spanRef) {
            item.spanRef.classList.add("mt-caret");
            this.scrollCaretIntoComfortZone(overlay, item.spanRef);
          }
        },
        onLiveWpm: (wpm, acc) => {
          wpmSpan.setText(`${wpm} WPM`);
          accSpan.setText(`${acc}% acc`);
          const fraction = engine.currentIndex / Math.max(1, activeChars.length);
          const doneWords = Math.min(totalWords, Math.round(fraction * totalWords));
          progressSpan.setText(`${doneWords} / ${totalWords} words`);

          const elapsedSec =
            engine.status === "running"
              ? (engine.elapsedMs + (Date.now() - engine.startTime)) / 1000
              : engine.elapsedMs / 1000;
          raceBar.update(wpm, fraction, elapsedSec, totalWords);
        },
        onStatsUpdate: (stats) => {
          this.exitFocusMode();
          if (this.activeOnNoteTimerId) {
            window.clearInterval(this.activeOnNoteTimerId);
            this.activeOnNoteTimerId = undefined;
          }
          new ResultsStrip(overlay, stats, {
            onNext: () =>
              void this.startRandomSession(this.app.vault.getRoot()),
            onRetry: () =>
              void this.mountOverlayAndRun(
                file,
                hostContainerEl,
                mode,
                choice,
                targetHeadingPaths,
                isDedicatedTab
              ),
            onWeakWords: () => {
              if (stats.troubleWords.length === 0) return;
              void this.startWeakWordsDrill(
                file,
                hostContainerEl,
                choice,
                stats.troubleWords,
                isDedicatedTab
              );
            },
            onClose: () => {
              this.stopActiveSession(true);
            },
          });
        },
      },
      choice.contentStyle
    );

    this.activeEngine = engine;

    // Ghost typist: a quiet companion caret that types forward at the target pace.
    if (this.data.settings.onNoteGhostTypist) {
      overlay.style.setProperty(
        "--mt-ghost-color",
        `var(--color-${this.data.settings.onNoteGhostColor || "purple"})`
      );
      overlay.addClass("mt-has-ghost-typist");
      const typeable: number[] = [];
      activeChars.forEach((ch, i) => {
        if (!ch.isGhost) typeable.push(i);
      });
      let ghostEl: HTMLElement | undefined;
      this.activeGhostTimerId = window.setInterval(() => {
        if (engine.status !== "running" || typeable.length === 0) return;
        const elapsedSec = (engine.elapsedMs + (Date.now() - engine.startTime)) / 1000;
        const pace = this.data.settings.targetWpm || 40;
        const pos = Math.min(
          typeable.length - 1,
          Math.floor((elapsedSec / 60) * pace * 5)
        );
        const el = activeChars[typeable[pos]]?.spanRef;
        if (el === ghostEl) return;
        ghostEl?.classList.remove("mt-ghost-typist");
        el?.classList.add("mt-ghost-typist");
        ghostEl = el;
      }, 120);
    }

    const jumpToChunk = (targetChunkIdx: number) => {
      if (!this.data.settings.onNoteChunkMode) return;
      if (targetChunkIdx < 0 || targetChunkIdx >= chunks.length) return;
      applyChunkVisibility(targetChunkIdx);
      engine.currentIndex = chunks[targetChunkIdx].startCharIdx;
      previewSizer
        .querySelectorAll(".mt-caret")
        .forEach((el) => el.classList.remove("mt-caret"));
      activeChars[engine.currentIndex]?.spanRef?.classList.add("mt-caret");
      overlay.focus();
    };

    prevChunkBtn.onclick = (e) => {
      e.stopPropagation();
      jumpToChunk(activeChunkIndex - 1);
    };
    nextChunkBtn.onclick = (e) => {
      e.stopPropagation();
      jumpToChunk(activeChunkIndex + 1);
    };

    const firstChar = activeChars[engine.currentIndex];
    if (firstChar?.spanRef) {
      firstChar.spanRef.classList.add("mt-caret");
    }

    overlay.tabIndex = 0;
    overlay.focus();

    overlay.onclick = () => {
      overlay.focus();
    };

    overlay.onkeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // Esc mid-session shows the WPM results; Esc again exits.
        if (engine.status === "running") {
          engine.complete();
        } else {
          this.stopActiveSession(true);
        }
        return;
      }

      if (this.data.settings.onNoteChunkMode && e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        jumpToChunk(activeChunkIndex - 1);
        return;
      }
      if (this.data.settings.onNoteChunkMode && e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        jumpToChunk(activeChunkIndex + 1);
        return;
      }

      if (
        e.key === " " ||
        e.key === "Backspace" ||
        e.key === "Tab" ||
        e.key === "Enter" ||
        (e.key.length === 1 && !e.ctrlKey && !e.metaKey)
      ) {
        e.preventDefault();
        e.stopPropagation();
      }

      engine.handleKey(e.key, e.ctrlKey || e.metaKey);
    };

    // Touch devices: a virtual keyboard sends no keydown events, so drive the engine from a hidden input.
    if (Platform.isMobile) {
      const touchInput = overlay.createEl("input", {
        cls: "mt-touch-input",
        attr: {
          type: "text",
          autocapitalize: "off",
          autocorrect: "off",
          autocomplete: "off",
          spellcheck: "false",
          "aria-label": "Typing input",
        },
      });
      touchInput.addEventListener("beforeinput", (e: InputEvent) => {
        e.preventDefault();
        if (e.inputType === "deleteContentBackward") {
          engine.handleKey("Backspace", false);
        } else if (e.inputType === "insertLineBreak") {
          engine.handleKey("Enter", false);
        } else if (e.data) {
          for (const ch of Array.from(e.data)) engine.handleKey(ch, false);
        }
      });
      overlay.onclick = () => touchInput.focus();
      touchInput.focus();
    }
  }

  private formatOnNoteTimer(seconds: number, isIdle: boolean): string {
    if (seconds === 0 && isIdle) return "∞";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  private scrollCaretIntoComfortZone(
    scrollContainer: HTMLElement,
    caretEl: HTMLElement
  ) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const caretRect = caretEl.getBoundingClientRect();
    if (containerRect.height <= 0) return;

    const topThreshold = containerRect.top + containerRect.height * 0.25;
    const bottomThreshold = containerRect.top + containerRect.height * 0.7;

    if (caretRect.bottom > bottomThreshold) {
      const delta = caretRect.top - (containerRect.top + containerRect.height * 0.45);
      scrollContainer.scrollBy({ top: delta, behavior: "smooth" });
    } else if (caretRect.top < topThreshold && scrollContainer.scrollTop > 0) {
      const delta = caretRect.top - (containerRect.top + containerRect.height * 0.4);
      scrollContainer.scrollBy({ top: delta, behavior: "smooth" });
    }
  }

  private async startWeakWordsDrill(
    file: TFile,
    hostContainerEl: HTMLElement,
    choice: StyleChoice,
    troubleWords: string[],
    isDedicatedTab: boolean
  ) {
    const drillMd = `## Weak Words Drill\n\n${troubleWords
      .map((w) => `${w} ${w} ${w}`)
      .join(" ")}`;
    this.stopActiveSession(false);

    const overlay = hostContainerEl.createDiv({
      cls: `mt-overlay ${isDedicatedTab ? "mt-overlay-tab" : "mt-overlay-in-note"}`,
    });
    this.activeOverlayEl = overlay;

    const previewBody = overlay.createDiv({
      cls: "mt-preview-body markdown-preview-view markdown-rendered",
    });
    const previewSizer = previewBody.createDiv({
      cls: "markdown-preview-sizer",
    });

    const comp = new Component();
    comp.load();
    this.activeRenderComp = comp;
    await MarkdownRenderer.render(
      this.app,
      drillMd,
      previewSizer,
      file.path,
      comp
    );

    const { allChars } = extractTypeableChars(previewSizer, {
      contentStyle: choice.contentStyle,
      settings: this.data.settings,
    });

    const engine = new TypingEngine(allChars, this.data.settings, {
      onCharUpdate: (idx, status) => {
        const item = allChars[idx];
        if (item?.spanRef) {
          item.spanRef.className = `mt-char mt-${status}`;
        }
      },
      onCaretMove: (idx) => {
        previewSizer
          .querySelectorAll(".mt-caret")
          .forEach((el) => el.classList.remove("mt-caret"));
        allChars[idx]?.spanRef?.classList.add("mt-caret");
      },
      onStatsUpdate: () => {
        new Notice("Weak words drill completed!");
        this.stopActiveSession(true);
      },
    });
    this.activeEngine = engine;
    allChars[0]?.spanRef?.classList.add("mt-caret");
    overlay.tabIndex = 0;
    overlay.focus();
    overlay.onkeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.stopActiveSession(true);
        return;
      }
      e.preventDefault();
      engine.handleKey(e.key, e.ctrlKey || e.metaKey);
    };
  }
}
