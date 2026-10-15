/** Shared URL rules for the CRM endpoint and WXT extension. No browser globals. */
export function normalizeProfileUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Enter a LinkedIn profile URL.");
  let url: URL;
  try {
    const raw = value.trim();
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch { throw new Error("Enter a valid LinkedIn profile URL."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port ||
      !/^(www\.)?linkedin\.com$/i.test(url.hostname)) {
    throw new Error("Use a public linkedin.com/in/ profile URL.");
  }
  const match = /^\/in\/([^/]+)(?:\/(?:overlay|details)\/[^/]+)?\/?$/i.exec(url.pathname);
  if (!match?.[1]) throw new Error("Open a public LinkedIn profile (/in/…). Sales Navigator URLs are not supported yet.");
  let slug: string;
  try { slug = decodeURIComponent(match[1]).normalize("NFC").toLowerCase(); }
  catch { throw new Error("Enter a valid LinkedIn profile URL."); }
  if (!slug || slug.length > 255 || slug === "." || slug === ".." ||
      /[\s\\/?#\u0000-\u001f\u007f]/u.test(slug)) {
    throw new Error("Enter a valid LinkedIn profile URL.");
  }
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
}

/** Recover one public profile from legacy rows that contain pasted text or a mistyped host. */
export function normalizeStoredProfileUrl(value: string): string {
  try { return normalizeProfileUrl(value); } catch { /* Legacy values only. */ }
  const occurrences = value.match(/(?:linkedin|inkedin|linlinkedin)\.com\/in\//gi) ?? [];
  if (occurrences.length !== 1) throw new Error("No single public LinkedIn profile URL");
  const match = /(?:https?:\/\/)?(?:www\.|w\/ww\.)?(?:linkedin|inkedin|linlinkedin)\.com\/in\/([^/\s?#"']+)/i.exec(value);
  if (!match) throw new Error("No single public LinkedIn profile URL");
  return normalizeProfileUrl(`https://www.linkedin.com/in/${match[1]}`);
}

export function normalizeCrmOrigin(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter the full CRM URL, including https://.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter the full CRM URL, including https://."); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("Use HTTPS for your CRM, or http://localhost:5000 for local development.");
  }
  return url.origin;
}

export function sameProfile(left: unknown, right: unknown): boolean {
  try { return normalizeProfileUrl(left) === normalizeProfileUrl(right); } catch { return false; }
}

export function crmPermissionPattern(origin: string): string {
  const url = new URL(normalizeCrmOrigin(origin));
  // Chrome host permissions cover all ports; exact-origin checks still pin the CRM tab.
  return `${url.protocol}//${url.hostname}/*`;
}
