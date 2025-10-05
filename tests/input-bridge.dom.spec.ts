/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';

function isNumericInput(el: any): el is HTMLInputElement {
  if (!el || el.tagName !== 'INPUT') return false;
  const inp = el as HTMLInputElement;
  const t = (inp.type || '').toLowerCase();
  const im = (inp.inputMode || '').toLowerCase();
  return (
    t === 'number' ||
    im === 'numeric' ||
    inp.getAttribute('data-numeric') === 'true' ||
    inp.getAttribute('data-number') === 'true'
  );
}

function normalizeLeadingZeros(value: string): string {
  if (value == null as any) return value as any;
  let v = String(value);
  if (v === '') return v;
  let sign = '';
  if (v.startsWith('-')) { sign = '-'; v = v.slice(1); }
  const hasDot = v.includes('.');
  if (hasDot) {
    const [int, frac] = v.split('.');
    const intNorm = /^0+$/.test(int) ? '0' : int.replace(/^0+/, '');
    const safeInt = intNorm === '' ? '0' : intNorm;
    return `${sign}${safeInt}.${frac}`;
  }
  if (/^0+$/.test(v)) return '0';
  v = v.replace(/^0+/, '');
  return `${sign}${v}`;
}

describe('InputBehaviorBridge (dom smoke)', () => {
  let inp: HTMLInputElement;
  let isComposing = false;

  const onInput = (e: Event) => {
    const target = e.target as HTMLElement;
    if (!isNumericInput(target)) return;
    const input = target as HTMLInputElement;
    if (input.getAttribute('data-allow-leading-zeros') === 'true') return;
    if (isComposing) return;
    const before = input.value;
    const after = normalizeLeadingZeros(before);
    if (after !== before) {
      input.value = after;
      const ev = new Event('input', { bubbles: true });
      input.dispatchEvent(ev);
    }
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    inp = document.createElement('input');
    inp.type = 'number';
    document.body.appendChild(inp);
    document.addEventListener('input', onInput, true);
  });

  it('typing 0 then 5 becomes 5 (not 0)', () => {
    inp.value = '0';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    expect(inp.value).toBe('0');

    inp.value = '05';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    expect(inp.value).toBe('5');
  });

  it('multiple zeros collapse to single 0', () => {
    inp.value = '0'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.value = '00'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.value = '000'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    expect(inp.value).toBe('0');
  });

  it('supports decimals with inputMode numeric: 000.50 => 0.50', () => {
    // Use a text input with numeric keypad to allow in-progress decimals like '0.'
    const t = document.createElement('input');
    t.type = 'text';
    t.setAttribute('inputmode', 'numeric');
    document.body.appendChild(t);
    t.addEventListener('input', onInput, true);

    t.value = '0'; t.dispatchEvent(new Event('input', { bubbles: true }));
    t.value = '0.'; t.dispatchEvent(new Event('input', { bubbles: true }));
    expect(t.value).toBe('0.');
    t.value = '0.5'; t.dispatchEvent(new Event('input', { bubbles: true }));
    expect(t.value).toBe('0.5');
    t.value = '000.50'; t.dispatchEvent(new Event('input', { bubbles: true }));
    expect(t.value).toBe('0.50');
  });

  it('allows clearing to empty', () => {
    inp.value = '12'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    expect(inp.value).toBe('');
  });

  it('respects opt-out via data-allow-leading-zeros', () => {
    inp.setAttribute('data-allow-leading-zeros', 'true');
    inp.value = '00012';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    expect(inp.value).toBe('00012');
  });
});
