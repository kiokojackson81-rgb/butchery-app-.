// src/lib/wa/gptDispatcher.ts
import { runGptForIncoming } from "@/lib/gpt_router";
import { formatSupplyForRole, SupplyView as _SupplyView } from "@/lib/format/supply";

export type Role = 'supplier'|'attendant'|'supervisor'|'admin';
export type SupplyItem = { name: string; qty: number; unit: string; unitPrice?: number };
export type SupplyView = _SupplyView;

export type DispatchArgs =
  | { kind: 'SUPPLY_SUBMITTED'; role: Role; view: SupplyView }
  | { kind: 'SUPPLY_DISPATCHED'; role: Role; view: SupplyView }
  | { kind: 'SUPPLY_RECEIVED'; role: Role; view: SupplyView }
  | { kind: 'SUPPLY_DISPUTED'; role: Role; view: SupplyView }
  | { kind: 'SUPPLIER_UPSERT'; role: Role; supplier: { name: string; phone: string }; outletNames: string[] };

export type DispatchResult = { text: string; buttons?: Array<{ id: string; title: string }> };

function buildSystemPrompt(kind: string, role: Role) {
  return `You are BarakaOps assistant for WhatsApp. Produce a short message (<=400 chars) and a JSON OOC block containing {"buttons":[{id,title}, ...]} suitable for the mobile interactive button reply. Role: ${role}. Event: ${kind}. Respond only with text, then an OOC block like \n<<<OOC>\n{...}\n</OOC>>>`;
}

export async function gptDispatch(args: DispatchArgs): Promise<DispatchResult> {
  // Format view (mask prices) when applicable
  if ((args as any).view) {
    (args as any).view = formatSupplyForRole((args as any).view, args.role as Role);
  }
  const sys = buildSystemPrompt((args as any).kind || 'GEN', (args as any).role || 'attendant');
  const userPayload = JSON.stringify(args, null, 2);
  const prompt = `${sys}\n\nCONTEXT:\n${userPayload}\n\nReturn human-friendly text then OOC.`;
  const resp = await runGptForIncoming('gpt-dispatcher', prompt);
  // Expect resp to be text + OOC block as used elsewhere
  const match = String(resp || '').match(/([\s\S]*?)\n*<<<OOC>\n([\s\S]*?)\n<\/OOC>>>/);
  if (!match) {
    // fallback: create a minimal text
    return { text: (resp || '').slice(0, 400) || 'Update: see details in app.', buttons: [{ id: 'SUPL_VIEW', title: 'View' }] };
  }
  const text = (match[1] || '').trim().slice(0, 400);
  let ooc: any = {};
  try { ooc = JSON.parse(match[2]); } catch (e) { ooc = {}; }
  const buttons = Array.isArray(ooc?.buttons) ? ooc.buttons.map((b: any) => ({ id: String(b.id || b.replyId || b.id), title: String(b.title || b.label || b.title) })) : undefined;
  return { text, buttons };
}
