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

  await sendEmailForNotification(input.recipientId, input.title, input.body).catch(console.error);

  return record;
}

async function sendEmailForNotification(userId: string, title: string, body: string) {
  const { users } = await createAdminClient();
  
  try {
    const user = await users.get(userId);
    
    if (user && user.email) {
      await sendNotificationEmail({
        to: user.email,
        subject: `New CRM Notification: ${title}`,
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; background-color: #09090b; color: #e4e4e7; padding: 40px 20px; min-height: 100%;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 30px;">
              <h2 style="margin-top: 0; color: #ffffff; font-size: 20px; font-weight: 600;">${title}</h2>
              <p style="font-size: 15px; line-height: 1.6; color: #d4d4d8;">${body}</p>
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
    console.error(`Failed to dispatch email notification to ${userId}:`, err);
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
        console.error(`Failed to create notification for ${recipientId}:`, error);
        return null;
      })
    )
  );
}
