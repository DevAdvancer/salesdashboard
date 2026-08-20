import { redirect } from "next/navigation";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { TeamReportGenerator } from "@/components/team-report/team-report-generator";
import { Suspense } from "react";

export const metadata = {
  title: "Team Report Generator - CRM",
};

export default async function TeamReportPage() {
  const user = await getAuthenticatedUserDoc();
  
  if (!user) {
    redirect("/login");
  }

  // Define static companies for the dropdown
  const companies = ["Silverspace INC", "Vizva INC", "Flawless-ED"];

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Team Report Generator</h1>
      <p className="text-muted-foreground mb-8">
        Fill in today's numbers, then copy the formatted report. Data is saved automatically.
      </p>
      
      <Suspense fallback={<div>Loading generator...</div>}>
        <TeamReportGenerator currentUserId={user.$id} companies={companies} />
      </Suspense>
    </div>
  );
}
