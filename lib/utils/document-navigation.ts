/** Start a new document after authentication so a pre-OTP router cache cannot
 * replay a protected-page redirect back to /login. HttpOnly cookies are sent. */
export function replaceDocument(path: string) { window.location.replace(path); }
