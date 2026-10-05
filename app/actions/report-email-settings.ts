'use server';

import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedAccount, getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { getReportEmails, parseReportEmails, REPORT_EMAIL_MANAGER, REPORT_EMAIL_SETTINGS_ID } from '@/lib/server/report-email-settings';

async function assertReportEmailManager() {
  const [account, user] = await Promise.all([getAuthenticatedAccount(), getAuthenticatedUserDoc()]);
  if (user.role !== 'admin' || account.email.toLowerCase() !== REPORT_EMAIL_MANAGER || user.email.toLowerCase() !== REPORT_EMAIL_MANAGER) {
    throw new Error('You are not allowed to manage report recipients.');
  }
}

export async function getReportEmailSettingsAction() {
  await assertReportEmailManager();
  return getReportEmails();
}

export async function saveReportEmailSettingsAction(value: string) {
  await assertReportEmailManager();
  if (value.length > 4000) throw new Error('The recipient list is too long.');
  const emails = parseReportEmails(value);
  if (emails.length > 50) throw new Error('Use no more than 50 email addresses.');
  const { databases } = await createAdminClient();
  const data = { emails: emails.join(',') };
  try {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.REPORT_EMAIL_SETTINGS, REPORT_EMAIL_SETTINGS_ID, data);
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 404) throw error;
    await databases.createDocument(DATABASE_ID, COLLECTIONS.REPORT_EMAIL_SETTINGS, REPORT_EMAIL_SETTINGS_ID, data);
  }
  return emails;
}
