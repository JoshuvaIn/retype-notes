import { App, HeadingCache, MarkdownView, TFile, View, WorkspaceLeaf } from "obsidian";

export interface OutlineIntegrationHost {
  app: App;
  data: {
    settings: {
      enableOutlineIntegration: boolean;
      outlineDoubleClickToType: boolean;
      outlineShowPopoverOnClick: boolean;
    };
  };
  startTypingSession: (
    file: TFile,
    mode: "whole" | "section" | "random",
    targetHeadingPaths?: string[]
  ) => Promise<void>;
}

interface OutlineListeners {
  onClick: (evt: MouseEvent) => void;
  onDblClick: (evt: MouseEvent) => void;
}

interface ResolvedHeading {
  activeFile: TFile;
  headingTitle: string;
  matchedHeading: HeadingCache | null;
  treeSelfEl: HTMLElement;
}

export class OutlineIntegrationManager {
  private host: OutlineIntegrationHost;
  // Keyed by outline container so each one gets its listeners exactly once and
  // they can be removed again when the plugin unloads.
  private boundContainers = new Map<HTMLElement, OutlineListeners>();
  private activePopoverEl: HTMLElement | null = null;
  private documentClickHandler: (e: MouseEvent) => void;
  private documentKeyHandler: (e: KeyboardEvent) => void;

