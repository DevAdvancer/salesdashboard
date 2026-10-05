import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';

export const REPORT_EMAIL_SETTINGS_ID = 'scheduled_reports';
export const REPORT_EMAIL_MANAGER = 'abhirupvizva@gmail.com';

export function parseReportEmails(value: string): string[] {
  const entries = value.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
  if (entries.some((email) => !emailPattern.test(email))) {
    throw new Error('Enter valid email addresses separated by commas or new lines.');
  }
  return [...new Set(entries)];
}

export async function getReportEmails(databases?: Awaited<ReturnType<typeof createAdminClient>>['databases']): Promise<string[]> {
  const db = databases ?? (await createAdminClient()).databases;
  try {
    const doc = await db.getDocument(DATABASE_ID, COLLECTIONS.REPORT_EMAIL_SETTINGS, REPORT_EMAIL_SETTINGS_ID);
    return parseReportEmails(String(doc.emails ?? ''));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 404) {
      return [];
    }
    throw error;
  }
}
