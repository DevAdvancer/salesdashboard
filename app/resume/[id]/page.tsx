import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { TableSkeleton } from '@/components/ui/skeleton';
import { getResumeProfileByIdAction, getResumeProfileOptionsAction } from '@/app/actions/resume-profiles';
import { ResumeProfileDetail } from '@/components/resume/resume-profile-detail';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

export default async function ResumeProfileDetailPage({ params }: PageProps) {
  const resolvedParams = await Promise.resolve(params);
  const [profile, options] = await Promise.all([
    getResumeProfileByIdAction(resolvedParams.id),
    getResumeProfileOptionsAction(),
  ]);

  if (!profile) {
    notFound();
  }

  return (
    <ProtectedRoute componentKey="resume-profiles">
      <div className="container mx-auto py-6 max-w-7xl px-4 sm:px-6 lg:px-8">
        <Suspense fallback={<TableSkeleton rows={8} />}>
          <ResumeProfileDetail
            initialProfile={profile}
            assignableUsers={options.assignableUsers}
          />
        </Suspense>
      </div>
    </ProtectedRoute>
  );
}
