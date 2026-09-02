import { Fragment } from 'react';
import { parseMarkdown, type InlineSegment, type MarkdownBlock } from '../lib/markdown';

/**
 * Renders the AI summary's markdown subset as React elements — never
 * `dangerouslySetInnerHTML`. The model's output is untrusted text; parsing
 * it to a structure first and mapping that structure to elements means
 * there is no path from "text the model wrote" to "HTML the app renders".
 * Unknown or malformed syntax already degrades to plain text inside
 * `parseMarkdown` itself, so this component never needs to guard against it.
 */
function Inline({ segments }: { segments: InlineSegment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.bold ? (
          <strong key={i} className="font-semibold text-text">
            {segment.text}
          </strong>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h3 className="text-sm font-semibold text-text">
          <Inline segments={block.inline} />
        </h3>
      ) : (
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
          <Inline segments={block.inline} />
        </h4>
      );
    case 'list':
      return (
        <ul className="list-disc space-y-1 pl-4 marker:text-muted">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline segments={item} />
            </li>
          ))}
        </ul>
      );
    case 'paragraph':
      return (
        <p>
          <Inline segments={block.inline} />
        </p>
      );
  }
}

/** Mobile-first: readable line length and generous vertical rhythm between blocks, using the existing theme tokens rather than introducing new ones. */
export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-text">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
