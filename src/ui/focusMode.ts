import { App } from "obsidian";

export interface FocusModeOptions {
  enabled: boolean;
  left: boolean;
  right: boolean;
}

// Obsidian keeps the sidebars on the workspace but does not type them publicly.
interface CollapsibleSplit {
  collapsed: boolean;
  collapse?: () => void;
  expand?: () => void;
}

type WorkspaceWithSidebars = App["workspace"] & {
  leftSplit?: CollapsibleSplit;
  rightSplit?: CollapsibleSplit;
};

/**
 * Automatically collapses Obsidian's left and right sidebars when typing begins,
 * and restores only the panels that were open before the session started.
 */
export class FocusMode {
  private active: boolean = false;
  private collapsedLeft: boolean = false;
  private collapsedRight: boolean = false;

  constructor(private app: App) {}

  public enter(opts: FocusModeOptions) {
    if (!opts.enabled || this.active) return;

    const workspace = this.app.workspace as WorkspaceWithSidebars;
    const leftSplit = workspace.leftSplit;
    const rightSplit = workspace.rightSplit;

    this.collapsedLeft = Boolean(opts.left && leftSplit && !leftSplit.collapsed);
    this.collapsedRight = Boolean(opts.right && rightSplit && !rightSplit.collapsed);

    if (this.collapsedLeft) {
      leftSplit.collapse?.();
    }
    if (this.collapsedRight) {
      rightSplit.collapse?.();
    }

    this.active = true;
  }

  public exit() {
    if (!this.active) return;

    const workspace = this.app.workspace as WorkspaceWithSidebars;
    const leftSplit = workspace.leftSplit;
    const rightSplit = workspace.rightSplit;

    if (this.collapsedLeft && leftSplit?.collapsed) {
      leftSplit.expand?.();
    }
    if (this.collapsedRight && rightSplit?.collapsed) {
      rightSplit.expand?.();
    }

    this.collapsedLeft = false;
    this.collapsedRight = false;
    this.active = false;
  }

  public isActive(): boolean {
    return this.active;
  }
}
