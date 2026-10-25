import { PluginSettings } from "../types";
import { isPunctuation } from "../engine/chars";

export interface TypeableChar {
  char: string;
  expected: string;
  blockIndex: number;
  isGhost: boolean;     // e.g. for ghost mode (links, code dim)
  isHeading: boolean;
  headingPath: string;  // e.g. "Relay Basics"
  spanRef?: HTMLElement;
}

export interface TypeableBlock {
  blockIndex: number;
  blockEl: HTMLElement;
  headingPath: string;
  chars: TypeableChar[];
}

export interface ExtractResult {
  blocks: TypeableBlock[];
  allChars: TypeableChar[];
}

export interface TextChunk {
  chunkIndex: number;
  startCharIdx: number; // inclusive index in allChars
  endCharIdx: number;   // inclusive index in allChars
  peekText: string;     // 1-line lookahead preview of the NEXT chunk
}

const BLOCK_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "UL",
  "OL",
]);

/**
 * Walks a rendered container element (from MarkdownRenderer.render)
 * and extracts typeable characters based on settings and style modes.
 * Also wraps text nodes in-place into spans so rich Preview Mode formatting
 * (callouts, bold, highlights, headings, lists) stays intact.
 */
export function extractTypeableChars(
  container: HTMLElement,
  options: {
    contentStyle: "text" | "ghost" | "exact" | "code";
    settings: PluginSettings;
    targetHeadingPath?: string;
    targetHeadingPaths?: string[];
  }
): ExtractResult {
  const {
    contentStyle,
    settings,
    targetHeadingPath,
    targetHeadingPaths,
  } = options;

  const allowedHeadings =
    targetHeadingPaths && targetHeadingPaths.length > 0
      ? new Set(targetHeadingPaths.map((h) => h.trim()))
      : targetHeadingPath
      ? new Set([targetHeadingPath.trim()])
      : null;

  // 1. Remove skipped elements completely from DOM
  const selectorsToRemove = [
    ".frontmatter",
    ".frontmatter-container",
    ".metadata-container",
    "table",
    "img",
    ".internal-embed",
    ".math",
    ".tag",
    ".footnote-ref",
    ".footnotes",
    "hr",
    ".heading-collapse-indicator",
    ".edit-block-button",
    ".copy-code-button",
  ];

  selectorsToRemove.forEach((sel) => {
    container.querySelectorAll(sel).forEach((el) => el.remove());
  });

  // Highlight handling if skipHighlightWords is enabled
  if (settings.skipHighlightWords) {
    container.querySelectorAll("mark").forEach((el) => el.remove());
  }

  // Callout handling: callout title is stripped, callout body remains inside styled callout box
  container.querySelectorAll(".callout").forEach((callout) => {
    if (settings.skipCalloutBody) {
      callout.remove();
      return;
    }
    const title = callout.querySelector(".callout-title");
    if (title) title.remove();
  });

  // Links handling:
  // - In "ghost" mode, links are dimmed (.mt-ghost) and skipped by the caret.
  // - In "text", "exact", and "code" modes, external raw URLs are removed, while readable link labels are unwrapped/kept so sentences never have missing words (unless the user explicitly wants links stripped).
  container.querySelectorAll("a, .internal-link, .external-link").forEach((link) => {
    if (contentStyle === "ghost") {
      link.classList.add("mt-ghost");
    } else {
      link.remove();
    }
  });

  // Code handling
  container.querySelectorAll("pre, code").forEach((codeEl) => {
    if (contentStyle === "code") {
      // kept as normal typeable
    } else if (contentStyle === "ghost") {
      codeEl.classList.add("mt-ghost");
    } else {
      codeEl.remove();
    }
  });

  const stripSymbolsInTextMode =
    contentStyle === "text" && !settings.requirePunctuation;

  // 2. Walk block elements in document order
  const blockElements = Array.from(
    container.querySelectorAll<HTMLElement>(
      "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre"
    )
  );

  const blocks: TypeableBlock[] = [];
  const allChars: TypeableChar[] = [];

  let currentHeadingPath = "";
  let blockIndexCounter = 0;

  for (const blockEl of blockElements) {
    if (!container.contains(blockEl)) continue;

    const tagName = blockEl.tagName.toLowerCase();
    const isHeadingEl = /^h[1-6]$/.test(tagName);

    // If this is a blockquote or li that only wraps inner <p> blocks and has no direct text of its own, skip it as a block container
    if ((tagName === "blockquote" || tagName === "li") && hasOnlyNestedBlocks(blockEl)) {
      continue;
    }

    // IMPORTANT: Always update currentHeadingPath FIRST before checking allowedHeadings or skipHeadingText!
    if (isHeadingEl) {
      const headingText = (blockEl.textContent || "").trim();
      currentHeadingPath = headingText;
    }

    // Filter by selected TOC section(s) BEFORE removing skipped headings
    if (allowedHeadings) {
      const matchesSection =
        currentHeadingPath !== "" &&
        Array.from(allowedHeadings).some(
          (target) =>
            currentHeadingPath === target ||
            currentHeadingPath.startsWith(target)
        );
      if (!matchesSection) {
        blockEl.remove();
        continue;
      }
    }

    // Now if skipHeadingText is enabled, remove the heading element itself while keeping currentHeadingPath active for its section paragraphs
    if (isHeadingEl && settings.skipHeadingText) {
      blockEl.remove();
      continue;
    }

    const blockChars: TypeableChar[] = [];
    let prevCharWasSpace = true; // Trim leading spaces in block

    // Collect text nodes to replace in-place so inline tags (<strong>, <mark>, <em>) remain intact
    const textNodeReplacements: Array<{
      node: Text;
      chars: TypeableChar[];
    }> = [];

    walkInlineTextNodes(blockEl, (textNode, isGhost) => {
      const raw = textNode.textContent || "";
      if (!raw) return;

      const nodeChars: TypeableChar[] = [];
      for (let i = 0; i < raw.length; i++) {
        let ch = raw[i];

        if (/\s/.test(ch)) {
          if (prevCharWasSpace) {
            continue;
          }
          ch = " ";
          prevCharWasSpace = true;
        } else if (stripSymbolsInTextMode && isPunctuation(ch)) {
          // Strip punctuation cleanly in Text (words-only) mode so no stray symbols remain
          continue;
        } else {
          prevCharWasSpace = false;
        }

        let expectedChar = ch;
        if (!settings.caseSensitive && contentStyle !== "exact") {
          expectedChar = expectedChar.toLowerCase();
        }

        const typeableChar: TypeableChar = {
          char: ch,
          expected: expectedChar,
          blockIndex: blockIndexCounter,
          isGhost,
          isHeading: isHeadingEl,
          headingPath: currentHeadingPath,
        };

        nodeChars.push(typeableChar);
        blockChars.push(typeableChar);
      }

      // Clean up orphaned space before punctuation when inline elements (math/links) were removed
      if (
        !stripSymbolsInTextMode &&
        blockChars.length >= 2 &&
        blockChars[blockChars.length - 1].char === " " &&
        /^[.,;:!?)]$/.test(raw.trimStart()[0] || "")
      ) {
        const removedSpace = blockChars.pop()!;
        for (const prevRep of textNodeReplacements) {
          const sIdx = prevRep.chars.indexOf(removedSpace);
          if (sIdx !== -1) prevRep.chars.splice(sIdx, 1);
        }
        prevCharWasSpace = false;
      }

      if (nodeChars.length > 0) {
        textNodeReplacements.push({ node: textNode, chars: nodeChars });
      } else {
        textNode.textContent = "";
      }
    });

    // Trim trailing space inside block if any
    while (
      blockChars.length > 0 &&
      blockChars[blockChars.length - 1].char === " "
    ) {
      const popped = blockChars.pop()!;
      for (const rep of textNodeReplacements) {
        const idx = rep.chars.indexOf(popped);
        if (idx !== -1) {
          rep.chars.splice(idx, 1);
        }
      }
    }

    if (blockChars.length === 0) {
      blockEl.remove();
      continue;
    }

    // Replace text nodes in-place with character spans
    for (const rep of textNodeReplacements) {
      const frag = container.ownerDocument.createDocumentFragment();
      for (const c of rep.chars) {
        const span = container.ownerDocument.createElement("span");
        span.textContent = c.char;
        span.className = getInitialCharClass(c);
        c.spanRef = span;
        frag.appendChild(span);
      }
      rep.node.parentNode?.replaceChild(frag, rep.node);
    }

    for (const c of blockChars) {
      allChars.push(c);
    }

    blocks.push({
      blockIndex: blockIndexCounter,
      blockEl,
      headingPath: currentHeadingPath,
      chars: blockChars,
    });

    blockIndexCounter++;
  }

  // Add a single space separator at the end of every block that has typeable chars EXCEPT the final block
  for (let bIdx = 0; bIdx < blocks.length - 1; bIdx++) {
    const block = blocks[bIdx];
    const hasTypeable = block.chars.some((c) => !c.isGhost);
    const lastChar = block.chars[block.chars.length - 1];
    if (hasTypeable && lastChar && lastChar.char !== " ") {
      const spaceSpan = container.ownerDocument.createElement("span");
      spaceSpan.textContent = " ";
      spaceSpan.className = "mt-char mt-pending mt-space";

      const spaceChar: TypeableChar = {
        char: " ",
        expected: " ",
        blockIndex: block.blockIndex,
        isGhost: false,
        isHeading: false,
        headingPath: block.headingPath,
        spanRef: spaceSpan,
      };

      block.blockEl.appendChild(spaceSpan);
      block.chars.push(spaceChar);

      // Insert into allChars right after the last char of this block
      const insertPos = allChars.indexOf(lastChar);
      if (insertPos !== -1) {
        allChars.splice(insertPos + 1, 0, spaceChar);
      } else {
        allChars.push(spaceChar);
      }
    }
  }

  // Clean up any empty callouts or lists left after section filtering
  container.querySelectorAll(".callout, ul, ol, blockquote").forEach((el) => {
    if (!(el.textContent || "").trim()) {
      el.remove();
    }
  });

  return { blocks, allChars };
}

