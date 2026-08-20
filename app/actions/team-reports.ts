"use server";
import { ID, Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";

export async function saveTeamReportAction(input: {
  currentUserId: string;
  companyName: string;
  reportDate: string;
  data: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const { databases } = await createAdminClient();

  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.TEAM_REPORTS, [
    Query.equal("companyName", input.companyName),
    Query.equal("reportDate", input.reportDate),
    Query.limit(1),
  ]);

  if (response.documents.length > 0) {
    const docId = response.documents[0].$id;
    return databases.updateDocument(DATABASE_ID, COLLECTIONS.TEAM_REPORTS, docId, {
      data: input.data,
    });
  } else {
    return databases.createDocument(DATABASE_ID, COLLECTIONS.TEAM_REPORTS, ID.unique(), {
      companyName: input.companyName,
      reportDate: input.reportDate,
      data: input.data,
      createdAt: new Date().toISOString(),
    });
  }
}

export async function getTeamReportAction(input: {
  currentUserId: string;
  companyName: string;
  reportDate: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const { databases } = await createAdminClient();

  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.TEAM_REPORTS, [
    Query.equal("companyName", input.companyName),
    Query.equal("reportDate", input.reportDate),
    Query.limit(1),
  ]);

  if (response.documents.length > 0) {
    return response.documents[0];
  }

  return null;
}

export async function getLatestTeamReportAction(input: {
  currentUserId: string;
  companyName: string;
}) {
  await assertAuthenticatedUserId(input.currentUserId);
  const { databases } = await createAdminClient();

  const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.TEAM_REPORTS, [
    Query.equal("companyName", input.companyName),
    Query.orderDesc("reportDate"),
    Query.limit(1),
  ]);

  if (response.documents.length > 0) {
    return response.documents[0];
  }

  return null;
}
