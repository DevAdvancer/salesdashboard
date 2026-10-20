import { normalizeProfileUrl } from 'crm-shared/utils/linkedin-extension-url';

export class ProfileChangedError extends Error {
  readonly code = 'PROFILE_CHANGED';
  constructor() { super('The LinkedIn profile changed. Rechecking the current profile…'); }
}

interface CurrentTab { id?: number; url?: string; incognito?: boolean }

/** MessageSender.url belongs to the original document, not necessarily its SPA route. */
export async function assertCurrentLinkedinProfile(
  tabId: number, targetUrl: string, getTab: (tabId: number) => Promise<CurrentTab>,
): Promise<void> {
  const tab = await getTab(tabId);
  if (tab.id !== tabId || tab.incognito) throw new Error('Untrusted LinkedIn tab.');
  let currentUrl: URL;
  try { currentUrl = new URL(tab.url || ''); } catch { throw new ProfileChangedError(); }
  if (currentUrl.protocol !== 'https:' || currentUrl.port || currentUrl.username || currentUrl.password ||
    !['www.linkedin.com', 'linkedin.com'].includes(currentUrl.hostname)) throw new ProfileChangedError();
  try {
    if (normalizeProfileUrl(currentUrl.href) === normalizeProfileUrl(targetUrl)) return;
  } catch { /* Navigation can briefly leave the supported profile route. */ }
  throw new ProfileChangedError();
}
