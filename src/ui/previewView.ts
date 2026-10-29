import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

export const VIEW_TYPE_MONKEY_PREVIEW = "retype-notes-view";

export class MonkeyTypingPreviewView extends ItemView {
  private currentTitle: string = "Retype Notes";
  private onCloseCallback?: () => void;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_MONKEY_PREVIEW;
  }

  getDisplayText(): string {
    return this.currentTitle;
  }

  getIcon(): string {
    return "keyboard";
  }

  setSessionTitle(file: TFile, modeLabel: string, onCloseCallback?: () => void) {
    this.currentTitle = `Typing: ${file.basename} (${modeLabel})`;
    this.onCloseCallback = onCloseCallback;
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
  }

  getMountContainer(): HTMLElement {
    this.contentEl.empty();
    this.contentEl.addClass("mt-preview-view-host");
    return this.contentEl;
  }

  async onClose() {
    this.onCloseCallback?.();
  }
}
