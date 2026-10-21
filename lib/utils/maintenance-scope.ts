type HeaderReader = Pick<Headers, 'get'>;

function isLoopbackAuthority(value: string | null) {
  if (!value || value.trim() !== value || /[\s,/@?#\\]/.test(value)) return false;
  try {
    const url = new URL(`http://${value}`);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

/** Only a local development server may bypass the live site's maintenance gate. */
export function isLocalMaintenanceRequest(headers: HeaderReader, runtime: {
  nodeEnv: string | undefined; hosted: boolean;
}) {
  if (runtime.hosted || !['development', 'test'].includes(runtime.nodeEnv || '')) return false;
  if (!isLoopbackAuthority(headers.get('host'))) return false;
  const forwarded = headers.get('x-forwarded-host');
  return !forwarded || isLoopbackAuthority(forwarded);
}
