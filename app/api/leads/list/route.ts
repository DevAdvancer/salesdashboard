import { NextRequest, NextResponse } from "next/server";
import { listLeadsAction } from "@/app/actions/lead/queries";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    let { filters = {}, userId, role, branchIds, options = {} } = body;
    
    if (!userId) {
      const userDoc = await getAuthenticatedUserDoc();
      userId = userDoc.$id;
      role = userDoc.role;
      branchIds = userDoc.branchIds;
    }
    
    const result = await listLeadsAction(
      filters,
      userId,
      role,
      branchIds,
      options
    );
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error in POST /api/leads/list:", error);
    return NextResponse.json(
      { error: error.message || "An error occurred fetching leads" },
      { status: 500 }
    );
  }
}
