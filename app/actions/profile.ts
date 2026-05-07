"use server";

import { ID, Permission, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";

async function logProfileUpdate(input: {
  actorId: string;
  actorName: string;
  metadata: Record<string, unknown>;
}) {
  const { databases } = await createAdminClient();

  try {
    await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.AUDIT_LOGS,
      ID.unique(),
      {
        action: "USER_UPDATE",
        actorId: input.actorId,
        actorName: input.actorName,
        targetId: input.actorId,
        targetType: "user",
        metadata: JSON.stringify(input.metadata),
        performedAt: new Date().toISOString(),
      },
      [
        Permission.read(Role.any()),
        Permission.update(Role.label("admin")),
        Permission.delete(Role.label("admin")),
      ]
    );
  } catch (error) {
    console.error("Failed to log profile update:", error);
  }
}

export async function updateOwnProfileAction(input: {
  currentUserId: string;
  name: string;
}) {
  const normalizedName = input.name.trim();

  if (!input.currentUserId) {
    throw new Error("Unauthorized");
  }

  if (normalizedName.length < 2) {
    throw new Error("Name must be at least 2 characters");
  }

  if (normalizedName.length > 120) {
    throw new Error("Name must be 120 characters or fewer");
  }

  const { databases } = await createAdminClient();
  const currentUser = await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.USERS,
    input.currentUserId
  );

  await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.USERS,
    input.currentUserId,
    { name: normalizedName }
  );

  await logProfileUpdate({
    actorId: currentUser.$id,
    actorName: currentUser.name,
    metadata: {
      profileSelfUpdate: true,
      section: "Profile Settings",
      changes: {
        name: {
          from: currentUser.name,
          to: normalizedName,
        },
      },
    },
  });

  return { success: true, name: normalizedName };
}
