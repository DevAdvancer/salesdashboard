import type { ResumeProfileStage } from '@/lib/types';

/**
 * SLA thresholds in milliseconds for each Resume Profile stage.
import type { ResumeProfileStage } from '@/lib/types';

/**
 * SLA thresholds in milliseconds for each Resume Profile stage.
 * If a profile remains in the stage longer than this duration without changing stage,
 * an alert notification will be triggered to the assigned agent and Resume Team Leads.
 */
export const RESUME_STAGE_SLA_MS: Record<ResumeProfileStage, number | null> = {
  'Draft & Approval': 2 * 60 * 60 * 1000, // 2 hours
  'Sent': 3 * 60 * 60 * 1000, // 3 hours
  'Modification /Approval (candidate/client)': 2 * 60 * 60 * 1000, // 2 hours
  'Doc Missing (Not calculated in the timeline)': null, // Excluded from timeline/alert
};
