import { App, PluginSettingTab, Setting } from "obsidian";
import type RetypeNotesPlugin from "./main";
import type { PluginSettings } from "./types";

type BoolKey =
  | "autoToggleSidebars"
  | "autoToggleLeft"
  | "autoToggleRight"
  | "enableOutlineIntegration"
  | "outlineDoubleClickToType"
  | "outlineShowPopoverOnClick"
  | "onNoteChunkMode"
  | "onNoteSmartSentenceBreak"
  | "onNoteNextChunkPeek"
  | "onNoteGhostTypist"
  | "showWpmRaceTrack"
  | "liveWpm"
  | "strictMode"
  | "lenientSymbols"
  | "skipHeadingText"
  | "skipCalloutBody";

export class MonkeyTypingSettingTab extends PluginSettingTab {
  plugin: RetypeNotesPlugin;

  constructor(app: App, plugin: RetypeNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private get s(): PluginSettings {
    return this.plugin.data.settings;
  }

  private async save() {
    await this.plugin.savePluginData();
  }

  /** One native toggle row. Returns the Setting so callers can disable it. */
  private addToggle(
    el: HTMLElement,
    name: string,
    desc: string,
    key: BoolKey,
    fallback: boolean,
    onChange?: (val: boolean) => void
  ): Setting {
    return new Setting(el)
      .setName(name)
      .setDesc(desc)
      .addToggle((t) =>
        t.setValue(Boolean(this.s[key] ?? fallback)).onChange(async (val) => {
          this.s[key] = val;
          await this.save();
          onChange?.(val);
        })
      );
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("mt-settings-container");

    containerEl.createDiv({
      cls: "mt-settings-note",
      text: "Typing view, content style, timer, lines and word count are changed live in the bar at the top of a typing session.",
    });

    new Setting(containerEl)
      .setName("Content styles in top bar")
      .setDesc("Which styles you can switch between: Text (words only), exact (every character), code (includes code blocks)")
      .then((st) => {
        const wrap = st.controlEl.createDiv({ cls: "mt-mini-toggles" });
        (["text", "exact", "code"] as const).forEach((key) => {
          const item = wrap.createDiv({ cls: "mt-mini-toggle" });
          item.createSpan({ text: key[0].toUpperCase() + key.slice(1) });
          const box = item.createDiv({ cls: "checkbox-container" });
          box.toggleClass("is-enabled", this.s.enabledContentCards?.[key] ?? true);
          box.onclick = async () => {
            const next = !box.hasClass("is-enabled");
            box.toggleClass("is-enabled", next);
            this.s.enabledContentCards = { ...this.s.enabledContentCards, [key]: next };
            await this.save();
          };
        });
      });

    new Setting(containerEl)
      .setName("Words per session")
      .setDesc("How many words a 10fastfingers session contains")
      .addDropdown((d) =>
        d
          .addOption("0", "All words")
          .addOption("25", "25 Words")
          .addOption("50", "50 Words")
          .addOption("100", "100 Words")
          .addOption("200", "200 Words")
          .setValue(String(this.s.tenFastWordLimit ?? 0))
          .onChange(async (val) => {
            this.s.tenFastWordLimit = parseInt(val, 10);
            await this.save();
          })
      );

    new Setting(containerEl).setName("Typing rules").setHeading();
    this.addToggle(containerEl, "Strict mode", "Block progress until the current character is typed correctly", "strictMode", false);
    this.addToggle(containerEl, "Lenient symbols", "Skip over punctuation and symbols you don't need to type", "lenientSymbols", false);
    this.addToggle(containerEl, "Skip headings", "Leave heading text out of the typing session", "skipHeadingText", false);
    this.addToggle(containerEl, "Skip callouts", "Leave callout bodies out of the typing session", "skipCalloutBody", false);

    new Setting(containerEl).setName("Live feedback").setHeading();
    this.addToggle(containerEl, "Live WPM and accuracy", "Show speed and accuracy while typing", "liveWpm", true);
    this.addToggle(containerEl, "Progress race rail", "Show the progress rail with a target pace marker", "showWpmRaceTrack", true);

    new Setting(containerEl)
      .setName("Target pace")
      .setDesc("Words per minute the pace marker races at")
      .addSlider((sl) =>
        sl
          .setLimits(10, 200, 5)
          .setValue(this.s.targetWpm ?? 40)
          .onChange(async (val) => {
            this.s.targetWpm = val;
            await this.save();
          })
      );

    new Setting(containerEl).setName("On note").setHeading();
    const chunkDependents: Setting[] = [];
    const syncChunk = (on: boolean) =>
      chunkDependents.forEach((st) => {
        st.setDisabled(!on);
        st.settingEl.toggleClass("mt-setting-disabled", !on);
      });

    this.addToggle(
      containerEl,
      "Chunk mode (on note)",
      "Type long notes a few lines at a time. When off, chunk controls are hidden",
      "onNoteChunkMode",
      true,
      syncChunk
    );
    chunkDependents.push(
      this.addToggle(containerEl, "Break chunks at sentences", "End chunks on sentence boundaries where possible", "onNoteSmartSentenceBreak", true),
      this.addToggle(containerEl, "Peek at next chunk", "Show a faint preview of the next chunk below the current one", "onNoteNextChunkPeek", true),
    );
    syncChunk(Boolean(this.s.onNoteChunkMode));

    const ghostRow = this.addToggle(
      containerEl,
      "Ghost typist",
      "A quiet companion caret types forward at your target pace so you can race it on the note",
      "onNoteGhostTypist",
      true,
      (val) => {
        ghostColor.setDisabled(!val);
        ghostColor.settingEl.toggleClass("mt-setting-disabled", !val);
      }
    );
    void ghostRow;
    const ghostColor = new Setting(containerEl)
      .setName("Ghost colour")
      .setDesc("Colour of the ghost caret and the pace marker")
      .addDropdown((d) =>
        d
          .addOption("purple", "Purple")
          .addOption("cyan", "Cyan")
          .addOption("orange", "Orange")
          .addOption("pink", "Pink")
          .addOption("red", "Red")
          .setValue(this.s.onNoteGhostColor || "purple")
          .onChange(async (val) => {
            this.s.onNoteGhostColor = val;
            await this.save();
          })
      );
    ghostColor.setDisabled(!(this.s.onNoteGhostTypist ?? true));
    ghostColor.settingEl.toggleClass("mt-setting-disabled", !(this.s.onNoteGhostTypist ?? true));

    new Setting(containerEl).setName("Focus").setHeading();
    this.addToggle(containerEl, "Hide sidebars while typing", "Collapse side panels when typing starts and restore them afterwards", "autoToggleSidebars", true);
    this.addToggle(containerEl, "…left sidebar", "Include the left sidebar", "autoToggleLeft", true);
    this.addToggle(containerEl, "…right sidebar", "Include the right sidebar", "autoToggleRight", true);

    new Setting(containerEl).setName("Outline panel").setHeading();
    this.addToggle(
      containerEl,
      "Outline integration",
      "Start typing a section straight from Obsidian's Outline panel",
      "enableOutlineIntegration",
      true,
      (val) => {
        if (val) this.plugin.outlineIntegration?.bindOutlineLeaves();
        else this.plugin.outlineIntegration?.closePopover();
      }
    );
    this.addToggle(containerEl, "Double-click heading to type", "Double-click an outline heading to type that section (single click still navigates)", "outlineDoubleClickToType", true);
    this.addToggle(containerEl, "Action menu on single click", "Show a small menu with Topic Typing and Show when you click an outline heading", "outlineShowPopoverOnClick", false);
  }
}
