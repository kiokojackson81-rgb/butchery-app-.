import { describe, it, expect } from 'vitest';
import { parseOOCBlock, stripOOC } from '@/lib/ooc_parse';

describe('ooc_parse helpers', () => {
  it('parses triple-chevron OOC fence', () => {
    const text = 'Hello\n\n<<<OOC>\n{"intent":"MENU","args":{}}\n</OOC>>>';
    const o = parseOOCBlock(text);
    expect(o).toBeTruthy();
    expect(o!.intent).toBe('MENU');
  });

  it('parses single OOC fence', () => {
    const text = 'Test <OOC>{"intent":"HELP"}</OOC> tail';
    const o = parseOOCBlock(text);
    expect(o).toBeTruthy();
    expect(o!.intent).toBe('HELP');
  });

  it('returns null for invalid JSON', () => {
    const text = '<<<OOC> not-json </OOC>>>';
    const o = parseOOCBlock(text);
    expect(o).toBeNull();
  });

  it('strips OOC blocks and trims whitespace', () => {
    const text = 'Line A  \n\n<<<OOC>\n{"intent":"LOGIN"}\n</OOC>>>\n';
    const out = stripOOC(text);
    expect(out).toBe('Line A');
  });
});
