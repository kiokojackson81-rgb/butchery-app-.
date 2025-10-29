import logger from '@/lib/logger';

export type C2BParsed = {
  transId: string;
  transTime?: string | null;
  amount: number;
  businessShortCode?: string | null;
  billRefNumber?: string | null;
  msisdn?: string | null;
  thirdPartyTransId?: string | null;
  orgAccountBalance?: string | null;
};

export function parseC2B(raw: any): C2BParsed | null {
  try {
    const p = raw || {};
    const TransID = p.TransID || p.transID || p.ReceiptNo || p.receipt || '';
    if (!TransID || typeof TransID !== 'string') return null;
    const amount = Number(p.TransAmount ?? p.amount ?? 0);
    const parsed: C2BParsed = {
      transId: TransID,
      transTime: p.TransTime || p.transTime || null,
      amount: isNaN(amount) ? 0 : Math.round(Number(amount)),
      businessShortCode: p.BusinessShortCode || p.ShortCode || null,
      billRefNumber: p.BillRefNumber || p.BillRef || p.AccountReference || null,
  msisdn: (p.MSISDN || p.MSISDN1 || p.MSISDN2 || p.MSISDN3 || p.Sender) ?? null,
      thirdPartyTransId: p.ThirdPartyTransID || p.thirdPartyTransId || null,
      orgAccountBalance: p.OrgAccountBalance || p.orgAccountBalance || null,
    };
    return parsed;
  } catch (e) {
    logger.error({ action: 'c2b:parse:error', error: String(e) });
    return null;
  }
}
