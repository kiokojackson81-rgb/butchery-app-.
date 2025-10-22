// Lightweight wrapper around browser prompt/confirm to make them replaceable later
export function promptSync(message: string, defaultValue: string = ""): string | null {
  try { return window.prompt(message, defaultValue); } catch { return null; }
}

export function confirmSync(message: string): boolean {
  try { return window.confirm(message); } catch { return false; }
}
