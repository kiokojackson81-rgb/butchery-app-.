// src/types/global.d.ts
export {};

declare global {
  interface Window {
    exportJSON: () => string;
    importJSON: (payload: string) => void;
    clearAll: () => void;
    resetDefaults: () => void;
  }
}
