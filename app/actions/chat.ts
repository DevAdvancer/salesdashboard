"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import {
  assertAuthenticatedUserId,
  getAuthenticatedUserDoc,
} from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import type { ChatChannelType, ChatMessage, Department, User } from "@/lib/types";
import { isValidDepartment } from "@/lib/types";
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

/**
 * Resume-team chat lives in its own collection; the Sales team keeps using
 * `chat_messages`. Both tables share an identical document shape so the same
 * read/write code serves either department — only the target collection differs.
 */
function chatCollectionForDepartment(department: Department) {
  return department === "resume"
    ? COLLECTIONS.RESUME_CHAT_MESSAGES
    : COLLECTIONS.CHAT_MESSAGES;
}

export async function listChatMessagesAction(input: {
  currentUserId: string;
  channel?: ChatChannelType;
  /**
   * Department the chat belongs to. Each department has its own pair of
   * channels (announcement / general). Required so the same chat page
   * can serve both teams without leaking messages across departments.
   */
  department: Department;
  limit?: number;
}) {
  await assertAuthenticatedUserId(input.currentUserId);

  if (!isValidDepartment(input.department)) {
    throw new Error("Invalid department");
  }

  const channel: ChatChannelType = input.channel ?? "general";

  const { databases } = await createAdminClient();
  const response = await databases.listDocuments(
    DATABASE_ID,
    chatCollectionForDepartment(input.department),
    [
      Query.equal("channel", channel),
      Query.equal("department", input.department),
      Query.orderAsc("createdAt"),
      Query.limit(Math.min(Math.max(input.limit ?? 200, 1), 200)),
    ],
  );

  return response.documents as unknown as ChatMessage[];
}

export async function sendChatMessageAction(input: {
  currentUserId: string;
  channel?: ChatChannelType;
  /**
   * Department the message is being posted in. The chat page always
   * supplies this from the user's active view (or pinned department for
   * non-leadership users).
   */
  department: Department;
  body: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);

  if (!isValidDepartment(input.department)) {
    throw new Error("Invalid department");
  }

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
    chatCollectionForDepartment(input.department),
    ID.unique(),
    {
      channel,
      department: input.department,
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
    metadata: { channel, department: input.department, bodyLength: body.length },
  });

  if (channel === "announcement" && user.role === "admin") {
    const usersResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.limit(5000),
    ]);
    const recipients = (usersResponse.documents as unknown as User[])
      .filter((u) => (u as unknown as { isActive?: unknown }).isActive !== false)
      .filter((u) => u.role !== "admin")
      .filter((u) => {
        // Leadership roles (admin/developer/monitor/operations) are exempt
        // from the split — they should get announcements from either team
        // since they can switch dashboards. Everyone else is matched on
        // their pinned department.
        const r = u.role;
        if (r === "admin" || r === "developer" || r === "monitor" || r === "operations") {
          return true;
        }
        const dept = (u as unknown as { department?: string }).department;
        return dept === input.department;
      })
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
      metadata: { recipientCount: recipients.length, department: input.department },
    });
  }

  return doc as unknown as ChatMessage;
}
