"use server";

import { ID, Permission, Query, Role } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import type { ComponentKey, UserRole } from "@/lib/types";

type EditableRole = Exclude<UserRole, "admin">;

async function logAccessSettingChange(input: {
  actorId: string;
  actorName: string;
  componentKey: ComponentKey;
  role: EditableRole;
  from: boolean | null;
  to: boolean;
}) {
  const { databases } = await createAdminClient();

  await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.AUDIT_LOGS,
    ID.unique(),
    {
      action: "SETTINGS_UPDATE",
      actorId: input.actorId,
      actorName: input.actorName,
      targetId: "access-control",
      targetType: "settings",
      metadata: JSON.stringify({
        section: "Access Control",
        componentKey: input.componentKey,
        role: input.role,
        allowed: {
          from: input.from,
          to: input.to,
        },
      }),
      performedAt: new Date().toISOString(),
    },
    [
      Permission.read(Role.any()),
      Permission.update(Role.label("admin")),
      Permission.delete(Role.label("admin")),
    ]
  );
}

export async function updateAccessRuleAction(input: {
  currentUserId: string;
  componentKey: ComponentKey;
  role: EditableRole;
  allowed: boolean;
  ruleId?: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);

  if (input.componentKey === "settings") {
    throw new Error("Profile settings cannot be disabled");
  }

  if (!isRoleEligibleForComponent(input.componentKey, input.role)) {
    throw new Error("This role is not eligible for this component");
  }

  const { databases } = await createAdminClient();
  const actor = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, input.currentUserId);
  const actorRole = actor.role as UserRole;
  const canEditRole = actorRole === "admin" || (
    actorRole === "manager" && (input.role === "team_lead" || input.role === "agent")
  );

  if (!canEditRole) {
    throw new Error("Permission denied");
  }

  let existingRuleId = input.ruleId;
  let previousAllowed: boolean | null = null;

  if (existingRuleId) {
    const existingRule = await databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.ACCESS_CONFIG,
      existingRuleId
    );
    previousAllowed = Boolean(existingRule.allowed);
  } else {
    const existingRules = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.ACCESS_CONFIG,
      [
        Query.equal("componentKey", input.componentKey),
        Query.equal("role", input.role),
        Query.limit(1),
      ]
    );
    const existingRule = existingRules.documents[0];
    if (existingRule) {
      existingRuleId = existingRule.$id;
      previousAllowed = Boolean(existingRule.allowed);
    }
  }

  const doc = existingRuleId
    ? await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.ACCESS_CONFIG,
        existingRuleId,
        { allowed: input.allowed }
      )
    : await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.ACCESS_CONFIG,
        ID.unique(),
        {
          componentKey: input.componentKey,
          role: input.role,
          allowed: input.allowed,
        }
      );

  await logAccessSettingChange({
    actorId: actor.$id,
    actorName: actor.name,
    componentKey: input.componentKey,
    role: input.role,
    from: previousAllowed,
    to: input.allowed,
  });

  return {
    $id: doc.$id,
    componentKey: doc.componentKey as ComponentKey,
    role: doc.role as EditableRole,
    allowed: Boolean(doc.allowed),
  };
}
