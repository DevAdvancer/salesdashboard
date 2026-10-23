import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { MAINTENANCE_MANAGER_EMAIL, MAINTENANCE_MANAGER_USER_ID } from "@/lib/constants/maintenance";
import { headers } from 'next/headers';
import { isLocalMaintenanceRequest } from '@/lib/utils/maintenance-scope';

export const MAINTENANCE_SETTINGS_ID = "global";

export type MaintenanceStatus = {
  active: boolean;
  enabled: boolean;
  endsAt: string | null;
};

export function isMaintenanceManager(account: { $id?: string; email?: string; role?: string }) {
  return account.email?.trim().toLowerCase() === MAINTENANCE_MANAGER_EMAIL &&
    account.$id === MAINTENANCE_MANAGER_USER_ID &&
    (!account.role || account.role === "admin");
}

export function parseMaintenanceConfig(raw: unknown, now: Date = new Date()): MaintenanceStatus {
  if (typeof raw !== "string") return { active: false, enabled: false, endsAt: null };
  const config = JSON.parse(raw) as { enabled?: unknown; endsAt?: unknown };
  const enabled = config.enabled === true;
  const endsAt = typeof config.endsAt === "string" && !Number.isNaN(Date.parse(config.endsAt))
    ? config.endsAt : null;
  return { enabled, endsAt, active: enabled && Boolean(endsAt) && Date.parse(endsAt!) > now.getTime() };
}

export async function getMaintenanceStatus(
  databases?: Awaited<ReturnType<typeof createAdminClient>>["databases"],
): Promise<MaintenanceStatus> {
  const db = databases ?? (await createAdminClient()).databases;
  db.clearReadCacheForCollection?.(COLLECTIONS.MAINTENANCE_SETTINGS);
  try {
    const doc = await db.getDocument(DATABASE_ID, COLLECTIONS.MAINTENANCE_SETTINGS,
      MAINTENANCE_SETTINGS_ID);
    return parseMaintenanceConfig(doc.config);
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return { active: false, enabled: false, endsAt: null };
    }
    throw error;
  }
}

/**
 * The per-request guard runs on every server action, the CRM access check and
 * the layout's status check. Re-reading the single settings document each time
 * cost tens of thousands of reads a month while maintenance was almost always
 * off. Keep the last result for a short window instead. `active` is still
 * recomputed against the current time, so a scheduled end takes effect on time.
 * Saving the settings clears this cache; other warm server instances pick up
 * the change within MAINTENANCE_STATUS_TTL_MS.
 */
export const MAINTENANCE_STATUS_TTL_MS = 30_000;
let cachedMaintenance: { expiresAt: number; enabled: boolean; endsAt: string | null } | null = null;
let pendingMaintenance: Promise<MaintenanceStatus> | null = null;

export function clearMaintenanceStatusCache() {
  cachedMaintenance = null;
  pendingMaintenance = null;
}

async function getCachedMaintenanceStatus(): Promise<MaintenanceStatus> {
  const now = Date.now();
  if (cachedMaintenance && cachedMaintenance.expiresAt > now) {
    const { enabled, endsAt } = cachedMaintenance;
    return { enabled, endsAt, active: enabled && Boolean(endsAt) && Date.parse(endsAt!) > now };
  }
  if (!pendingMaintenance) {
    const pending = getMaintenanceStatus().then((status) => {
      // Ignore a result that raced with clearMaintenanceStatusCache().
      if (pendingMaintenance === pending) {
        cachedMaintenance = { expiresAt: Date.now() + MAINTENANCE_STATUS_TTL_MS, enabled: status.enabled, endsAt: status.endsAt };
      }
      return status;
    }).finally(() => {
      if (pendingMaintenance === pending) pendingMaintenance = null;
    });
    pendingMaintenance = pending;
  }
  return pendingMaintenance;
}

/** Effective access status for this site; admin settings keep reading the raw live configuration. */
export async function getRequestMaintenanceStatus(requestHeaders?: Pick<Headers, 'get'>): Promise<MaintenanceStatus> {
  const incoming = requestHeaders ?? await headers();
  if (isLocalMaintenanceRequest(incoming, {
    nodeEnv:process.env.NODE_ENV,
    hosted:process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV),
  })) return {active:false,enabled:false,endsAt:null};
  return getCachedMaintenanceStatus();
}
