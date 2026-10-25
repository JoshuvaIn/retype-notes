import { describe, it, expect, beforeEach, vi } from "vitest";
import { OutlineIntegrationManager } from "../src/ui/outlineIntegration";

function polyfillObsidianDom() {
  const proto = HTMLElement.prototype as any;
  if (!proto.empty) {
    proto.empty = function () {
      this.innerHTML = "";
    };
  }
  if (!proto.addClass) {
    proto.addClass = function (...classes: string[]) {
      classes.forEach((c) => {
        if (c) this.classList.add(...c.split(/\s+/).filter(Boolean));
      });
    };
  }
  if (!proto.removeClass) {
    proto.removeClass = function (...classes: string[]) {
      classes.forEach((c) => {
        if (c) this.classList.remove(...c.split(/\s+/).filter(Boolean));
      });
    };
  }
  if (!proto.toggleClass) {
    proto.toggleClass = function (cls: string, state?: boolean) {
      this.classList.toggle(cls, state);
    };
  }
  if (!proto.setText) {
    proto.setText = function (text: string) {
      this.textContent = text;
    };
  }
  if (!proto.createEl) {
    proto.createEl = function (tag: string, opts?: any) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.type) (el as any).type = opts.type;
      if (opts?.attr) {
        for (const [k, v] of Object.entries(opts.attr)) {
          el.setAttribute(k, String(v));
        }
      }
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createDiv) {
    proto.createDiv = function (opts?: any) {
      return this.createEl("div", opts);
    };
  }
  if (!proto.createSpan) {
    proto.createSpan = function (opts?: any) {
      return this.createEl("span", opts);
    };
  }
}

describe("OutlineIntegrationManager", () => {
  let mockFile: any;
  let mockLeaf: any;
  let mockApp: any;
  let mockHost: any;
  let outlineContainer: HTMLElement;
  let itemSelf1: HTMLElement;
  let itemSelf2: HTMLElement;

  beforeEach(() => {
    polyfillObsidianDom();
    document.body.innerHTML = "";

    mockFile = {
      path: "Notes/Relay Basics.md",
      basename: "Relay Basics",
      extension: "md",
    };

    outlineContainer = document.createElement("div");
    outlineContainer.className = "outline";

    // Item 1: Relay Basics
    const treeItem1 = outlineContainer.createDiv({ cls: "tree-item" });
    itemSelf1 = treeItem1.createDiv({ cls: "tree-item-self" });
    itemSelf1.createDiv({ cls: "collapse-icon" });
    itemSelf1.createDiv({ cls: "tree-item-inner", text: "Relay Basics" });

    // Item 2: Purpose
    const treeItem2 = outlineContainer.createDiv({ cls: "tree-item" });
    itemSelf2 = treeItem2.createDiv({ cls: "tree-item-self" });
    itemSelf2.createDiv({ cls: "tree-item-inner", text: "Purpose" });

    mockLeaf = {
      view: {
        containerEl: outlineContainer,
        file: mockFile,
      },
    };

    mockApp = {
      workspace: {
        getLeavesOfType: (type: string) => (type === "outline" ? [mockLeaf] : []),
        getActiveFile: () => mockFile,
        openLinkText: vi.fn(),
      },
      metadataCache: {
        getFileCache: () => ({
          headings: [
            { heading: "Relay Basics", level: 1, position: { start: { line: 0 } } },
            { heading: "Purpose", level: 2, position: { start: { line: 10 } } },
          ],
        }),
      },
    };

    mockHost = {
      app: mockApp,
      data: {
        settings: {
          enableOutlineIntegration: true,
          outlineDoubleClickToType: true,
          outlineShowPopoverOnClick: false,
        },
      },
      startTypingSession: vi.fn(),
    };
  });

  it("double-click on outline heading immediately starts typing session for that section", async () => {
    const manager = new OutlineIntegrationManager(mockHost);
    manager.bindOutlineLeaves();

    // Double-click item 2: "Purpose"
    const dblClickEvent = new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    itemSelf2.dispatchEvent(dblClickEvent);

    expect(mockHost.startTypingSession).toHaveBeenCalledWith(
      mockFile,
      "section",
      ["Purpose"]
    );

    // No popover should be open
    expect(document.body.querySelector(".mt-outline-popover")).toBeNull();

    manager.destroy();
  });

  it("single click passes through natively when popover is not enabled", () => {
    mockHost.data.settings.outlineShowPopoverOnClick = false;
    const manager = new OutlineIntegrationManager(mockHost);
    manager.bindOutlineLeaves();

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    itemSelf2.dispatchEvent(clickEvent);

    // Click was not intercepted by popover
    expect(clickEvent.defaultPrevented).toBe(false);
    expect(document.body.querySelector(".mt-outline-popover")).toBeNull();

    manager.destroy();
  });

  it("single click shows popover when outlineShowPopoverOnClick is enabled", () => {
    mockHost.data.settings.outlineShowPopoverOnClick = true;
    const manager = new OutlineIntegrationManager(mockHost);
    manager.bindOutlineLeaves();

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    itemSelf2.dispatchEvent(clickEvent);

    const popover = document.body.querySelector(".mt-outline-popover");
    expect(popover).not.toBeNull();
    const titleEl = popover?.querySelector(".mt-outline-popover-title");
    expect(titleEl?.textContent).toBe("Purpose");

    manager.destroy();
  });

  it("does not intercept double clicks on collapse icons", () => {
    const manager = new OutlineIntegrationManager(mockHost);
    manager.bindOutlineLeaves();

    const collapseIcon = itemSelf1.querySelector(".collapse-icon") as HTMLElement;
    collapseIcon.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 })
    );

    expect(mockHost.startTypingSession).not.toHaveBeenCalled();

    manager.destroy();
  });
});
