import { NextResponse, type NextRequest } from "next/server";
import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";

function getAuthorizationToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: NextRequest): { authorized: boolean; debug?: any } {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const providedToken = getAuthorizationToken(request);
  const providedHeader = request.headers.get('x-cron-secret');
  const provided = providedToken ?? providedHeader;
  
  if (!expected) {
    return { authorized: false, debug: { reason: 'No CRON_SECRET in env' } };
  }
  
  const authorized = Boolean(provided) && provided === expected;
  if (!authorized) {
    return { 
      authorized: false, 
      debug: { 
        reason: 'Mismatch', 
        hasAuthHeader: !!authHeader,
        providedLength: provided?.length,
        expectedLength: expected?.length
      } 
    };
  }
  
  return { authorized: true };
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = isAuthorized(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized", debug: auth.debug }, { status: 401 });
  }

  try {
    const { databases } = await createAdminClient();
    
    // 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.NOTIFICATIONS,
      [
        Query.lessThanEqual("$createdAt", thirtyDaysAgoIso),
        Query.limit(5000)
      ]
    );

    let deleted = 0;
    for (const doc of response.documents) {
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.NOTIFICATIONS, doc.$id);
      deleted++;
    }

    return NextResponse.json({
      success: true,
      deletedCount: deleted,
    });
  } catch (error: any) {
    console.error("Cleanup notifications error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
