import { ID, type Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { sendNotificationEmail } from './email-service';
import { createAdminClient } from './appwrite';

interface CreateNotificationInput {
  recipientId: string;
  type: string;
  title: string;
  body: string;
  targetId?: string | null;
  targetType?: string | null;
}

export async function createNotificationRecord(
  databases: Databases,
  input: CreateNotificationInput
) {
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

  await sendEmailForNotification(
    input.recipientId, 
    input.title, 
    input.body, 
    input.targetId, 
    input.targetType
  ).catch(console.error);

  return record;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:5000';

function getNotificationLink(targetId?: string | null, targetType?: string | null): string | null {
  if (!targetId || !targetType) return null;
  const type = targetType.toLowerCase();
  if (type === 'lead') return `${APP_URL}/leads/${targetId}`;
  if (type === 'resume_profile') return `${APP_URL}/resume/${targetId}`;
  if (type === 'call_request') return `${APP_URL}/my-call-requests`;
  if (type === 'interview') return `${APP_URL}/resume/${targetId}`; // Or another appropriate route if interview has its own
  if (type === 'mock') return `${APP_URL}/resume/${targetId}`; // Same here
  if (type === 'user') return `${APP_URL}/profile/${targetId}`;
  return null;
}

async function sendEmailForNotification(
  userId: string, 
  title: string, 
  body: string, 
  targetId?: string | null, 
  targetType?: string | null
) {
  const { users } = await createAdminClient();
  
  try {
    const authUser = await users.get(userId);
    const { databases } = await createAdminClient();
    let dbUser: any = null;
    try {
      dbUser = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    } catch (e) {
      // Ignored
    }
    
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
        toEmails.push(...extraEmails);
      }

      const link = getNotificationLink(targetId, targetType);
      const linkHtml = link 
        ? `<div style="margin-top: 25px;"><a href="${link}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 14px;">View in CRM</a></div>` 
        : '';
      const linkText = link ? `\n\nView in CRM: ${link}` : '';

      await sendNotificationEmail({
        to: toEmails.join(','),
        subject: `New CRM Notification: ${title}`,
        text: `${title}\n\n${body}${linkText}\n\nYou are receiving this because of a new notification in the CRM.\nThis is sent from sales.silverspace.tech. Please don't reply to this mail.`,
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; background-color: #09090b; color: #e4e4e7; padding: 40px 20px; min-height: 100%;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 30px;">
              <h2 style="margin-top: 0; color: #ffffff; font-size: 20px; font-weight: 600;">${title}</h2>
              <p style="font-size: 15px; line-height: 1.6; color: #d4d4d8;">${body}</p>
              ${linkHtml}
              <hr style="margin-top: 30px; margin-bottom: 20px; border: none; border-top: 1px solid #27272a;" />
              <p style="margin: 0; font-size: 12px; color: #a1a1aa; line-height: 1.5;">
                You are receiving this because of a new notification in the CRM.<br />
                This is sent from sales.silverspace.tech. Please don't reply to this mail.
              </p>
            </div>
          </div>
        `
      });
    }
  } catch (err) {
    console.error('Failed to dispatch email notification to', userId, ':', err);
  }
}

export async function createNotificationsForRecipients(
  databases: Databases,
  recipientIds: Array<string | null | undefined>,
  input: Omit<CreateNotificationInput, 'recipientId'>
) {
  const uniqueRecipientIds = Array.from(
    new Set(recipientIds.filter((recipientId): recipientId is string => Boolean(recipientId)))
  );

  await Promise.all(
    uniqueRecipientIds.map((recipientId) =>
      createNotificationRecord(databases, {
        ...input,
        recipientId,
      }).catch((error) => {
        console.error('Failed to create notification for', recipientId, ':', error);
        return null;
      })
    )
  );
}
