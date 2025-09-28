// Central registry to avoid typos and keep language codes in one place.
export const WaTemplates = {
  closing_stock_submitted: { name: "closing_stock_submitted", lang: "en" },
  low_stock_alert:        { name: "low_stock_alert",        lang: "en" },
  supply_received:        { name: "supply_received",        lang: "en" },
  supply_request:         { name: "supply_request",         lang: "en" },
  waste_rejected:         { name: "waste_rejected",         lang: "en" },
} as const;

export type TemplateKey = keyof typeof WaTemplates;

// Helper to build the components payload from simple string params
export function bodyParams(params: string[]) {
  return [{
    type: "body" as const,
    parameters: params.map((p) => ({ type: "text" as const, text: String(p ?? "") })),
  }];
}
