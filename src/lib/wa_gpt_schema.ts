export type GptInteractiveSchema = {
  text?: string;
  interactive?: {
    type: 'buttons' | 'list';
    buttons?: Array<{ id: string; title: string }>;
    sections?: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    buttonLabel?: string;
    bodyText?: string;
    footerText?: string;
  };
};

export function isValidGptInteractive(obj: any): obj is GptInteractiveSchema {
  if (!obj || typeof obj !== 'object') return false;
  if ('interactive' in obj) {
    const inter = obj.interactive;
    if (!inter || typeof inter !== 'object') return false;
    if (inter.type === 'buttons') {
      if (!Array.isArray(inter.buttons)) return false;
      return inter.buttons.every((b: any) => b && typeof b.id === 'string' && typeof b.title === 'string');
    }
    if (inter.type === 'list') {
      if (!Array.isArray(inter.sections)) return false;
      return inter.sections.every((s: any) => s && Array.isArray(s.rows) && s.rows.every((r: any) => r && typeof r.id === 'string' && typeof r.title === 'string'));
    }
    return false;
  }
  return typeof obj.text === 'string' || !!obj.text === false;
}

export default {};
