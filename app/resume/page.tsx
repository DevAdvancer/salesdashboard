import { Suspense } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { TableSkeleton } from '@/components/ui/skeleton';
import { getResumeAssignableUsersAction, listResumeProfilesAction } from '@/app/actions/resume-profiles';
import { ResumeProfilesClient } from '@/components/resume/resume-profiles-client';

export const dynamic = 'force-dynamic';

export default async function ResumeProfilesPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const page = typeof searchParams.page === 'string' ? parseInt(searchParams.page, 10) : 1;
  const search = typeof searchParams.search === 'string' ? searchParams.search : undefined;
  const stage = typeof searchParams.stage === 'string' ? searchParams.stage : 'all';
  const assignedToId = typeof searchParams.assignedToId === 'string' ? searchParams.assignedToId : 'all';

  const [resumeData, usersData] = await Promise.all([
    listResumeProfilesAction({
      page: isNaN(page) ? 1 : page,
      limit: 50,
      search,
      stage,
      assignedToId,
    }),
    getResumeAssignableUsersAction(),
  ]);

  return (
    <ProtectedRoute componentKey="resume-profiles">
      <div className="container mx-auto py-6 max-w-7xl px-4 sm:px-6 lg:px-8">
        <Suspense fallback={<TableSkeleton rows={5} />}>
          <ResumeProfilesClient 
            initialData={resumeData} 
            initialOptions={usersData} 
            currentPage={isNaN(page) ? 1 : page}
          />
        </Suspense>
      </div>
    </ProtectedRoute>
  );
}
