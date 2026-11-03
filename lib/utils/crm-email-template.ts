/** Literal CRM dark-theme colors and inline styles for email clients without app CSS/fonts. */
export const CRM_EMAIL_COLORS = {
  background: '#000000', surface: '#18181b', foreground: '#ffffff',
  muted: '#9e9ea0', border: '#39393b', blue: '#3b82f6',
} as const;

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Generated fragments keep their alignment, status colors, links, and signature styles. */
function styleContent(html: string): string {
  const c = CRM_EMAIL_COLORS;
  const styles: Record<string, string> = {
    table: `width:100%;border-collapse:collapse;border-color:${c.border};font-size:14px;`,
    th: `padding:12px 10px;text-align:left;background-color:${c.surface};color:${c.muted};border-bottom:1px solid ${c.border};font-size:12px;`,
    td: `padding:10px;border-bottom:1px solid ${c.border};vertical-align:top;`,
    p: 'margin:0 0 16px;line-height:1.7;',
    h2: 'margin:24px 0 16px;font-size:20px;line-height:1.3;',
    h3: 'margin:24px 0 12px;font-size:16px;line-height:1.4;',
    a: `color:${c.blue};text-decoration:underline;`,
    hr: `border:0;border-top:1px solid ${c.border};margin:24px 0;`,
  };
  return html.replace(/<(table|th|td|p|h2|h3|a|hr)\b([^>]*)>/gi, (_tag, name: string, attrs: string) => {
    const base = styles[name.toLowerCase()];
    const existing = /\bstyle\s*=\s*(["'])(.*?)\1/i;
    attrs = attrs.replace(/\s*\/\s*$/, '');
    const styled = existing.test(attrs)
      ? attrs.replace(existing, (_style, quote: string, value: string) => `style=${quote}${base}${value}${quote}`)
      : `${attrs} style="${base}"`;
    return `<${name}${styled}>`;
  });
}

export function renderCrmEmail(input: { title: string; html: string; crmUrl: string; preserveContentStyles?: boolean }): string {
  const c = CRM_EMAIL_COLORS;
  const fragment = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(input.html)?.[1] ?? input.html;
  const content = input.preserveContentStyles ? fragment : styleContent(fragment);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeEmailHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background-color:${c.background};color:${c.foreground};font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${c.background}" style="background-color:${c.background};color:${c.foreground};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="800" cellspacing="0" cellpadding="0" style="width:100%;max-width:800px;border:1px solid ${c.border};border-radius:24px;background-color:${c.background};color:${c.foreground};">
<tr><td style="padding:28px 28px 24px;border-bottom:3px solid ${c.blue};">
<p style="margin:0;font-family:'Arial Narrow',Arial,sans-serif;font-size:24px;font-weight:600;letter-spacing:0.1em;line-height:1.2;color:${c.foreground};">CRM HUB</p>
<p style="margin:8px 0 0;font-size:10px;letter-spacing:0.12em;color:${c.muted};">SALES INTELLIGENCE</p></td></tr>
<tr><td style="padding:28px;font-size:14px;line-height:1.7;color:${c.foreground};">
<h1 style="margin:0 0 24px;font-size:22px;line-height:1.35;font-weight:600;color:${c.foreground};">${escapeEmailHtml(input.title)}</h1>
${content}</td></tr>
<tr><td style="padding:20px 28px;border-top:1px solid ${c.border};font-size:12px;line-height:1.7;color:${c.muted};">
Sent from <a href="${escapeEmailHtml(input.crmUrl)}" style="color:${c.blue};text-decoration:underline;">CRM HUB</a> · Sales Intelligence<br>
This email and any attachments are confidential and intended solely for the addressee. Please do not reply to automated notifications.
</td></tr></table></td></tr></table></body></html>`;
}
