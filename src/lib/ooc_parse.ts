// src/lib/ooc_parse.ts
// --- Authenticated/Unauthenticated WA message builders ---
export function buildUnauthenticatedReply(deepLink: string, dedupe = false): { text: string; buttons: string[]; ooc: string } {
  // Always reply, dedupe if needed
  const mainText = dedupe
    ? `Still seeing no login. Please open:\n${deepLink}`
    : `Please log in to continue.\n\nOpen: ${deepLink}`;
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
  let text = "";
  let buttons: string[] = [];
  let args: Record<string, any> = { role };
  switch (role) {
    case "attendant":
      text = `✅ Welcome back — ${outlet || "Outlet"}\nWhat would you like to do?\n1) Enter Closing  2) Deposit (paste SMS)  3) Expense\n4) Summary  5) Till Count  6) Supply (view)`;
      buttons = ["ATT_CLOSING", "ATT_DEPOSIT", "MENU_SUMMARY"];
      args.outlet = outlet;
      break;
    case "supervisor":
      text = `✅ Welcome — Supervisor\nQuick actions:\n1) Review Closings  2) Review Deposits  3) Review Expenses`;
      buttons = ["SV_REVIEW_CLOSINGS", "SV_REVIEW_DEPOSITS", "SV_REVIEW_EXPENSES"];
      break;
    case "supplier":
      text = `✅ Welcome — Supplier\n1) Submit Delivery  2) View Opening  3) Disputes`;
      buttons = ["SUPL_DELIVERY", "SUPL_VIEW_OPENING", "SUPL_DISPUTES"];
      break;
  }
  const ooc = `<<<OOC>\n${JSON.stringify({
    intent: "MENU",
    args,
    buttons,
    next_state_hint: "MENU"
  }, null, 2)}\n</OOC>>>`;
  return {
    text,
    buttons,
    ooc
  };
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
