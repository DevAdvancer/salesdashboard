import { ID, type Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';

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
  return databases.createDocument(
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
