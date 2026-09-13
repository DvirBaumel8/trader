const META_BLOCK_END = /\[\/[A-Z_]+\]/;

/**
 * Wraps a `completeStream()` call whose response starts with a
 * `[SOMETHING_META]...[/SOMETHING_META]` block (Trade Review's
 * `[REVIEW_META]`, Symbol Pattern's `[PATTERN_META]`) that must never reach
 * the screen raw — it exists to be parsed, not read. Buffers and yields
 * nothing until the closing tag is seen, then yields the rest of the stream
 * untouched.
 *
 * Returns the complete raw text (meta block included) as the generator's
 * own return value, so a caller runs its EXISTING parser
 * (`parseReviewMeta`, `parsePatternMeta`) against it exactly as the
 * non-streaming path already does — no second, incremental parser to keep
 * in sync with the first.
 */
export async function* streamAfterMetaBlock(
  stream: AsyncIterable<string>,
): AsyncGenerator<string, string> {
  let buffer = '';
  let full = '';
  let inBody = false;

  for await (const delta of stream) {
    full += delta;
    if (inBody) {
      yield delta;
      continue;
    }
    buffer += delta;
    const match = META_BLOCK_END.exec(buffer);
    if (match) {
      inBody = true;
      const rest = buffer.slice(match.index + match[0].length);
      if (rest) yield rest;
    }
  }

  return full;
}
