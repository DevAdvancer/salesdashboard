export type LeadHistorySnapshotEvent = {
  id: string; actorId: string; actorName: string; occurredAt: string; eventType: string;
  changes: Record<string, { from: unknown; to: unknown }>;
};
export function parseLeadHistory(raw: unknown): LeadHistorySnapshotEvent[] {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(value) ? value.filter((row): row is LeadHistorySnapshotEvent =>
      !!row && typeof row === 'object' && typeof row.id === 'string' && typeof row.actorId === 'string' &&
      typeof row.actorName === 'string' && typeof row.occurredAt === 'string' && typeof row.eventType === 'string' &&
      !!row.changes && typeof row.changes === 'object' && !Array.isArray(row.changes)) : [];
  } catch { return []; }
}
export function leadHistoryLabel(event: LeadHistorySnapshotEvent) {
  if (event.eventType === 'LEAD_CREATE') return 'Lead created';
  if (event.changes.isClosed?.from === true && event.changes.isClosed?.to === false) return 'Lead reopened';
  const status = event.changes.status?.to ?? event.changes['data.status']?.to;
  const normalized = typeof status === 'string' ? status.toLowerCase().replace(/[\s_-]/g, '') : '';
  if (normalized === 'backedout') return 'Marked Backed Out';
  if (normalized === 'notinterested') return 'Marked Not Interested';
  if (status) return `Status changed to ${String(status)}`;
  if (event.changes.ownerId || event.changes.assignedToId) return 'Lead reassigned';
  return 'Lead updated';
}
