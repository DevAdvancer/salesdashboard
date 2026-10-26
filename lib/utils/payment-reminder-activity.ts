type ActivityRow = Record<string, unknown>;

export function activityTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function paymentUpdates(value: unknown): ActivityRow[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(row => row && typeof row === 'object') : [];
  } catch { return []; }
}

/** Payment notes, including $0 follow-ups, reset the inactivity clock.
 * Native payment $updatedAt is deliberately excluded: reminder writes change it.
 * Follow-up payment dates are accounting dates, not the time an update was saved.
 */
export function latestPaymentActivityAt(payment: ActivityRow, followups: ActivityRow[], now: Date): string | null {
  const nowMs = now.getTime();
  const startedAt = activityTimestamp(payment.createdAt);
  const times: number[] = [];
  const include = (value: unknown) => {
    const timestamp = activityTimestamp(value);
    if (timestamp !== null && timestamp <= nowMs) times.push(timestamp);
  };
  include(payment.createdAt);
  include(payment.updatedAt);
  for (const update of paymentUpdates(payment.updates ?? payment.updatesJson)) include(update.createdAt);
  for (const followup of followups) {
    if (followup.leadId !== payment.leadId) continue;
    const createdAt = activityTimestamp(followup.createdAt) ?? activityTimestamp(followup.$createdAt);
    // Editing an earlier closure cycle's follow-up cannot reset this cycle.
    if (startedAt === null || createdAt === null || createdAt < startedAt) continue;
    include(followup.createdAt);
    include(followup.$createdAt);
    include(followup.updatedAt);
    include(followup.$updatedAt);
  }
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}
