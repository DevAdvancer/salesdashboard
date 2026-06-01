export function normalizeLinkedinProfileUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  try {
    const url = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(`https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '');
    const normalized = `https://${host}${pathname || ''}`;
    return normalized;
  } catch {
    return raw;
  }
}

export function getLinkedinProfileUrlSearchNeedle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  try {
    const url = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(`https://${raw}`);
    const pathname = url.pathname.replace(/\/+$/, '');
    if (pathname && pathname !== '/') return pathname;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host;
  } catch {
    const trimmed = raw.replace(/\/+$/, '');
    return trimmed || undefined;
  }
}
