/* @vitest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ToastProvider, useToast } from '@/components/ToastProvider';

function TestComp() {
  const { showToast } = useToast();
  return <button onClick={() => showToast({ type: 'success', message: 'ok!' })}>Go</button>;
}

describe('ToastProvider', () => {
  it('renders toasts and auto-dismisses', async () => {
    // Use a short autoDismissMs so test runs quickly and without fake timers
    render(
      <ToastProvider autoDismissMs={200}>
        <TestComp />
      </ToastProvider>
    );
    const btn = screen.getByText('Go');
    btn.click();
    // wait for toast to appear
    const toast = await screen.findByText('ok!');
    expect(toast).toBeTruthy();
    // wait for it to auto-dismiss
    await waitFor(() => expect(screen.queryByText('ok!')).toBeNull(), { timeout: 1000 });
  });
});
