"use client";

import { useEffect } from "react";

function isNumericInput(el: any): el is HTMLInputElement {
  if (!el || el.tagName !== "INPUT") return false;
  const inp = el as HTMLInputElement;
  const t = (inp.type || "").toLowerCase();
  const im = (inp.inputMode || "").toLowerCase();
  return (
    t === "number" ||
    im === "numeric" ||
    inp.getAttribute("data-numeric") === "true" ||
    inp.getAttribute("data-number") === "true"
  );
}

function normalizeLeadingZeros(value: string): string {
  if (value == null) return value as any;
  let v = String(value);
  if (v === "") return v;
  // Track sign for negatives
  let sign = "";
  if (v.startsWith("-")) { sign = "-"; v = v.slice(1); }
  // If decimal present, normalize integer part separately
  const hasDot = v.includes(".");
  if (hasDot) {
    const [int, frac] = v.split(".");
    // If int is all zeros, keep a single 0
    const intNorm = /^0+$/.test(int) ? "0" : int.replace(/^0+/, "");
    // If int becomes empty (e.g., '' after removing zeros), set to '0'
    const safeInt = intNorm === "" ? "0" : intNorm;
    return `${sign}${safeInt}.${frac}`;
  }
  // No decimal: collapse multiple zeros, then strip leading zeros
  if (/^0+$/.test(v)) return "0"; // '000' -> '0'
  v = v.replace(/^0+/, ""); // '00021' -> '21'
  return `${sign}${v}`;
}

export default function InputBehaviorBridge() {
  useEffect(() => {
    let isComposing = false;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!isNumericInput(target)) return;
      const inp = target as HTMLInputElement;
      if (inp.getAttribute("data-allow-leading-zeros") === "true") return;
      // If value is a solitary 0, select it so typing replaces it
      if (inp.value === "0") {
        try { inp.setSelectionRange(0, inp.value.length); } catch {}
      }
    };

    const onInput = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!isNumericInput(target)) return;
      const inp = target as HTMLInputElement;
      if (inp.getAttribute("data-allow-leading-zeros") === "true") return;
      if (isComposing) return; // don't normalize while composing IME text
      const before = inp.value;
      const after = normalizeLeadingZeros(before);
      if (after !== before) {
        inp.value = after;
        // Fire a synthetic 'input' event so React controlled inputs update
        try {
          const ev = new Event("input", { bubbles: true });
          inp.dispatchEvent(ev);
        } catch {}
      }
    };

    const onCompositionStart = () => { isComposing = true; };
    const onCompositionEnd = (e: CompositionEvent) => {
      isComposing = false;
      // Trigger a late normalization after composition ends
      try {
        onInput(e as unknown as Event);
      } catch {}
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("compositionstart", onCompositionStart, true);
    document.addEventListener("compositionend", onCompositionEnd as any, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("compositionstart", onCompositionStart, true);
      document.removeEventListener("compositionend", onCompositionEnd as any, true);
    };
  }, []);

  return null;
}
