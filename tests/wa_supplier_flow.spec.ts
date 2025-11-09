import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSupplierAction, handleSupplierText } from '@/server/wa/wa_supplier_flow';

// Minimal prisma spy (only methods touched in our tested paths)
vi.mock('@/lib/prisma', () => {
  const rows: any[] = [];
  return {
    prisma: {
      supplyOpeningRow: {
        findMany: vi.fn().mockImplementation(async (q: any) => {
          if (q?.where?.date && q?.where?.outletName && !q.where.itemKey) {
            return rows.filter(r => r.date === q.where.date && r.outletName === q.where.outletName);
          }
          return rows.slice().reverse();
        }),
        findUnique: vi.fn().mockImplementation(async (q: any) => {
          const w = q?.where?.date_outletName_itemKey; if (!w) return null;
          return rows.find(r => r.date === w.date && r.outletName === w.outletName && r.itemKey === w.itemKey) || null;
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => { rows.push({ id: rows.length + 1, ...data }); return data; }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          const w = where.date_outletName_itemKey; const i = rows.findIndex(r => r.date === w.date && r.outletName === w.outletName && r.itemKey === w.itemKey);
          if (i >= 0) { rows[i] = { ...rows[i], ...data }; return rows[i]; }
          return null;
        }),
        upsert: vi.fn().mockImplementation(async ({ where, create, update }: any) => {
          const w = where.date_outletName_itemKey; const i = rows.findIndex(r => r.date === w.date && r.outletName === w.outletName && r.itemKey === w.itemKey);
            if (i >= 0) { rows[i] = { ...rows[i], ...update }; return rows[i]; }
            const newRow = { id: rows.length + 1, ...create }; rows.push(newRow); return newRow;
        }),
        delete: vi.fn().mockImplementation(async ({ where }: any) => {
          const i = rows.findIndex(r => r.id === where.id); if (i >= 0) { const del = rows.splice(i,1)[0]; return del; } return null;
        })
      },
      product: {
        findMany: vi.fn().mockResolvedValue([
          { key: 'beef', name: 'Beef' },
          { key: 'goat', name: 'Goat' }
        ]),
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.key === 'beef') return { key: 'beef', name: 'Beef', unit: 'kg' };
          if (where.key === 'goat') return { key: 'goat', name: 'Goat', unit: 'kg' };
          return null;
        })
      },
      phoneMapping: {
        findMany: vi.fn().mockResolvedValue([{ outlet: 'OutletA' }]),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      waSession: {
        update: vi.fn().mockResolvedValue({})
      },
      supplyTransfer: {
        create: vi.fn().mockResolvedValue({})
      },
      setting: { upsert: vi.fn(), findUnique: vi.fn() }
    }
  };
});

// Mock WA send helpers so we can observe calls
vi.mock('@/lib/wa', () => ({
  sendTextSafe: vi.fn().mockResolvedValue({ ok: true }),
  sendInteractiveSafe: vi.fn().mockResolvedValue({ ok: true }),
  sendText: vi.fn().mockResolvedValue({ ok: true }),
  sendInteractive: vi.fn().mockResolvedValue({ ok: true })
}));
vi.mock('@/lib/wa_dispatcher', () => ({ sendOpsMessage: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/server/supplier/supplier.notifications', () => ({ notifyTransferCreated: vi.fn().mockResolvedValue(undefined) }));

function mkSess(): any {
  return { id: 'sess1', code: 'SUP001', role: 'supplier', updatedAt: new Date().toISOString(), state: 'SPL_MENU', cursor: { date: new Date().toISOString().slice(0,10) } };
}

describe('wa_supplier_flow basic delivery path', () => {
  let sess: any;
  beforeEach(() => { sess = mkSess(); });

  it('starts delivery flow and saves item', async () => {
    await handleSupplierAction(sess, 'SUPL_SUBMIT_DELIVERY', '+254700000001');
    expect(sess.state).toBeDefined(); // state patched in DB mock
    // pick product list path after auto outlet choose
    sess.state = 'SPL_DELIV_PICK_PRODUCT';
    sess.cursor.outlet = 'OutletA';
    await handleSupplierAction(sess, 'SPL_P:beef', '+254700000001');
    sess.state = 'SPL_DELIV_QTY';
    sess.cursor.productKey = 'beef';
    await handleSupplierText(sess, '5', '+254700000001'); // qty
    sess.state = 'SPL_DELIV_PRICE';
    sess.cursor.qty = 5;
    await handleSupplierText(sess, '700', '+254700000001'); // price
    sess.state = 'SPL_DELIV_UNIT';
    sess.cursor.buyPrice = 700;
    await handleSupplierAction(sess, 'UNIT_KG', '+254700000001'); // confirm
    sess.state = 'SPL_DELIV_CONFIRM';
    sess.cursor.unit = 'kg';
    await handleSupplierAction(sess, 'SPL_SAVE', '+254700000001');
    // Idempotency second save ignored
    await handleSupplierAction(sess, 'SPL_SAVE', '+254700000001');
    expect(sess.cursor.lastSig).toContain('beef');
  });
});

describe('wa_supplier_flow transfer path', () => {
  let sess: any;
  beforeEach(() => { sess = mkSess(); });

  it('creates a transfer', async () => {
    await handleSupplierAction(sess, 'SUPL_TRANSFER', '+254700000001');
    sess.state = 'SPL_TRANSFER_FROM';
    sess.cursor.fromOutlet = 'OutletA';
    await handleSupplierAction(sess, 'SPL_O:OutletA', '+254700000001'); // picking from leads to to-selection
    sess.state = 'SPL_TRANSFER_TO';
    sess.cursor.fromOutlet = 'OutletA';
    sess.cursor.toOutlet = 'OutletB';
    await handleSupplierAction(sess, 'SPL_O:OutletB', '+254700000001');
    sess.state = 'SPL_TRANSFER_PRODUCT';
    sess.cursor.toOutlet = 'OutletB';
    await handleSupplierAction(sess, 'SPL_P:goat', '+254700000001');
    sess.state = 'SPL_TRANSFER_QTY';
    sess.cursor.productKey = 'goat';
    await handleSupplierText(sess, '3', '+254700000001');
    sess.state = 'SPL_TRANSFER_UNIT';
    sess.cursor.qty = 3;
    await handleSupplierAction(sess, 'UNIT_KG', '+254700000001');
    sess.state = 'SPL_TRANSFER_CONFIRM';
    sess.cursor.unit = 'kg';
    await handleSupplierAction(sess, 'SPL_TRANSFER_SAVE', '+254700000001');
    expect(sess.state).toBe('SPL_MENU');
  });
});