/**
 * Converts extracted TypeableChar array into clean space-separated words for 10FastFingers mode
 * and accurate word count display.
 */
export function extractWordsFromChars(allChars: TypeableChar[]): string[] {
  const activeText = allChars
    .filter((c) => !c.isGhost)
    .map((c) => c.char)
    .join("");
  return activeText
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * Splits `allChars` into smart 5–7 line chunks (~65 chars per line),
 * breaking cleanly at sentence boundaries or word spaces.
 */
export function buildSmartChunks(
  allChars: TypeableChar[],
  linesPerChunk: number = 6,
  smartSentenceBreak: boolean = true
): TextChunk[] {
  if (allChars.length === 0) return [];

  const targetCharsPerChunk = Math.max(120, linesPerChunk * 65);
  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < allChars.length) {
    if (allChars.length - start <= targetCharsPerChunk * 1.18) {
      chunks.push({
        chunkIndex: chunkIndex++,
        startCharIdx: start,
        endCharIdx: allChars.length - 1,
        peekText: "",
      });
      break;
    }

    let idealEnd = Math.min(allChars.length - 1, start + targetCharsPerChunk);
    let chosenEnd = -1;

    // 1. If smartSentenceBreak is enabled, look within +/- 75 chars of idealEnd for a sentence end or block boundary
    if (smartSentenceBreak) {
      const searchMin = Math.max(start + 80, idealEnd - 75);
      const searchMax = Math.min(allChars.length - 2, idealEnd + 75);

      for (let i = idealEnd; i <= searchMax; i++) {
        if (isSentenceOrBlockBreak(allChars, i)) {
          chosenEnd = i;
          break;
        }
      }
      if (chosenEnd === -1) {
        for (let i = idealEnd; i >= searchMin; i--) {
          if (isSentenceOrBlockBreak(allChars, i)) {
            chosenEnd = i;
            break;
          }
        }
      }
    }

    // 2. Fallback: break at the nearest space character so we never split a word in half
    if (chosenEnd === -1) {
      for (let i = idealEnd; i < allChars.length; i++) {
        if (allChars[i].char === " ") {
          chosenEnd = i;
          break;
        }
      }
    }
    if (chosenEnd === -1) {
      chosenEnd = allChars.length - 1;
    }

    chunks.push({
      chunkIndex: chunkIndex++,
      startCharIdx: start,
      endCharIdx: chosenEnd,
      peekText: "",
    });

    start = chosenEnd + 1;
  }

  // Populate 1-line lookahead peekText (~70 chars) for each chunk except the last
  for (let c = 0; c < chunks.length - 1; c++) {
    const nextChunk = chunks[c + 1];
    const peekSlice = allChars
      .slice(nextChunk.startCharIdx, Math.min(nextChunk.endCharIdx + 1, nextChunk.startCharIdx + 72))
      .map((ch) => ch.char)
      .join("")
      .trim();
    chunks[c].peekText = peekSlice ? `${peekSlice} …` : "";
  }

  return chunks;
}

