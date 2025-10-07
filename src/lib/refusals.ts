// src/lib/refusals.ts
export function refuseOutOfScope(): string {
  return [
    "This channel is only for butchery operations.",
    "Choose an option to continue:",
    "📦 Stock  | 🚚 Supply  | 💰 Deposits",
    "🧾 Expenses | 🏧 Till | 📊 Summary",
  ].join("\n");
}

export function refuseOutOfScopeMsg(): string {
  return [
    "This channel is for butchery operations only.",
    "Choose an option to continue:",
  ].join("\n");
}
