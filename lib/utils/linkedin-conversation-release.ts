// November 21, 2026 at 9:00 AM Eastern Standard Time.
export const LINKEDIN_CONVERSATION_RELEASE_AT = '2026-11-21T14:00:00.000Z';

export function isLinkedinConversationReleased(now = new Date()) {
  return now.getTime() >= Date.parse(LINKEDIN_CONVERSATION_RELEASE_AT);
}
