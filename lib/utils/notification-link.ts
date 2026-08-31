export function getNotificationUrl(targetId?: string | null, targetType?: string | null): string | null {
  if (!targetId || !targetType) return null;
  const type = targetType.toLowerCase();
  if (type === 'lead') return `/leads/${targetId}`;
  if (type === 'resume_profile') return `/resume/${targetId}`;
  if (type === 'call_request') return `/my-call-requests`;
  if (type === 'interview') return `/resume/${targetId}`;
  if (type === 'mock') return `/resume/${targetId}`;
  if (type === 'user') return `/profile/${targetId}`;
  return null;
}
