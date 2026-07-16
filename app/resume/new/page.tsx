import { Suspense } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { TableSkeleton } from '@/components/ui/skeleton';
import { getResumeProfileOptionsAction } from '@/app/actions/resume-profiles';
import { ResumeProfileCreateForm } from '@/components/resume/resume-profile-create-form';

export const dynamic = 'force-dynamic';

export default async function NewResumeProfilePage() {
  const options = await getResumeProfileOptionsAction();

  return (
    <ProtectedRoute componentKey="resume-profiles">
      <div className="container mx-auto py-6 max-w-7xl px-4 sm:px-6 lg:px-8">
        <Suspense fallback={<TableSkeleton rows={6} />}>
          <ResumeProfileCreateForm
            initialCallRequests={options.callRequests}
            initialAssignableUsers={options.assignableUsers}
          />
        </Suspense>
      </div>
    </ProtectedRoute>
  );
}
