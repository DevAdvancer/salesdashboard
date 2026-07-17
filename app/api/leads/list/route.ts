import { NextRequest, NextResponse } from "next/server";
import { listLeadsAction } from "@/app/actions/lead";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filters, userId, role, branchIds, options } = body;
    
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
