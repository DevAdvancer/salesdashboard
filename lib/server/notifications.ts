import { ID, type Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { sendNotificationEmail } from './email-service';
import { createAdminClient } from './appwrite';
import { CRM_PUBLIC_URL } from './crm-url';
import { queuePushToUser } from './web-push';

interface CreateNotificationInput {
  recipientId: string;
  type: string;
  title: string;
  body: string;
  targetId?: string | null;
  targetType?: string | null;
}

type RecipientDocument = { $id?: string; isActive?: unknown; notificationsEnabled?: unknown; notificationEmails?: string };

export async function createNotificationRecord(
  databases: Databases,
  input: CreateNotificationInput,
  /** The recipient's user document when the caller just read it; skips a re-read. */
  knownRecipient?: RecipientDocument
) {
  // Check the current user status before writing any in-app notification or email.
  const recipient: RecipientDocument = knownRecipient
    ?? await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, input.recipientId);
  if (recipient.isActive === false) return null;

  const record = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.NOTIFICATIONS,
    ID.unique(),
    {
      recipientId: input.recipientId,
      type: input.type,
      title: input.title,
      body: input.body,
      targetId: input.targetId ?? null,
      targetType: input.targetType ?? null,
      readAt: null,
      createdAt: new Date().toISOString(),
    }
  );

  // Desktop/phone pop-up even when no CRM tab is visible. Sent after the response.
  queuePushToUser(input.recipientId, { title: input.title, body: input.body, tag: record.$id,
    url: getNotificationLink(input.targetId, input.targetType)?.replace(CRM_PUBLIC_URL, '') || '/notifications' });

  await sendEmailForNotification(
    input.recipientId, 
    input.title, 
    input.body, 
    input.targetId, 
    input.targetType,
    recipient
  ).catch(console.error);

  return record;
}

function getNotificationLink(targetId?: string | null, targetType?: string | null): string | null {
  if (!targetId || !targetType) return null;
  const type = targetType.toLowerCase();
  if (type === 'lead') return `${CRM_PUBLIC_URL}/leads/${targetId}`;
  if (type === 'resume_profile') return `${CRM_PUBLIC_URL}/resume/${targetId}`;
  if (type === 'call_request') return `${CRM_PUBLIC_URL}/my-call-requests`;
  if (type === 'interview') return `${CRM_PUBLIC_URL}/resume/${targetId}`; // Or another appropriate route if interview has its own
  if (type === 'mock') return `${CRM_PUBLIC_URL}/resume/${targetId}`; // Same here
  if (type === 'user') return `${CRM_PUBLIC_URL}/profile/${targetId}`;
  if (type === 'linkedin_requests') return `${CRM_PUBLIC_URL}/linkedin-requests`;
  return null;
}

async function sendEmailForNotification(
  userId: string, 
  title: string, 
  body: string, 
  targetId?: string | null, 
  targetType?: string | null,
  // Read moments earlier by createNotificationRecord; no second user read.
  dbUser: RecipientDocument = {}
) {
  const { users } = await createAdminClient();
  
  try {
    const authUser = await users.get(userId);
    if (dbUser.isActive === false) return;
    
    if (authUser && authUser.email) {
      if (
        authUser.email.toLowerCase() === 'unassigned@silverspaceinc.com' ||
        authUser.email.toLowerCase() === 'teamlead@silverspaceinc.com'
      ) {
        return;
      }

      const notificationsEnabled = dbUser?.notificationsEnabled ?? true;
      if (!notificationsEnabled) {
        return;
      }

      const additionalEmailsStr = (dbUser?.notificationEmails || '').trim();
      let toEmails = [authUser.email];

      // Remove the hardcoded override for abhirupvizva@gmail.com, as they can now set it in settings.
      // Or keep it as a fallback if they haven't explicitly set additional emails?
      // "again report mail is going to abhirupvizva@gmail.com this email address. in setting page give options to enable or disable email notification and a text areawhere they can mention particular email they want to share the notifciation too."
      // Let's remove the hardcoded override.

      if (additionalEmailsStr) {
        const extraEmails = additionalEmailsStr.split(',').map((e: string) => e.trim()).filter(Boolean);
        toEmails = extraEmails;
      }

      const link = getNotificationLink(targetId, targetType);
      const linkHtml = link 
        ? `<div style="margin-top: 25px;"><a href="${link}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 14px;">View in CRM</a></div>` 
        : '';
      const linkText = link ? `\n\nView in CRM: ${link}` : '';

      await sendNotificationEmail({
        to: toEmails.join(','),
        subject: `New CRM Notification: ${title}`,
        text: `${title}\n\n${body}${linkText}\n\nYou are receiving this because of a new notification in the CRM. This email and any attachments are confidential and intended solely for the addressee.\nThis is sent from crm.silverspaceinc.tech. Please don't reply to this mail.`,
        html: `<p>${body}</p>${linkHtml}`
      });
    }
  } catch (err) {
    console.error('Failed to dispatch email notification to', userId, ':', err);
  }
}

export async function createNotificationsForRecipients(
  databases: Databases,
  recipientIds: Array<string | null | undefined>,
  input: Omit<CreateNotificationInput, 'recipientId'>,
  /** User documents the caller already listed, keyed by ID; avoids one read each. */
  knownRecipients?: ReadonlyMap<string, RecipientDocument>
) {
  const uniqueRecipientIds = Array.from(
    new Set(recipientIds.filter((recipientId): recipientId is string => Boolean(recipientId)))
  );

  await Promise.all(
    uniqueRecipientIds.map((recipientId) =>
      createNotificationRecord(databases, {
        ...input,
        recipientId,
      }, knownRecipients?.get(recipientId)).catch((error) => {
        console.error('Failed to create notification for', recipientId, ':', error);
        return null;
      })
    )
  );
}
