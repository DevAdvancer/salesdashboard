"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import {
  assertAuthenticatedUserId,
  getAuthenticatedUserDoc,
} from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { ChatChannelType, ChatMessage, User } from "@/lib/types";
import { createNotificationsForRecipients } from "@/lib/server/notifications";

async function logAuditAction(
  databases: Awaited<ReturnType<typeof createAdminClient>>["databases"],
  input: {
    action: string;
    actorId: string;
    actorName: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
      action: input.action,
      actorId: input.actorId,
      actorName: input.actorName,
      targetId: input.targetId ?? null,
      targetType: input.targetType,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      performedAt: new Date().toISOString(),
    });
  } catch {
    return;
  }
}

function truncateNotificationBody(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 157)}...`;
}

export async function listChatMessagesAction(input: {
  currentUserId: string;
  channel?: ChatChannelType;
  limit?: number;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const channel: ChatChannelType = input.channel ?? "general";

  const { databases } = await createAdminClient();
  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.CHAT_MESSAGES, [
    Query.equal("channel", channel),
    Query.orderAsc("createdAt"),
    Query.limit(Math.min(Math.max(input.limit ?? 200, 1), 200)),
  ]);

  return response.documents as unknown as ChatMessage[];
}

export async function sendChatMessageAction(input: {
  currentUserId: string;
  channel?: ChatChannelType;
  body: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const user = await getAuthenticatedUserDoc();

  const body = input.body.trim();
  if (!body) {
    throw new Error("Message is required");
  }

  const channel: ChatChannelType = input.channel ?? "general";

  if (channel === "announcement" && user.role !== "admin") {
    throw new Error("Unauthorized");
  }

  const { databases } = await createAdminClient();
  const createdAt = new Date().toISOString();
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.CHAT_MESSAGES,
    ID.unique(),
    {
      channel,
      body,
      createdById: user.$id,
      createdByName: user.name,
      createdAt,
    },
  );

  await logAuditAction(databases, {
    action: "CHAT_MESSAGE_SEND",
    actorId: user.$id,
    actorName: user.name,
    targetType: "chat_message",
    targetId: doc.$id,
    metadata: { channel, bodyLength: body.length },
  });

  if (channel === "announcement" && user.role === "admin") {
    const usersResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.limit(5000),
    ]);
    const recipients = (usersResponse.documents as unknown as User[])
      .filter((u) => (u as unknown as { isActive?: unknown }).isActive !== false)
      .filter((u) => u.role !== "admin")
      .map((u) => u.$id);

    await createNotificationsForRecipients(databases, recipients, {
      type: "CHAT_ANNOUNCEMENT",
      title: "Announcement",
      body: truncateNotificationBody(body),
      targetType: "chat",
      targetId: doc.$id,
    });

    await logAuditAction(databases, {
      action: "CHAT_ANNOUNCEMENT_NOTIFY",
      actorId: user.$id,
      actorName: user.name,
      targetType: "chat_message",
      targetId: doc.$id,
      metadata: { recipientCount: recipients.length },
    });
  }

  return doc as unknown as ChatMessage;
}
