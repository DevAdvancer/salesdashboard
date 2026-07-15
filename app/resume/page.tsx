import { Suspense } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { TableSkeleton } from '@/components/ui/skeleton';
import { getResumeProfileOptionsAction, listResumeProfilesAction } from '@/app/actions/resume-profiles';
import { ResumeProfilesClient } from '@/components/resume/resume-profiles-client';

export const dynamic = 'force-dynamic';

export default async function ResumeProfilesPage() {
  const [profiles, options] = await Promise.all([
    listResumeProfilesAction(),
    getResumeProfileOptionsAction(),
  ]);

  return (
    <ProtectedRoute componentKey="resume-profiles">
      <div className="container mx-auto py-6 max-w-7xl px-4 sm:px-6 lg:px-8">
        <Suspense fallback={<TableSkeleton rows={5} />}>
          <ResumeProfilesClient initialProfiles={profiles} initialOptions={options} />
        </Suspense>
      </div>
    </ProtectedRoute>
  );
}
