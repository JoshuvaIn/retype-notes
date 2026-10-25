export interface StyleChoice {
  contentStyle: "text" | "ghost" | "exact" | "code";
  typingViewMode?: "ten-fast-fingers" | "in-note";
}

export interface TypingRun {
  ts: number;
  mode: "whole" | "section" | "random";
  contentStyle: "text" | "ghost" | "exact" | "code";
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  charsTotal: number;
  charsCorrect: number;
  charsIncorrect: number;
  charsExtra: number;
  charsMissed: number;
  troubleWords: string[];
  explain?: string;
  sectionPath?: string;
}

export interface SectionSrs {
  ease: number;
  interval: number;
  due: string; // YYYY-MM-DD
  repetitions: number;
}

export interface SectionData {
  runs: TypingRun[];
  srs?: SectionSrs;
  bestWpm?: number;
  bestAcc?: number;
}

export interface NoteData {
  hash: string;
  sections: Record<string, SectionData>;
  runs: TypingRun[];
  resumeCharIndex?: number;
}

export interface PluginSettings {
  // Default view & card visibility
  typingViewMode: "ten-fast-fingers" | "in-note";
  sessionTimerSeconds: number; // 30, 60, 120, 300, or 0 (untimed)
  tenFastFingersDurationSeconds: number;
  rememberLastChoice: boolean;
  defaultContentStyle: "text" | "ghost" | "exact" | "code";
  enabledContentCards: {
    text: boolean;
    ghost: boolean;
    exact: boolean;
    code: boolean;
  };

  // Auto Toggle Sidebars (Focus Mode)
  autoToggleSidebars: boolean;
  autoToggleLeft: boolean;
  autoToggleRight: boolean;

  // On Note Chunk Method settings (Settings-only enable/disable)
  onNoteChunkMode: boolean;
  onNoteChunkLines: number; // 4, 5, 6, 7, 8
  onNoteSmartSentenceBreak: boolean;
  onNoteNextChunkPeek: boolean;

  // Sleek Continuous WPM Rail settings
  targetWpm: number;
  tenFastLines: number;
  tenFastWordLimit: number;
  showWpmRaceTrack: boolean;
  wpmRaceMode: "speed" | "progress";

  // Outline Core Plugin Integration
  enableOutlineIntegration: boolean;
  outlineDoubleClickToType: boolean;
  outlineShowPopoverOnClick: boolean;

  // Sources & Random
  defaultRandomFolder: string;
  includeSubfolders: boolean;
  excludeFolders: string[];
  minParagraphChars: number;
  maxParagraphChars: number;
  filterTag: string;

  // Skip options
  skipHighlightWords: boolean;
  skipCalloutBody: boolean;
  skipHeadingText: boolean;

  // Typing behaviour
  strictMode: boolean;
  lenientSymbols: boolean;
  caseSensitive: boolean;
  requirePunctuation: boolean;
  liveWpm: boolean;
  idlePauseSeconds: number;
  ghostCaret: boolean;
  onNoteGhostTypist: boolean;
  onNoteGhostColor: string;

  // Learning / Warmup
  warmupCalloutTypes: string[];
  enableExplainIt: boolean;

  // Review & Goals
  enableSrs: boolean;
  dailyGoalParagraphs: number;
  showStatusBar: boolean;

  // Output & Data
  writeStatsToFrontmatter: boolean;
  dashboardPath: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  typingViewMode: "ten-fast-fingers",
  sessionTimerSeconds: 60,
  tenFastFingersDurationSeconds: 60,
  rememberLastChoice: true,
  defaultContentStyle: "text",
  enabledContentCards: {
    text: true,
    ghost: false,
    exact: true,
    code: true,
  },

  autoToggleSidebars: true,
  autoToggleLeft: true,
  autoToggleRight: true,

  onNoteChunkMode: true,
  onNoteChunkLines: 6,
  onNoteSmartSentenceBreak: true,
  onNoteNextChunkPeek: true,

  targetWpm: 40,
  tenFastLines: 3,
  tenFastWordLimit: 0,
  showWpmRaceTrack: true,
  wpmRaceMode: "progress",
  enableOutlineIntegration: true,
  outlineDoubleClickToType: true,
  outlineShowPopoverOnClick: false,

  defaultRandomFolder: "",
  includeSubfolders: true,
  excludeFolders: ["Templates", "Inbox", "Stash"],
  minParagraphChars: 120,
  maxParagraphChars: 800,
  filterTag: "",

  skipHighlightWords: false,
  skipCalloutBody: false,
  skipHeadingText: false,

  strictMode: false,
  lenientSymbols: true,
  caseSensitive: false,
  requirePunctuation: false,
  liveWpm: true,
  idlePauseSeconds: 5,
  ghostCaret: false,
  onNoteGhostTypist: true,
  onNoteGhostColor: "purple",

  warmupCalloutTypes: ["summary", "abstract"],
  enableExplainIt: true,

  enableSrs: true,
  dailyGoalParagraphs: 3,
  showStatusBar: true,

  writeStatsToFrontmatter: false,
  dashboardPath: "Retype Notes/Dashboard.md",
};

export interface PluginData {
  settings: PluginSettings;
  notes: Record<string, NoteData>;
  overallTroubleWords: Record<string, number>;
  streak: {
    days: number;
    lastDate: string;
  };
}

export const DEFAULT_DATA: PluginData = {
  settings: DEFAULT_SETTINGS,
  notes: {},
  overallTroubleWords: {},
  streak: {
    days: 0,
    lastDate: "",
  },
};
