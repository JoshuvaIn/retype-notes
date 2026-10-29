// Obsidian exposes createEl / createDiv / createSpan as globals at runtime.
// Mirror that for jsdom so the source code can call them the same way.
Object.assign(globalThis, {
  createEl: (tag: string, opts?: { cls?: string; text?: string }) => {
    const el = document.createElement(tag);
    if (opts?.cls) el.className = opts.cls;
    if (opts?.text) el.textContent = opts.text;
    return el;
  },
  createDiv: (opts?: { cls?: string; text?: string }) => globalThis.createEl("div", opts),
  createSpan: (opts?: { cls?: string; text?: string }) => globalThis.createEl("span", opts),
});

// Obsidian adds setCssProps to HTMLElement; mirror it for the jsdom DOM.
if (!HTMLElement.prototype.setCssProps) {
  HTMLElement.prototype.setCssProps = function (props: Record<string, string>) {
    for (const [name, value] of Object.entries(props)) {
      if (name.startsWith("--")) this.style.setProperty(name, value);
      else (this.style as unknown as Record<string, string>)[name] = value;
    }
  };
}
