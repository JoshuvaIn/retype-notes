import { describe, it, expect, beforeEach } from "vitest";
import { FocusMode } from "../src/ui/focusMode";

describe("FocusMode (Auto Toggle sidebars)", () => {
  let mockLeft: { collapsed: boolean; collapse: () => void; expand: () => void };
  let mockRight: { collapsed: boolean; collapse: () => void; expand: () => void };
  let mockApp: any;

  beforeEach(() => {
    mockLeft = {
      collapsed: false,
      collapse: () => { mockLeft.collapsed = true; },
      expand: () => { mockLeft.collapsed = false; },
    };
    mockRight = {
      collapsed: false,
      collapse: () => { mockRight.collapsed = true; },
      expand: () => { mockRight.collapsed = false; },
    };
    mockApp = {
      workspace: {
        leftSplit: mockLeft,
        rightSplit: mockRight,
      },
    };
  });

  it("collapses open sidebars on enter and restores them on exit", () => {
    const focus = new FocusMode(mockApp);
    expect(mockLeft.collapsed).toBe(false);
    expect(mockRight.collapsed).toBe(false);

    focus.enter({ enabled: true, left: true, right: true });
    expect(mockLeft.collapsed).toBe(true);
    expect(mockRight.collapsed).toBe(true);
    expect(focus.isActive()).toBe(true);

    focus.exit();
    expect(mockLeft.collapsed).toBe(false);
    expect(mockRight.collapsed).toBe(false);
    expect(focus.isActive()).toBe(false);
  });

  it("preserves sidebars that were already collapsed prior to typing", () => {
    mockLeft.collapsed = true; // User had already closed left sidebar
    mockRight.collapsed = false;

    const focus = new FocusMode(mockApp);
    focus.enter({ enabled: true, left: true, right: true });

    expect(mockLeft.collapsed).toBe(true);
    expect(mockRight.collapsed).toBe(true);

    focus.exit();
    // Left was already closed so it should stay closed; right was open so it should re-open
    expect(mockLeft.collapsed).toBe(true);
    expect(mockRight.collapsed).toBe(false);
  });

  it("does nothing when autoToggle is disabled in settings", () => {
    const focus = new FocusMode(mockApp);
    focus.enter({ enabled: false, left: true, right: true });

    expect(mockLeft.collapsed).toBe(false);
    expect(mockRight.collapsed).toBe(false);
    expect(focus.isActive()).toBe(false);
  });
});
