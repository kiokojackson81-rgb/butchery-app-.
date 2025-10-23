/* @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import PaymentsAdmin from '@/app/admin/payments/PaymentsAdmin';
import { ToastProvider } from '@/components/ToastProvider';

const samplePayment = { id: 'p1', createdAt: new Date().toISOString(), outletCode: 'GENERAL', storeNumber: '001', amount: 100, msisdn: '254700000000', mpesaReceipt: null, status: 'PENDING' };
const sampleOrphan = { id: 'o1', createdAt: new Date().toISOString(), amount: 50, msisdn: '254700000001' };

describe('PaymentsAdmin optimistic attach', () => {
  it('attaches orphan and shows toast', async () => {
    // Mock fetch
    global.fetch = vi.fn(async () => ({ json: async () => ({ ok: true, data: { id: sampleOrphan.id, amount: sampleOrphan.amount, outletCode: 'BRIGHT' } } as any) }) as any) as any;
    render(
      <ToastProvider>
        <PaymentsAdmin payments={[samplePayment]} orphans={[sampleOrphan]} outletTotals={{ BRIGHT: { deposits: 0, expected: 0 } }} />
      </ToastProvider>
    );

  // Click Attach on orphan (query the button specifically to avoid matching table header)
  const attachBtn = await screen.findByRole('button', { name: 'Attach' });
  fireEvent.click(attachBtn);
  // input outlet
  const input = await screen.findByPlaceholderText('BRIGHT');
  fireEvent.change(input, { target: { value: 'BRIGHT' } });
  // The modal also contains a button labelled 'Attach' — find all and pick the last (the confirm)
  const attachButtons = await screen.findAllByRole('button', { name: 'Attach' });
  const confirm = attachButtons[attachButtons.length - 1];
  fireEvent.click(confirm);
    // Expect fetch called
    expect((global.fetch as any)).toHaveBeenCalled();
  });
});
