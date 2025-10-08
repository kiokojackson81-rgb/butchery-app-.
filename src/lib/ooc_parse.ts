// src/lib/ooc_parse.ts
// Helpers to parse and strip OOC blocks from GPT replies.

/**
 * Extract the first OOC JSON block from text.
 * Supports both variants:
 * - <<<OOC> { ... } </OOC>>>
 * - <OOC> { ... } </OOC>
 */
export function parseOOCBlock(text: string): any | null {
  try {
    const patterns = [
      /<<<OOC>([\s\S]*?)<\/OOC>>>/m,
      /<OOC>([\s\S]*?)<\/OOC>/m,
    ];
    for (const rx of patterns) {
      const m = rx.exec(text);
      if (m && m[1]) {
        try {
          return JSON.parse(m[1].trim());
        } catch {}
      }
    }
  } catch {}
  return null;
}

/**
 * Remove all OOC blocks from a message and trim extra blank lines/spaces.
 */
export function stripOOC(text: string): string {
  try {
    return text
      .replace(/<<<OOC>[\s\S]*?<\/OOC>>>/gm, "")
      .replace(/<OOC>[\s\S]*?<\/OOC>/gm, "")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  } catch {
    return text;
  }
}

export default { parseOOCBlock, stripOOC };