function isSentenceOrBlockBreak(allChars: TypeableChar[], idx: number): boolean {
  const c = allChars[idx];
  const prev = idx > 0 ? allChars[idx - 1] : null;
  const next = idx + 1 < allChars.length ? allChars[idx + 1] : null;
  if (!c) return false;

  // Block boundary space
  if (c.char === " " && next && next.blockIndex !== c.blockIndex) {
    return true;
  }
  // Space right after sentence-ending punctuation
  if (c.char === " " && prev && /[.!?]/.test(prev.char)) {
    return true;
  }
  // In Text mode (where periods are stripped), a capital letter after a space often starts a new sentence
  if (c.char === " " && next && /^[A-Z]$/.test(next.char)) {
    return true;
  }
  return false;
}

function getInitialCharClass(c: TypeableChar): string {
  const classes = ["mt-char"];
  if (c.char === " ") {
    classes.push("mt-space");
  }
  if (c.isGhost) {
    classes.push("mt-ghost");
    return classes.join(" ");
  }
  classes.push("mt-pending");
  return classes.join(" ");
}

function hasOnlyNestedBlocks(el: HTMLElement): boolean {
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE && (child.textContent || "").trim().length > 0) {
      return false;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      if (!BLOCK_TAGS.has(childEl.tagName)) {
        return false;
      }
    }
  }
  return el.querySelector("p, h1, h2, h3, h4, h5, h6, li, pre") !== null;
}

function walkInlineTextNodes(
  node: Node,
  callback: (textNode: Text, isGhost: boolean) => void,
  inheritedGhost: boolean = false,
  isRootBlock: boolean = true
) {
  if (node.nodeType === Node.TEXT_NODE) {
    callback(node as Text, inheritedGhost);
    return;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    // Do not descend into nested block elements; they will be processed in their own turn
    if (!isRootBlock && BLOCK_TAGS.has(el.tagName)) {
      return;
    }

    const isGhost = inheritedGhost || el.classList.contains("mt-ghost");

    const children = Array.from(el.childNodes);
    for (const child of children) {
      walkInlineTextNodes(child, callback, isGhost, false);
    }
  }
}
