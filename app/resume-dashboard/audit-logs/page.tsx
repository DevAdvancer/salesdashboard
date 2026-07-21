import { ProtectedRoute } from '@/components/protected-route';
import { AuditLogsClient } from '@/components/audit/audit-logs-client';

export const metadata = {
  title: 'Audit Logs | Resume Dashboard',
  description: 'View system audit logs',
};

export default function ResumeAuditLogsPage() {
  return (
    <ProtectedRoute componentKey="resume-audit-logs">
      <AuditLogsClient department="resume" />
    </ProtectedRoute>
  );
}
