// src/lib/ooc_parse.ts
// --- Authenticated/Unauthenticated WA message builders ---
export function buildUnauthenticatedReply(deepLink: string, dedupe = false): { text: string; buttons: string[]; ooc: string } {
  // Always reply, dedupe if needed. Keep message professional and concise (1-2 lines)
  const mainText = dedupe
    ? `Still no sign-in detected. Please open:\n${deepLink}`
    : `Please sign in to continue.\n\nOpen: ${deepLink}`;
  const buttons = ["LOGIN", "HELP"];
  const ooc = `<<<OOC>\n${JSON.stringify({
    intent: "LOGIN",
    args: { reason: "not_authenticated" },
    buttons,
    next_state_hint: "LOGIN"
  }, null, 2)}\n</OOC>>>`;
  return {
    text: mainText,
    buttons,
    ooc
  };
}

export function buildAuthenticatedReply(role: "attendant"|"supervisor"|"supplier", outlet?: string): { text: string; buttons: string[]; ooc: string } {
  const roleLabel = role === "attendant"
    ? (outlet ? `${outlet} attendant` : "attendant")
    : role;
  const text = `Welcome back ${roleLabel}. I'll handle the rest - just tell me what you need.`;
  const args: Record<string, any> = { role, ...(outlet ? { outlet } : {}) };
  const buttons: string[] = [];
  const ooc = `<<<OOC>\n${JSON.stringify({
    intent: "MENU",
    args,
    buttons,
    next_state_hint: "GPT"
  }, null, 2)}\n</OOC>>>`;
  return { text, buttons, ooc };
}

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
        const raw = m[1].trim();
        try {
          return JSON.parse(raw);
        } catch {
          // Some GPT replies accidentally drop the comma before next_state_hint,
          // yielding `},"next_state_hint"` instead of `,"next_state_hint"`.
          // Apply a targeted repair then retry JSON parse.
          try {
            const repaired = raw.replace(/}\s*,\s*"next_state_hint"/g, ',"next_state_hint"');
            return JSON.parse(repaired);
          } catch {}
        }
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

