import { App, PluginSettingTab, Setting, SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type RetypeNotesPlugin from "./main";
import { DEFAULT_SETTINGS, PluginSettings } from "./types";

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

type ContentStyleKey = "text" | "exact" | "code";

const WORD_LIMIT_OPTIONS: Record<string, string> = {
  "0": "All words",
  "25": "25 Words",
  "50": "50 Words",
  "100": "100 Words",
  "200": "200 Words",
};

export class MonkeyTypingSettingTab extends PluginSettingTab {
  plugin: RetypeNotesPlugin;

  constructor(app: App, plugin: RetypeNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.containerEl.addClass("mt-settings-container");
  }

  private get s(): PluginSettings {
    return this.plugin.data.settings;
  }

  private async save() {
    await this.plugin.savePluginData();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Typing view, content style, timer, lines and word count are changed live in the bar at the top of a typing session.",
      },
      {
        name: "Content styles in top bar",
        desc: "Which styles you can switch between: Text (words only), exact (every character), code (includes code blocks)",
        render: (setting: Setting) => this.renderContentStyleToggles(setting),
      },
      {
        name: "Words per session",
        desc: "How many words a 10fastfingers session contains",
        control: {
          type: "dropdown",
          key: "tenFastWordLimit",
          options: WORD_LIMIT_OPTIONS,
          defaultValue: String(DEFAULT_SETTINGS.tenFastWordLimit),
        },
      },
      {
        type: "group",
        heading: "Typing rules",
        items: [
          this.toggle("strictMode", "Strict mode", "Block progress until the current character is typed correctly"),
          this.toggle("lenientSymbols", "Lenient symbols", "Skip over punctuation and symbols you don't need to type"),
          this.toggle("skipHeadingText", "Skip headings", "Leave heading text out of the typing session"),
          this.toggle("skipCalloutBody", "Skip callouts", "Leave callout bodies out of the typing session"),
        ],
      },
      {
        type: "group",
        heading: "Live feedback",
        items: [
          this.toggle("liveWpm", "Live WPM and accuracy", "Show speed and accuracy while typing"),
          this.toggle("showWpmRaceTrack", "Progress race rail", "Show the progress rail with a target pace marker"),
          {
            name: "Target pace",
            desc: "Words per minute the pace marker races at",
            control: {
              type: "slider",
              key: "targetWpm",
              min: 10,
              max: 200,
              step: 5,
              defaultValue: DEFAULT_SETTINGS.targetWpm,
            },
          },
        ],
      },
      {
        type: "group",
        heading: "On note",
        items: [
          this.toggle(
            "onNoteChunkMode",
            "Chunk mode (on note)",
            "Type long notes a few lines at a time. When off, chunk controls are hidden"
          ),
          this.toggle(
            "onNoteSmartSentenceBreak",
            "Break chunks at sentences",
            "End chunks on sentence boundaries where possible",
            () => !this.s.onNoteChunkMode
          ),
          this.toggle(
            "onNoteNextChunkPeek",
            "Peek at next chunk",
            "Show a faint preview of the next chunk below the current one",
            () => !this.s.onNoteChunkMode
          ),
          this.toggle(
            "onNoteGhostTypist",
            "Ghost typist",
            "A quiet companion caret types forward at your target pace so you can race it on the note"
          ),
          {
            name: "Ghost colour",
            desc: "Colour of the ghost caret and the pace marker",
            control: {
              type: "dropdown",
              key: "onNoteGhostColor",
              options: {
                purple: "Purple",
                cyan: "Cyan",
                orange: "Orange",
                pink: "Pink",
                red: "Red",
              },
              defaultValue: DEFAULT_SETTINGS.onNoteGhostColor,
              disabled: () => !this.s.onNoteGhostTypist,
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Focus",
        items: [
          this.toggle(
            "autoToggleSidebars",
            "Hide sidebars while typing",
            "Collapse side panels when typing starts and restore them afterwards"
          ),
          this.toggle("autoToggleLeft", "…left sidebar", "Include the left sidebar"),
          this.toggle("autoToggleRight", "…right sidebar", "Include the right sidebar"),
        ],
      },
      {
        type: "group",
        heading: "Outline panel",
        items: [
          this.toggle(
            "enableOutlineIntegration",
            "Outline integration",
            "Start typing a section straight from Obsidian's Outline panel"
          ),
          this.toggle(
            "outlineDoubleClickToType",
            "Double-click heading to type",
            "Double-click an outline heading to type that section (single click still navigates)"
          ),
          this.toggle(
            "outlineShowPopoverOnClick",
            "Action menu on single click",
            "Show a small menu with Topic Typing and Show when you click an outline heading"
          ),
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const value = (this.s as unknown as Record<string, unknown>)[key];
    // Dropdowns work with strings, so the numeric word limit is shown as text.
    return key === "tenFastWordLimit" ? String(this.s.tenFastWordLimit) : value;
  }

  setControlValue(key: string, value: unknown): void {
    const settings = this.s as unknown as Record<string, unknown>;
    settings[key] = key === "tenFastWordLimit" ? parseInt(String(value), 10) : value;

    if (key === "enableOutlineIntegration") {
      if (value) this.plugin.outlineIntegration?.bindOutlineLeaves();
      else this.plugin.outlineIntegration?.closePopover();
    }

    void this.save();
    // Re-evaluate disabled states of dependent settings.
    this.update();
  }

  private toggle(key: BoolKey, name: string, desc: string, disabled?: () => boolean): SettingGroupItem {
    return {
      name,
      desc,
      control: {
        type: "toggle",
        key,
        defaultValue: DEFAULT_SETTINGS[key],
        disabled,
      },
    };
  }

  /** Custom row: one small toggle per content style shown in the top bar. */
  private renderContentStyleToggles(setting: Setting) {
    const wrap = setting.controlEl.createDiv({ cls: "mt-mini-toggles" });
    const keys: ContentStyleKey[] = ["text", "exact", "code"];
    keys.forEach((key) => {
      const item = wrap.createDiv({ cls: "mt-mini-toggle" });
      item.createSpan({ text: key[0].toUpperCase() + key.slice(1) });
      const box = item.createDiv({ cls: "checkbox-container" });
      box.toggleClass("is-enabled", this.s.enabledContentCards?.[key] ?? true);
      box.onclick = () => {
        const next = !box.hasClass("is-enabled");
        box.toggleClass("is-enabled", next);
        this.s.enabledContentCards = { ...this.s.enabledContentCards, [key]: next };
        void this.save();
      };
    });
  }
}
