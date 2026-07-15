import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { RESUME_STAGE_SLA_MS } from '@/lib/constants/resume-sla';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { createNotificationsForRecipients } from '@/lib/server/notifications';
import { type ResumeProfile, type ResumeProfileStage } from '@/lib/types';
import { getResumeTeamLeadIds } from '@/lib/utils/resume-helpers';

type ResumeProfileDocument = ResumeProfile & { $id: string };

/**
 * Scans all active Resume Profiles and sends SLA breach notifications if a profile
 * has exceeded its stage SLA without an alert having been sent for the current stage.
 */
export async function checkAndNotifyResumeSla(): Promise<{ checked: number; alerted: number }> {
  const { databases } = await createAdminClient();
  const now = new Date().getTime();

  // Exclude Stage 5 from checking
  const docs = await listAllDocuments<ResumeProfileDocument>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.RESUME_PROFILES,
    queries: [
      Query.notEqual('stage', '5. Doc Missing (Not calculated in the timeline)'),
      Query.limit(500),
    ],
    pageLimit: 100,
    maxPages: 10,
  });

  const tlIds = await getResumeTeamLeadIds(databases);
  let alertedCount = 0;

  for (const doc of docs) {
    const stage = doc.stage as ResumeProfileStage;
    const slaMs = RESUME_STAGE_SLA_MS[stage];
    if (!slaMs) continue; // No SLA or Stage 5

    // If we already alerted for this exact stage, don't spam
    if (doc.lastAlertStage === stage) {
      continue;
    }

    const startStr = doc.stageUpdatedAt || doc.createdAt;
    if (!startStr) continue;

    const startMs = new Date(startStr).getTime();
    if (isNaN(startMs)) continue;

    const elapsed = now - startMs;
    if (elapsed > slaMs) {
      const hoursStr = Math.round(elapsed / (1000 * 60 * 60));
      const title = `Resume SLA Alert: ${doc.candidateName}`;
      const message = `Candidate "${doc.candidateName}" has been in stage "${stage}" for over ${hoursStr} hours (SLA exceeded).`;

      const recipientIds = new Set<string>();
      if (doc.assignedToId) recipientIds.add(doc.assignedToId);
      tlIds.forEach((id) => recipientIds.add(id));

      if (recipientIds.size > 0) {
        await createNotificationsForRecipients(
          databases,
          Array.from(recipientIds),
          {
            title,
            body: message,
            targetId: doc.$id,
            targetType: 'resume_profile',
            type: 'resume_sla_exceeded',
          }
        );
      }

      // Mark alerted
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.RESUME_PROFILES,
        doc.$id,
        {
          lastAlertStage: stage,
          lastAlertAt: new Date().toISOString(),
        },
      );

      alertedCount++;
    }
  }

  return { checked: docs.length, alerted: alertedCount };
}
