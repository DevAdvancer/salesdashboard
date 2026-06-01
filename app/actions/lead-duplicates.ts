"use server";

import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createNotificationsForRecipients } from "@/lib/server/notifications";
import { getAppwriteErrorMessage } from "@/lib/server/appwrite-errors";

export async function notifyDuplicateLinkedinUrlUpdateAttemptAction(input: {
  actorId: string;
  actorName: string;
  leadId: string;
  linkedinProfileUrl: string;
  existingLeadId: string;
}) {
  await assertAuthenticatedUserId(input.actorId);

  const { databases } = await createAdminClient();

  try {
    const users = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
      Query.or([Query.equal("role", "admin"), Query.equal("role", "team_lead")]),
      Query.limit(5000),
    ]);

    const recipientIds = users.documents.map((doc: any) => doc.$id).filter(Boolean);

    await createNotificationsForRecipients(databases, recipientIds, {
      type: "LEAD_DUPLICATE_LINKEDIN_URL",
      title: "Duplicate LinkedIn URL blocked",
      body: `${input.actorName} attempted to save a duplicate LinkedIn profile URL.\n\nLead: ${input.leadId}\nLinkedIn URL: ${input.linkedinProfileUrl}\nExisting lead: ${input.existingLeadId}`,
      targetId: input.leadId,
      targetType: "LEAD",
    });
  } catch (error) {
    throw new Error(getAppwriteErrorMessage(error));
  }
}

