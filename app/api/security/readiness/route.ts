import { NextResponse } from 'next/server';
import { Query, Client, Storage } from 'node-appwrite';
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { crmAccessEnabled, securityDatabase } from '@/lib/server/crm-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const db = securityDatabase();
    const attributes = await Promise.all([
      db.getAttribute(DATABASE_ID, COLLECTIONS.LEADS, 'history'),
      db.getAttribute(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, 'expiresAt'),
      db.getAttribute(DATABASE_ID, COLLECTIONS.CRM_ACCESS_REQUESTS, 'state'),
    ]);
    let cursor: string | undefined; let allDisabled = true;
    do {
      const page = await db.listCollections(DATABASE_ID, [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
      allDisabled = allDisabled && page.collections.every(collection => !collection.enabled);
      cursor = page.collections.length === 100 ? page.collections.at(-1)!.$id : undefined;
    } while (cursor);
    const bucket = await new Storage(new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!)).getBucket(BUCKETS.RESUMES);
    const cutoverReady = crmAccessEnabled() && process.env.CRM_LEAD_HISTORY_SNAPSHOT === 'true' && attributes.every(attr => (attr as { status?: string }).status === 'available');
    return NextResponse.json({ protocol: 'crm-gateway-appwrite-otp-v1', cutoverReady, emailProvider: 'appwrite',
      nativeClientIsolation: allDisabled && !bucket.enabled }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ protocol: 'crm-gateway-appwrite-otp-v1', cutoverReady: false }, { status: 503 }); }
}
