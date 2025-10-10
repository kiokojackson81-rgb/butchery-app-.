import { buildInteractiveListPayload } from '@/lib/wa_messages';
import { sendInteractive } from '@/lib/wa';

export async function sendCanonicalTabs(to: string, role: 'attendant'|'supervisor'|'supplier', outlet?: string) {
  const date = new Date().toISOString().slice(0,10);
  if (role === 'supervisor') {
    const payload = buildInteractiveListPayload({ to, bodyText: `Supervisor — ${date}. Use the tabs:`, footerText: 'BarakaOps', buttonLabel: 'Tabs', sections: [{ title: 'Supervisor Tabs', rows: [{ id: 'SV_REVIEW_CLOSINGS', title: 'Review Closings' }, { id: 'SV_REVIEW_DEPOSITS', title: 'Review Deposits' }, { id: 'SV_REVIEW_EXPENSES', title: 'Review Expenses' }, { id: 'SV_HELP', title: 'Help / Logout' }] }] });
    await sendInteractive(payload as any, 'AI_DISPATCH_INTERACTIVE');
    return;
  }
  if (role === 'supplier') {
    const payload = buildInteractiveListPayload({ to, bodyText: `Supplier — ${date}. Use the tabs:`, footerText: 'BarakaOps', buttonLabel: 'Tabs', sections: [{ title: 'Supplier Tabs', rows: [{ id: 'SUPL_DELIVERY', title: 'Submit Delivery' }, { id: 'SUPL_VIEW_OPENING', title: 'View Opening' }, { id: 'SUPL_DISPUTES', title: 'Disputes' }, { id: 'SUPL_HELP', title: 'Help' }] }] });
    await sendInteractive(payload as any, 'AI_DISPATCH_INTERACTIVE');
    return;
  }
  // Attendant default
  const payload = buildInteractiveListPayload({ to, bodyText: `${outlet || 'Attendant'} — ${date}. Use the tabs:`, footerText: 'BarakaOps', buttonLabel: 'Tabs', sections: [{ title: 'Attendant Tabs', rows: [{ id: 'ATT_TAB_STOCK', title: 'Enter Closing' }, { id: 'MENU_SUPPLY', title: 'Supply' }, { id: 'ATT_DEPOSIT', title: 'Deposit' }, { id: 'ATT_EXPENSE', title: 'Expense' }, { id: 'MENU_TXNS', title: 'Till Count' }, { id: 'MENU_SUMMARY', title: 'Summary' }] }] });
  await sendInteractive(payload as any, 'AI_DISPATCH_INTERACTIVE');
}

export default {};
