import { easternWallTimeToIso } from '@/lib/utils/eastern-date';

/** Date-only CRM filters mean an Eastern business day. Existing instants pass through. */
export function expandIsoDateToStart(value: string): string {
  if (!value || value.includes('T') || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return easternWallTimeToIso(`${value}T00:00`);
}

/** Inclusive Eastern end of day, automatically accounting for EST/EDT. */
export function expandIsoDateToEnd(value: string): string {
  if (!value || value.includes('T') || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return easternWallTimeToIso(`${value}T23:59`).replace(':00.000Z', ':59.999Z');
}
