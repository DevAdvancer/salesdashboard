import { Suspense } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { TableSkeleton } from '@/components/ui/skeleton';
import { listMarketingProfilesAction } from '@/app/actions/resume-profiles';
import { ResumeMarketingClient } from '@/components/resume/resume-marketing-client';

export const dynamic = 'force-dynamic';

export default async function ResumeMarketingPage() {
  const profiles = await listMarketingProfilesAction();

  return (
    <ProtectedRoute componentKey="resume-marketing">
      <div className="container mx-auto py-6 max-w-7xl px-4 sm:px-6 lg:px-8">
        <Suspense fallback={<TableSkeleton rows={5} />}>
          <ResumeMarketingClient initialProfiles={profiles} />
        </Suspense>
      </div>
    </ProtectedRoute>
  );
}
