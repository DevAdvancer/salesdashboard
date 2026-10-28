import { leadHistoryLabel } from '@/lib/utils/lead-history-snapshot';

type Changes = Record<string, { from: unknown; to: unknown }>;

export function visibleLeadHistoryEvent(eventType: string) { return !eventType.endsWith('_ATTEMPT'); }

export function readableLeadHistory(eventType: string, changes: Changes, names: Record<string, string> = {}) {
  const handoff = changes['data.deactivationHandoff']?.to as Record<string, string> | undefined;
  if (handoff && typeof handoff === 'object' && !eventType.endsWith('_FAILED') && !eventType.endsWith('_BLOCKED')) return {
    title: 'Lead handed over after user inactivation',
    details: [`${handoff.fromUserName || handoff.fromUserId} → ${handoff.toUserName || handoff.toUserId}`,
      `Owner and assigned user changed to ${handoff.toUserName || handoff.toUserId}.`,
      `Previous owner: ${handoff.previousOwnerName || handoff.previousOwnerId}. Previous assigned user: ${handoff.previousAssigneeName || 'Unassigned'}.`],
  };
  const title = eventType.endsWith('_FAILED') ? 'Change could not be completed' :
    eventType.endsWith('_BLOCKED') ? 'Change blocked' :
    eventType === 'REQUEST_CREATE' ? 'LinkedIn request created' :
    eventType === 'REQUEST_UPDATE' ? (changes.status?.to === 'withdrawn' ? 'LinkedIn request withdrawn' : 'LinkedIn request updated') :
    eventType === 'LEAD_DELETE' ? 'Lead deleted' :
    leadHistoryLabel({ eventType, changes, id: '', actorId: '', actorName: '', occurredAt: '' });
  const value = (field: string, item: unknown): string => {
    if (item == null || item === '') return 'Unassigned';
    if (['ownerId', 'assignedToId', 'agentId', 'data.creatorId'].includes(field)) return names[String(item)] || String(item);
    if (typeof item === 'boolean') return item ? 'Yes' : 'No';
    return typeof item === 'object' ? JSON.stringify(item) : String(item);
  };
  const labels: Record<string, string> = { ownerId: 'Owner', assignedToId: 'Assigned user', agentId: 'Requested by', 'data.creatorId': 'Original creator', isClosed: 'Closed' };
  const details = Object.entries(changes)
    .filter(([key]) => !['data.lifecycleEvents', 'data.previousRecords', 'data.creatorName', 'data.deactivationHandoff'].includes(key))
    .map(([field, change]) => `${labels[field] || field.replace(/^data\./, '').replace(/([a-z])([A-Z])/g, '$1 $2')}: ${value(field, change.from)} → ${value(field, change.to)}`);
  return { title, details };
}
