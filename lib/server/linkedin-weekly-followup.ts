import { Query, type Databases } from 'node-appwrite';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { createAdminClient } from '@/lib/server/appwrite';
import { LINKEDIN_CONVERSATIONS_FEATURE, listBetaFeatureAccess } from '@/lib/server/beta-feature-access';
import { canJoinLinkedinConversations } from '@/lib/server/linkedin-conversation-access';
import { buildLinkedinConversationExportRows, projectLinkedinConversation, readLabels,
  readLinkedinInvitations } from '@/lib/server/linkedin-conversation-reads';
import { claimLinkedinWeeklyEmail } from '@/lib/server/linkedin-conversation-storage';
import { sendNotificationEmail } from '@/lib/server/email-service';
import type { User } from '@/lib/types';
import type { LinkedinConversationExportRow } from '@/lib/types/linkedin-conversation';
import { buildLinkedinConversationWorkbook } from '@/lib/utils/linkedin-conversation-workbook';
import { logger } from '@/lib/utils/logger';
import { COMPONENT_ACCESS } from '@/lib/constants/component-access';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { isLinkedinConversationReleased } from '@/lib/utils/linkedin-conversation-release';

const emailAddress = z.email();

async function deliverReport(databases: Databases, to: string, rows: LinkedinConversationExportRow[],
  { start, end }: { start: string; end: string }) {
  const content: Buffer = XLSX.write(buildLinkedinConversationWorkbook(XLSX, rows), {
    type: 'buffer', bookType: 'xlsx', compression: true,
  });
  const claim = await claimLinkedinWeeklyEmail(databases, rows[0].agentId, start);
  if (!claim) return 'duplicate';

  const text = `Your LinkedIn follow-up report includes invitations you recorded from ${start} through the Friday morning run on ${end} (Eastern time). Open the attached workbook to review their current status and saved conversations.`;
  try {
    const sent = await sendNotificationEmail({
      to, subject: `LinkedIn follow-up report · Week of ${start}`, html: `<p>${text}</p>`, text,
      allowAllRecipients: true,
      attachments: [{
        filename: `linkedin-followups-${start}.xlsx`, content,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });
    if (!sent) throw new Error('Weekly LinkedIn email delivery failed.');
  } catch (error) {
    // Release failed sends for retry. Keep successful claims to prevent
    // duplicate emails when scheduler runs overlap.
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_CONVERSATIONS, claim);
    throw error;
  }
  return 'sent';
}

export async function sendLinkedinWeeklyFollowups(databases: Awaited<ReturnType<typeof createAdminClient>>['databases'],
  range: { start: string; end: string }) {
  const released = isLinkedinConversationReleased();
  const access = released ? null : await listBetaFeatureAccess(databases, LINKEDIN_CONVERSATIONS_FEATURE);
  const fields = ['role', 'department', 'isActive', 'name', 'email'];
  const users = released
    ? new Map((await listAllDocuments<User>({ databases, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
      queries: [Query.equal('role', [...COMPONENT_ACCESS['linkedin-conversations']]), Query.select(['$id', ...fields])],
      requireComplete: true })).map(user => [user.$id, user]))
    : await readLabels<User>(databases, COLLECTIONS.USERS, [...access!], fields);
  const recipients = new Map([...users].filter(([id, user]) =>
    (!access || access.has(id)) && canJoinLinkedinConversations(user) && emailAddress.safeParse(user.email).success));
  const ids = [...recipients.keys()];
  const result = { sent: 0, duplicate: 0, failed: 0 };

  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const allowed = new Set(batch);
    const requests = await readLinkedinInvitations(databases, { ...range, mode: 'sent' },
      [Query.equal('agentId', batch)], request => allowed.has(request.agentId));
    const rows = await buildLinkedinConversationExportRows(databases, requests.map(request => ({
      ...projectLinkedinConversation(request, false), agent: recipients.get(request.agentId)!.name,
    })));
    const byOwner = new Map<string, LinkedinConversationExportRow[]>();
    for (const row of rows) {
      const personalRows = byOwner.get(row.agentId) ?? [];
      personalRows.push(row);
      byOwner.set(row.agentId, personalRows);
    }
    const groups = [...byOwner.entries()];
    for (let index = 0; index < groups.length; index += 5) {
      await Promise.all(groups.slice(index, index + 5).map(async ([owner, personalRows]) => {
        try {
          const outcome = await deliverReport(databases, recipients.get(owner)!.email, personalRows, range);
          result[outcome]++;
        } catch (error) {
          result.failed++;
          logger.error('LinkedIn weekly follow-up email failed', error);
        }
      }));
    }
  }
  return result;
}
