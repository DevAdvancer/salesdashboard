import { NextRequest, NextResponse } from 'next/server';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { securityDatabase } from '@/lib/server/crm-access';
import { LEAD_PROFILE_CHECKPOINT } from '@/lib/server/lead-profile-index';
import { profileIndexPlan } from '@/lib/server/lead-profile-index-maintenance';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const db = securityDatabase();
    try {
      const marker = await db.getDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_CHECKPOINT);
      if (marker.leadId !== 'ready') return NextResponse.json({ skipped: 'Index has been disabled.' });
    }
    catch (error) {
      if ((error as { code?: number }).code === 404) return NextResponse.json({ skipped: 'Index is not provisioned.' });
      throw error;
    }
    const plan = await profileIndexPlan(db);
    return NextResponse.json(await plan.apply());
  } catch {
    return NextResponse.json({ error: 'Profile index refresh failed; the previous checkpoint remains safe.' }, { status: 503 });
  }
}