  constructor(host: OutlineIntegrationHost) {
    this.host = host;

    this.documentClickHandler = (e: MouseEvent) => {
      if (this.activePopoverEl) {
        if (!this.activePopoverEl.contains(e.target as Node)) {
          this.closePopover();
        }
      }
    };

    this.documentKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.activePopoverEl) {
        this.closePopover();
      }
    };

    document.addEventListener("pointerdown", this.documentClickHandler, true);
    document.addEventListener("keydown", this.documentKeyHandler, true);
  }

  public bindOutlineLeaves() {
    if (!this.host.data.settings.enableOutlineIntegration) {
      return;
    }

    const outlineLeaves = this.host.app.workspace.getLeavesOfType("outline");
    outlineLeaves.forEach((leaf) => {
      const containerEl = leaf.view?.containerEl;
      if (!containerEl || this.boundContainers.has(containerEl)) {
        return;
      }

      // Single click: navigates natively (or shows popover if user configured popover-on-click)
      const onClick = (evt: MouseEvent) => this.handleOutlineClick(leaf, evt);
      // Double click: instantly launches Topic Typing for the selected section
      const onDblClick = (evt: MouseEvent) => {
        void this.handleOutlineDblClick(leaf, evt);
      };

      containerEl.addEventListener("click", onClick, true);
      containerEl.addEventListener("dblclick", onDblClick, true);
      this.boundContainers.set(containerEl, { onClick, onDblClick });
    });
  }

  private resolveHeading(
    leaf: WorkspaceLeaf,
    target: HTMLElement
  ): ResolvedHeading | null {
    // If user clicked the collapse chevron, let Obsidian expand/collapse normally
    if (target.closest(".collapse-icon") || target.closest(".tree-item-icon")) {
      return null;
    }

    const treeSelfEl = target.closest<HTMLElement>(".tree-item-self");
    if (!treeSelfEl) {
      return null;
    }

    const viewWithFile = leaf.view as View & { file?: TFile | null };
    const activeFile: TFile | null =
      viewWithFile.file || this.host.app.workspace.getActiveFile();
    if (!activeFile) {
      return null;
    }

    const container = leaf.view.containerEl;
    const allSelfEls = Array.from(
      container.querySelectorAll(".tree-item-self")
    );
    const headingIndex = allSelfEls.indexOf(treeSelfEl);

    const fileCache = this.host.app.metadataCache.getFileCache(activeFile);
    const headings = fileCache?.headings || [];
    const matchedHeading =
      headingIndex >= 0 && headingIndex < headings.length
        ? headings[headingIndex]
        : null;

    const headingTitle =
      matchedHeading?.heading ||
      treeSelfEl.querySelector(".tree-item-inner")?.textContent?.trim() ||
      "";

    return { activeFile, headingTitle, matchedHeading, treeSelfEl };
  }

  /**
   * Double-tap / double-click on any outline item: instantly launches typing session for that section!
   */
  private async handleOutlineDblClick(leaf: WorkspaceLeaf, evt: MouseEvent) {
    if (!this.host.data.settings.enableOutlineIntegration) {
      return;
    }
    if (!this.host.data.settings.outlineDoubleClickToType) {
      return;
    }
    if (evt.button !== 0 || evt.ctrlKey || evt.metaKey || evt.altKey) {
      return;
    }

    const target = evt.target as HTMLElement | null;
    if (!target) return;

    const resolved = this.resolveHeading(leaf, target);
    if (!resolved || !resolved.headingTitle) return;

    evt.preventDefault();
    evt.stopPropagation();

    this.closePopover();
    await this.host.startTypingSession(resolved.activeFile, "section", [
      resolved.headingTitle,
    ]);
  }

  /**
   * Single click: If popover-on-click is disabled, passes through so Obsidian natively jumps to heading.
   * If popover-on-click is enabled, displays the action popover.
   */
  private handleOutlineClick(leaf: WorkspaceLeaf, evt: MouseEvent) {
    if (!this.host.data.settings.enableOutlineIntegration) {
      return;
    }

    // If popover is NOT enabled, let single click navigate natively to the exact topic!
    if (!this.host.data.settings.outlineShowPopoverOnClick) {
      return;
    }

    if (evt.button !== 0 || evt.ctrlKey || evt.metaKey || evt.altKey) {
      return;
    }

    const target = evt.target as HTMLElement | null;
    if (!target) return;

    if (target.closest(".mt-outline-popover")) {
      return;
    }

    const resolved = this.resolveHeading(leaf, target);
    if (!resolved) return;

    evt.preventDefault();
    evt.stopPropagation();

    this.showPopover(
      resolved.treeSelfEl,
      resolved.activeFile,
      resolved.headingTitle,
      resolved.matchedHeading
    );
  }

  private showPopover(
    anchorEl: HTMLElement,
    file: TFile,
    headingTitle: string,
    headingObj: HeadingCache | null
  ) {
    this.closePopover();

    const popover = document.body.createDiv({ cls: "mt-outline-popover" });

    // 1. Heading Header Pill
    const headerEl = popover.createDiv({ cls: "mt-outline-popover-header" });
    headerEl.createSpan({
      cls: "mt-outline-popover-title",
      text: headingTitle || "Section",
    });

    // 2. Option: <Topic Typing>
    const typeBtn = popover.createEl("button", {
      cls: "mt-outline-popover-btn is-primary",
    });
    typeBtn.createSpan({ cls: "mt-outline-btn-icon", text: "⚡" });
    const typeTextWrap = typeBtn.createDiv({ cls: "mt-outline-btn-text" });
    typeTextWrap.createSpan({
      cls: "mt-outline-btn-label",
      text: "Topic Typing",
    });
    typeTextWrap.createSpan({
      cls: "mt-outline-btn-sub",
      text: "Start typing this section",
    });

    typeBtn.onclick = (e) => {
      e.stopPropagation();
      this.closePopover();
      void this.host.startTypingSession(file, "section", [headingTitle]);
    };

    // 3. Option: <Show>
    const showBtn = popover.createEl("button", {
      cls: "mt-outline-popover-btn",
    });
    showBtn.createSpan({ cls: "mt-outline-btn-icon", text: "👁" });
    const showTextWrap = showBtn.createDiv({ cls: "mt-outline-btn-text" });
    showTextWrap.createSpan({ cls: "mt-outline-btn-label", text: "Show" });
    showTextWrap.createSpan({
      cls: "mt-outline-btn-sub",
      text: "Navigate to heading in note",
    });

    showBtn.onclick = (e) => {
      e.stopPropagation();
      this.closePopover();
      this.navigateToHeading(file, headingTitle, headingObj);
    };

    this.activePopoverEl = popover;

    // Position popover right below anchorEl
    const rect = anchorEl.getBoundingClientRect();
    const popoverWidth = 220;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - popoverWidth - 12);
    }
    let top = rect.bottom + 4;
    if (top + 130 > window.innerHeight) {
      top = Math.max(12, rect.top - 130 - 4);
    }

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  private navigateToHeading(file: TFile, headingTitle: string, headingObj: HeadingCache | null) {
    const mdLeaves = this.host.app.workspace.getLeavesOfType("markdown");
    let found = false;

    for (const leaf of mdLeaves) {
      const view = leaf.view as MarkdownView;
      if (view?.file?.path === file.path) {
        this.host.app.workspace.setActiveLeaf(leaf, { focus: true });
        if (headingObj?.position && view.editor) {
          const line = headingObj.position.start.line;
          view.editor.setCursor({ line, ch: 0 });
          view.editor.scrollIntoView(
            { from: { line, ch: 0 }, to: { line, ch: 0 } },
            true
          );
        }
        found = true;
        break;
      }
    }

    if (!found) {
      void this.host.app.workspace.openLinkText(
        `${file.path}#${headingTitle}`,
        file.path,
        false
      );
    }
  }

  public closePopover() {
    if (this.activePopoverEl) {
      this.activePopoverEl.remove();
      this.activePopoverEl = null;
    }
  }

  public destroy() {
    this.closePopover();
    document.removeEventListener(
      "pointerdown",
      this.documentClickHandler,
      true
    );
    document.removeEventListener("keydown", this.documentKeyHandler, true);

    this.boundContainers.forEach((listeners, containerEl) => {
      containerEl.removeEventListener("click", listeners.onClick, true);
      containerEl.removeEventListener("dblclick", listeners.onDblClick, true);
    });
    this.boundContainers.clear();
  }
}
