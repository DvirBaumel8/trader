/**
 * A hand-rolled parser for the tiny markdown subset the AI summary model
 * actually produces: `##`/`###` headings, `**bold**` inline, `*`/`-` bullet
 * lists, paragraphs, and blank-line separation. Nothing else — no links, no
 * tables, no nesting, no italics. Deliberately not a dependency: this repo
 * already hand-rolls its SVG charts, and a markdown subset this small is a
 * similar-sized problem (see `frontend/src/lib/candleScale.ts` for the same
 * call made about charting).
 *
 * Pure and side-effect free so it can be fixture-tested without React. The
 * component that renders these blocks (`components/Markdown.tsx`) turns
 * them into React elements directly — never `dangerouslySetInnerHTML` — so
 * text from the model is always treated as data, never markup.
 *
 * Anything that doesn't match a known shape falls through to plain text,
 * hashes/asterisks and all, rather than throwing or dropping content.
 */

export interface InlineSegment {
  text: string;
  bold: boolean;
}

export type MarkdownBlock =
  | { kind: 'heading'; level: 2 | 3; inline: InlineSegment[] }
  | { kind: 'paragraph'; inline: InlineSegment[] }
  | { kind: 'list'; items: InlineSegment[][] };

const HEADING_RE = /^(#{2,3})\s+(.*)$/;
const LIST_ITEM_RE = /^[*-]\s+(.*)$/;
const BOLD_RE = /\*\*(.+?)\*\*/g;

/** Splits a line of text into plain/bold runs. `**` with no matching close is left literal. */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  BOLD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BOLD_RE.exec(text))) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    if (match[1]) {
      segments.push({ text: match[1], bold: true });
    }
    lastIndex = BOLD_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false });
  }

  return segments.length > 0 ? segments : [{ text: '', bold: false }];
}

/**
 * Line-by-line block parser. Headings and list items are recognised only at
 * the start of a trimmed line; every other non-blank line accumulates into a
 * paragraph, joined with spaces so hard-wrapped prose reflows as one block.
 * A blank line, a heading, or switching between list/paragraph always closes
 * whatever was open.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];

  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', inline: parseInline(text) });
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push({ kind: 'list', items: listItems.map((item) => parseInline(item)) });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length === 2 ? 2 : 3;
      blocks.push({ kind: 'heading', level, inline: parseInline(heading[2].trim()) });
      continue;
    }

    const listItem = LIST_ITEM_RE.exec(line);
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}
