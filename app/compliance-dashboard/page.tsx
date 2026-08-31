import { Metadata } from "next";
import { Suspense } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { AlertCircle, Clock, CheckCircle2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { Query } from "node-appwrite";
import Link from "next/link";
import { format } from "date-fns";


async function ComplianceContent() {
  const actor = await getAuthenticatedUserDoc();
  if (!actor || actor.role !== 'compliance') {
    return <div>Access denied</div>;
  }

  const { databases } = await createAdminClient();

  const [pendingReq, approvedReq] = await Promise.all([
    databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.RESUME_PROFILES,
      [Query.equal('complianceStatus', 'pending'), Query.limit(100), Query.orderDesc('createdAt')]
    ),
    databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.RESUME_PROFILES,
      [Query.equal('complianceStatus', 'approved'), Query.limit(1)]
    )
  ]);

  const pendingProfiles = pendingReq.documents;
  const totalApproved = approvedReq.total;
  const remainingRequests = pendingReq.total;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto px-4 md:px-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Compliance Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Review and approve resume profiles before processing.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Approvals</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{remainingRequests}</div>
            <p className="text-xs text-muted-foreground mt-1">Awaiting compliance review</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Approved Profiles</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalApproved}</div>
            <p className="text-xs text-muted-foreground mt-1">Total lifetime approvals</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Incoming Requests for Approval</CardTitle>
          <CardDescription>Profiles that need to be approved or rejected.</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingProfiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 text-emerald-100 dark:text-emerald-900/50 mb-4" />
              <p className="text-lg font-medium text-foreground">You&apos;re all caught up!</p>
              <p>No profiles are currently awaiting compliance review.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <div className="grid grid-cols-5 gap-4 p-4 border-b bg-muted/40 font-semibold text-sm">
                <div className="col-span-2">Candidate Name</div>
                <div>Created At</div>
                <div>Created By</div>
                <div className="text-right">Action</div>
              </div>
              <div className="divide-y max-h-[500px] overflow-y-auto">
                {pendingProfiles.map((p) => (
                  <div key={p.$id} className="grid grid-cols-5 gap-4 p-4 text-sm items-center hover:bg-muted/30">
                    <div className="col-span-2 font-medium">{p.candidateName}</div>
                    <div className="text-muted-foreground">{format(new Date(p.createdAt), "MMM d, yyyy h:mm a")}</div>
                    <div>{p.createdByName || 'Unknown'}</div>
                    <div className="text-right">
                      <Link href={`/compliance/${p.$id}`}>
                        <span className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-primary text-primary-foreground shadow hover:bg-primary/90 h-8 px-3">
                          Review Profile
                        </span>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ComplianceDashboardPage() {
  return (
    <ProtectedRoute componentKey="compliance-dashboard">
      <Suspense fallback={<div className="p-8">Loading compliance data...</div>}>
        <ComplianceContent />
      </Suspense>
    </ProtectedRoute>
  );
}
